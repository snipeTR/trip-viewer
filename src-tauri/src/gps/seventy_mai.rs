//! 70mai A810 / RC12 GPS decoder.
//!
//! Unlike Wolf Box and Miltona — which embed GPS inside each MP4 — the
//! 70mai writes a single plain-text log, `GPSData{NNNNNN}.txt`, at the SD
//! card root. Every fix is one CSV line that names the video clip it
//! belongs to, so one log covers the whole card.
//!
//! File shape:
//!
//! ```text
//! $V02
//! 1779158456,A,40.759531,29.932674,20500,0,-85,1,44,NO20260519-134050-000000B.MP4,0,0,0
//! ```
//!
//! Column layout (decoded from the reference card; fields marked
//! "unconfirmed" could not be pinned down because the sample was recorded
//! while the car was parked, so most sensor fields never changed):
//!
//!   0        Unix timestamp, whole seconds (UTC)
//!   1        fix status — `A` valid, `V` void (NMEA RMC convention)
//!   2        latitude, decimal degrees
//!   3        longitude, decimal degrees
//!   4        unconfirmed — constant `20500` across the stationary sample
//!            (possibly altitude or a fixed-point course); not decoded
//!   5        the camera's own speed field; the sample is stationary so its
//!            unit (km/h vs cm/s) could not be confirmed — see below
//!   6,7,8    unconfirmed — vary row-to-row, almost certainly the 3-axis
//!            g-sensor; not decoded
//!   9        the clip filename this fix belongs to
//!   10,11,12 unconfirmed — `0` across the whole sample
//!
//! ### Speed and heading
//!
//! Because the speed column's unit is unverifiable from a parked-car
//! sample, speed is computed from the haversine distance between
//! consecutive valid fixes divided by their timestamp delta — a
//! unit-independent value that is correct regardless of what the column
//! actually means. Heading is derived the same way (great-circle
//! bearing), matching the Miltona decoder. If a moving-car sample turns
//! up later and the unit can be confirmed, column 5 can be trusted
//! directly instead.
//!
//! ### Locating the log
//!
//! [`extract`] is handed a clip path by [`crate::gps::extract_for_kind`].
//! The log lives at the card/library root, so we walk up from the clip's
//! folder looking for `GPSData*.txt`, then keep only the lines whose
//! column-9 filename belongs to the same recording (front and rear share
//! every filename component but the `F`/`B` channel letter). If [`extract`]
//! is handed a `GPSData*.txt` path directly, the whole file is decoded.

use crate::error::AppError;
use crate::model::GpsPoint;
use std::fs;
use std::path::{Path, PathBuf};

/// How many directory levels above the clip to search for the log. A clip
/// lives at `<root>/Normal/Front/clip.MP4`, so the card root is two levels
/// up; a few extra cover library layouts that nest deeper.
const SIDECAR_SEARCH_DEPTH: usize = 5;

const EARTH_RADIUS_M: f64 = 6_371_000.0;

/// One parsed CSV row carrying a single GPS fix.
struct Row {
    /// Unix timestamp, whole seconds.
    ts: i64,
    lat: f64,
    lon: f64,
    /// `true` when the row's status byte is `A` and the coordinates are in
    /// range. Out-of-range or void fixes are kept (to preserve timing) but
    /// flagged so the map skips them.
    fix_ok: bool,
    /// Column-9 clip filename reduced to the key shared by its front/rear
    /// pair, e.g. `NO20260519-134050-000000`. Used to match a row to a clip.
    group_base: String,
}

/// Decode GPS for a 70mai clip (or, if handed one directly, a whole
/// `GPSData*.txt` log).
pub fn extract(path: &Path) -> Result<Vec<GpsPoint>, AppError> {
    // Entry shape 1: a GPSData*.txt passed directly — decode the lot.
    if is_gps_log(path) {
        return Ok(build_points(parse_log(path)?));
    }

    // Entry shape 2: a clip path — locate its sidecar log(s) and filter.
    let clip_name = match path.file_name().and_then(|n| n.to_str()) {
        Some(n) => n,
        None => return Ok(vec![]),
    };
    let want = group_base(clip_name);

    let logs = find_logs(path);
    if logs.is_empty() {
        eprintln!(
            "70mai gps: no GPSData*.txt found near {}",
            path.display()
        );
        return Ok(vec![]);
    }

    let mut rows: Vec<Row> = Vec::new();
    for log in &logs {
        match parse_log(log) {
            Ok(mut r) => {
                r.retain(|row| row.group_base == want);
                rows.append(&mut r);
            }
            Err(e) => eprintln!("70mai gps: failed reading {}: {e}", log.display()),
        }
    }
    if rows.is_empty() {
        eprintln!(
            "70mai gps: no fixes for {clip_name} in {} log file(s)",
            logs.len()
        );
        return Ok(vec![]);
    }
    rows.sort_by_key(|r| r.ts);
    Ok(build_points(rows))
}

/// True if `path`'s filename looks like a 70mai GPS log (`GPSData*.txt`).
fn is_gps_log(path: &Path) -> bool {
    match path.file_name().and_then(|n| n.to_str()) {
        Some(n) => {
            let lower = n.to_ascii_lowercase();
            lower.starts_with("gpsdata") && lower.ends_with(".txt")
        }
        None => false,
    }
}

/// Reduce a clip filename to the key shared by its front/rear pair: drop
/// the video extension and the trailing `F`/`B` channel letter.
fn group_base(name: &str) -> String {
    let stem = name
        .strip_suffix(".MP4")
        .or_else(|| name.strip_suffix(".mp4"))
        .unwrap_or(name);
    match stem.as_bytes().last() {
        Some(b) if b.is_ascii_alphabetic() => stem[..stem.len() - 1].to_string(),
        _ => stem.to_string(),
    }
}

/// Walk up from a clip's directory looking for `GPSData*.txt`. Returns
/// every log in the first directory that has at least one, sorted by name.
fn find_logs(clip_path: &Path) -> Vec<PathBuf> {
    let mut dir = clip_path.parent();
    for _ in 0..SIDECAR_SEARCH_DEPTH {
        let Some(d) = dir else { break };
        let mut found: Vec<PathBuf> = Vec::new();
        collect_logs_in(d, &mut found);
        // Also peek into an `Other/` subfolder at this level: libraries
        // imported before the GPS log was recognized as a sidecar had it
        // quarantined there as an "unknown file".
        collect_logs_in(&d.join("Other"), &mut found);
        if !found.is_empty() {
            found.sort();
            found.dedup();
            return found;
        }
        dir = d.parent();
    }
    Vec::new()
}

/// Append every `GPSData*.txt` directly inside `dir` to `out`.
fn collect_logs_in(dir: &Path, out: &mut Vec<PathBuf>) {
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.filter_map(|e| e.ok()) {
            let p = entry.path();
            if p.is_file() && is_gps_log(&p) {
                out.push(p);
            }
        }
    }
}

/// Read a `GPSData*.txt` and return every well-formed row.
fn parse_log(path: &Path) -> Result<Vec<Row>, AppError> {
    let text = fs::read_to_string(path)?;
    let mut rows: Vec<Row> = Vec::new();
    let mut skipped = 0usize;

    for line in text.lines() {
        let line = line.trim();
        // Skip blank lines and the `$V02`-style version header — every data
        // line starts with the numeric timestamp.
        if line.is_empty() || !line.as_bytes()[0].is_ascii_digit() {
            continue;
        }
        match parse_row(line) {
            Some(r) => rows.push(r),
            None => skipped += 1,
        }
    }

    if skipped > 0 {
        eprintln!(
            "70mai gps: skipped {skipped} malformed line(s) in {}",
            path.display()
        );
    }
    Ok(rows)
}

/// Parse one CSV data line into a [`Row`]. Returns `None` for lines that
/// are too short or whose numeric fields don't parse.
fn parse_row(line: &str) -> Option<Row> {
    let f: Vec<&str> = line.split(',').collect();
    // Need at least through the column-9 clip filename.
    if f.len() < 10 {
        return None;
    }

    let ts: i64 = f[0].parse().ok()?;
    let lat: f64 = f[2].parse().ok()?;
    let lon: f64 = f[3].parse().ok()?;

    let fix_ok = f[1].eq_ignore_ascii_case("A")
        && lat.is_finite()
        && lon.is_finite()
        && lat.abs() <= 90.0
        && lon.abs() <= 180.0
        && !(lat == 0.0 && lon == 0.0);

    Some(Row {
        ts,
        lat,
        lon,
        fix_ok,
        group_base: group_base(f[9].trim()),
    })
}

/// Turn timestamp-ordered rows into [`GpsPoint`]s, deriving speed and
/// heading from consecutive valid fixes.
fn build_points(rows: Vec<Row>) -> Vec<GpsPoint> {
    if rows.is_empty() {
        return vec![];
    }

    let t0 = rows[0].ts;
    let mut points: Vec<GpsPoint> = rows
        .iter()
        .map(|r| GpsPoint {
            t_offset_s: (r.ts - t0) as f64,
            lat: if r.fix_ok { r.lat } else { 0.0 },
            lon: if r.fix_ok { r.lon } else { 0.0 },
            speed_mps: 0.0,
            heading_deg: 0.0,
            altitude_m: 0.0,
            fix_ok: r.fix_ok,
        })
        .collect();

    // Speed and heading come from successive positions — see the module
    // comment for why column 5's raw speed is not trusted.
    for i in 0..points.len().saturating_sub(1) {
        if !points[i].fix_ok || !points[i + 1].fix_ok {
            continue;
        }
        let dt = points[i + 1].t_offset_s - points[i].t_offset_s;
        if dt <= 0.0 {
            continue; // duplicate or out-of-order timestamp
        }
        let dist = haversine_m(
            points[i].lat,
            points[i].lon,
            points[i + 1].lat,
            points[i + 1].lon,
        );
        points[i].speed_mps = dist / dt;
        points[i].heading_deg = bearing_deg(
            points[i].lat,
            points[i].lon,
            points[i + 1].lat,
            points[i + 1].lon,
        );
    }
    // The last fix has no successor; carry the previous values forward.
    if points.len() >= 2 {
        let last = points.len() - 1;
        if points[last].fix_ok {
            points[last].speed_mps = points[last - 1].speed_mps;
            points[last].heading_deg = points[last - 1].heading_deg;
        }
    }
    points
}

/// Great-circle distance between two coordinates, in metres.
fn haversine_m(lat1: f64, lon1: f64, lat2: f64, lon2: f64) -> f64 {
    let (p1, p2) = (lat1.to_radians(), lat2.to_radians());
    let dlat = (lat2 - lat1).to_radians();
    let dlon = (lon2 - lon1).to_radians();
    let a = (dlat / 2.0).sin().powi(2)
        + p1.cos() * p2.cos() * (dlon / 2.0).sin().powi(2);
    2.0 * EARTH_RADIUS_M * a.clamp(0.0, 1.0).sqrt().asin()
}

/// Initial great-circle bearing from point 1 to point 2, in degrees
/// (0 = north, clockwise).
fn bearing_deg(lat1: f64, lon1: f64, lat2: f64, lon2: f64) -> f64 {
    let (lat1, lon1) = (lat1.to_radians(), lon1.to_radians());
    let (lat2, lon2) = (lat2.to_radians(), lon2.to_radians());
    let dlon = lon2 - lon1;
    let y = dlon.sin() * lat2.cos();
    let x = lat1.cos() * lat2.sin() - lat1.sin() * lat2.cos() * dlon.cos();
    (y.atan2(x).to_degrees() + 360.0) % 360.0
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    /// Five fixes copied from the reference card's `GPSData000001.txt`:
    /// three for recording `…000000`, two for `…000001`, the last void.
    const SAMPLE: &str = "\
$V02
1779158456,A,40.759531,29.932674,20500,0,-85,1,44,NO20260519-134050-000000B.MP4,0,0,0
1779158457,A,40.759531,29.932674,20500,0,-92,2,43,NO20260519-134050-000000B.MP4,0,0,0
1779158459,A,40.759531,29.932674,20500,0,-80,4,37,NO20260519-134050-000000B.MP4,0,0,0
1779158466,A,40.759530,29.932675,20500,0,-83,1,45,NO20260519-134100-000001B.MP4,0,0,0
1779158467,V,0.000000,0.000000,0,0,0,0,0,NO20260519-134100-000001B.MP4,0,0,0
";

    fn write_file(dir: &Path, name: &str, body: &str) -> PathBuf {
        let p = dir.join(name);
        let mut f = fs::File::create(&p).unwrap();
        f.write_all(body.as_bytes()).unwrap();
        p
    }

    #[test]
    fn group_base_strips_extension_and_channel() {
        assert_eq!(
            group_base("NO20260519-134050-000000B.MP4"),
            "NO20260519-134050-000000"
        );
        assert_eq!(
            group_base("NO20260519-134050-000000F.MP4"),
            "NO20260519-134050-000000"
        );
        assert_eq!(
            group_base("EV20260521-142650-000127F.mp4"),
            "EV20260521-142650-000127"
        );
    }

    #[test]
    fn decodes_log_passed_directly() {
        let dir = tempfile::tempdir().unwrap();
        let log = write_file(dir.path(), "GPSData000001.txt", SAMPLE);

        let pts = extract(&log).unwrap();
        // Five data lines → five points; the `$V02` header is skipped.
        assert_eq!(pts.len(), 5);
        // Offsets are relative to the first row's timestamp.
        assert_eq!(pts[0].t_offset_s, 0.0);
        assert_eq!(pts[1].t_offset_s, 1.0);
        assert_eq!(pts[2].t_offset_s, 3.0);
        assert!(pts[0].fix_ok);
        assert!((pts[0].lat - 40.759531).abs() < 1e-6);
        assert!((pts[0].lon - 29.932674).abs() < 1e-6);
        // The `V`-status row is kept (for timing) but flagged unfixed.
        assert!(!pts[4].fix_ok);
        assert_eq!(pts[4].lat, 0.0);
    }

    #[test]
    fn finds_sidecar_log_from_clip_path() {
        // Layout: <root>/GPSData000001.txt + <root>/Normal/Front/<clip>.
        let root = tempfile::tempdir().unwrap();
        write_file(root.path(), "GPSData000001.txt", SAMPLE);
        let front = root.path().join("Normal").join("Front");
        fs::create_dir_all(&front).unwrap();
        // Query the FRONT clip even though the log names the BACK clip —
        // the front/rear pair must resolve to the same fixes.
        let clip = front.join("NO20260519-134050-000000F.MP4");
        fs::File::create(&clip).unwrap();

        let pts = extract(&clip).unwrap();
        // Only the three rows for recording …000000 should match.
        assert_eq!(pts.len(), 3);
        assert!(pts.iter().all(|p| p.fix_ok));
    }

    #[test]
    fn finds_sidecar_log_quarantined_in_other() {
        // Older imports moved the unrecognized GPS log into <root>/Other/.
        // The decoder should still find it when walking up from the clip.
        let root = tempfile::tempdir().unwrap();
        let other = root.path().join("Other");
        fs::create_dir_all(&other).unwrap();
        write_file(&other, "GPSData000001.txt", SAMPLE);
        let videos = root.path().join("Videos");
        fs::create_dir_all(&videos).unwrap();
        let clip = videos.join("NO20260519-134050-000000F.MP4");
        fs::File::create(&clip).unwrap();

        let pts = extract(&clip).unwrap();
        assert_eq!(pts.len(), 3);
        assert!(pts.iter().all(|p| p.fix_ok));
    }

    #[test]
    fn missing_log_returns_empty() {
        let root = tempfile::tempdir().unwrap();
        let clip = root.path().join("NO20260519-134050-000000F.MP4");
        fs::File::create(&clip).unwrap();
        assert!(extract(&clip).unwrap().is_empty());
    }

    #[test]
    fn clip_with_no_matching_fixes_returns_empty() {
        let root = tempfile::tempdir().unwrap();
        write_file(root.path(), "GPSData000001.txt", SAMPLE);
        let clip = root.path().join("NO20260101-000000-999999F.MP4");
        fs::File::create(&clip).unwrap();
        assert!(extract(&clip).unwrap().is_empty());
    }

    #[test]
    fn derives_speed_and_heading_for_moving_fixes() {
        // Two fixes 0.001° of latitude apart (~111 m) one second apart.
        let dir = tempfile::tempdir().unwrap();
        let body = "\
$V02
1000000000,A,40.000000,29.000000,0,0,0,0,0,NO20260101-000000-000000F.MP4,0,0,0
1000000001,A,40.001000,29.000000,0,0,0,0,0,NO20260101-000000-000000F.MP4,0,0,0
";
        let log = write_file(dir.path(), "GPSData000002.txt", body);
        let pts = extract(&log).unwrap();
        assert_eq!(pts.len(), 2);
        // ~111 m in 1 s.
        assert!(
            (pts[0].speed_mps - 111.0).abs() < 2.0,
            "speed was {}",
            pts[0].speed_mps
        );
        // Heading is due north (≈0°/360°).
        assert!(pts[0].heading_deg < 1.0 || pts[0].heading_deg > 359.0);
    }

    #[test]
    fn skips_malformed_lines() {
        let dir = tempfile::tempdir().unwrap();
        let body = "\
$V02
not,a,real,row
1779158456,A,40.759531,29.932674,20500,0,-85,1,44,NO20260519-134050-000000B.MP4,0,0,0
1779158457,A,40.759531
";
        let log = write_file(dir.path(), "GPSData000003.txt", body);
        let pts = extract(&log).unwrap();
        // Only the one complete line survives.
        assert_eq!(pts.len(), 1);
    }
}
