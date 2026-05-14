//! Stale-job recovery. Called once at app startup after DB migrations.
//!
//! If the app was killed (hard exit, crash, power loss) while a trip
//! was encoding, the child ffmpeg process ends too and leaves behind
//! a partial .mp4 with no finalized moov atom — unplayable garbage.
//! The `timelapse_jobs` row is still marked `running`.
//!
//! On next launch we find every `running` row, delete any partial
//! output file, and reset the row to `pending` so it picks up again
//! on the next start.

use std::fs;

use rusqlite::params;

use crate::db::timelapse_jobs::TimelapseJobRow;
use crate::db::{self, DbHandle};
use crate::error::AppError;
use crate::gps::GPS_PARSER_VERSION;
use crate::timelapse::worker;

/// Snapshot of every job still marked `running` in the DB. After a hard
/// process exit this is the set whose output files are partial and
/// whose rows need resetting before the next encode pass.
pub fn list_stale_jobs(db: &DbHandle) -> Result<Vec<TimelapseJobRow>, AppError> {
    let conn = db
        .lock()
        .map_err(|_| AppError::Internal("db mutex poisoned".into()))?;
    db::timelapse_jobs::list_by_status(&conn, db::timelapse_jobs::STATUS_RUNNING)
}

/// Reset a single stale-running job: best-effort remove the partial
/// output file, then flip its DB row back to `pending`. Exposed so a
/// progress-reporting startup runner can loop over jobs and emit a
/// tick per recovered row.
pub fn reset_one_stale_job(
    db: &DbHandle,
    row: &TimelapseJobRow,
) -> Result<(), AppError> {
    if let Some(path) = row.output_path.as_deref() {
        if let Err(e) = fs::remove_file(path) {
            if e.kind() != std::io::ErrorKind::NotFound {
                eprintln!(
                    "[timelapse] cleanup: could not remove {path}: {e} (continuing)"
                );
            }
        }
    }
    let conn = db
        .lock()
        .map_err(|_| AppError::Internal("db mutex poisoned".into()))?;
    db::timelapse_jobs::reset_to_pending(&conn, &row.trip_id, &row.tier, &row.channel)?;
    Ok(())
}

pub fn cleanup_stale_jobs(db: &DbHandle) -> Result<u64, AppError> {
    let running = list_stale_jobs(db)?;
    let count = running.len() as u64;
    for row in &running {
        reset_one_stale_job(db, row)?;
    }
    if count > 0 {
        eprintln!("[timelapse] cleanup: reset {count} stale running job(s) to pending");
    }
    backfill_output_sizes(db)?;
    Ok(count)
}

/// One-shot pass to fill `output_size_bytes` on done rows that were
/// completed before migration 0009 (or whose output was missing at
/// completion time and is now present). Cheap — one stat per
/// completed job, dozens per typical library.
fn backfill_output_sizes(db: &DbHandle) -> Result<(), AppError> {
    let rows: Vec<(String, String, String, String)> = {
        let conn = db
            .lock()
            .map_err(|_| AppError::Internal("db mutex poisoned".into()))?;
        let mut stmt = conn.prepare(
            "SELECT trip_id, tier, channel, output_path
             FROM timelapse_jobs
             WHERE status = ?1
               AND output_path IS NOT NULL
               AND output_size_bytes IS NULL",
        )?;
        let mapped = stmt.query_map(params![db::timelapse_jobs::STATUS_DONE], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
            ))
        })?;
        let mut out = Vec::new();
        for r in mapped {
            out.push(r?);
        }
        out
    };
    if rows.is_empty() {
        return Ok(());
    }
    let mut filled = 0u64;
    for (trip_id, tier, channel, output_path) in rows {
        let Ok(meta) = fs::metadata(&output_path) else {
            continue;
        };
        let conn = db
            .lock()
            .map_err(|_| AppError::Internal("db mutex poisoned".into()))?;
        conn.execute(
            "UPDATE timelapse_jobs SET output_size_bytes = ?4
             WHERE trip_id = ?1 AND tier = ?2 AND channel = ?3",
            params![trip_id, tier, channel, meta.len() as i64],
        )?;
        filled += 1;
    }
    if filled > 0 {
        eprintln!("[timelapse] cleanup: backfilled output_size_bytes for {filled} completed job(s)");
    }
    Ok(())
}

/// Opportunistic GPS archival for trips that were timelapsed before the
/// `trip_gps` feature shipped. Each launch we scan for at most
/// `max_trips` candidates and persist their stitched GPS so a future
/// "Delete originals" still leaves a working map + speed graph. Trips
/// whose originals are already gone (archive-only) are skipped — there
/// is nothing on disk to extract from.
///
/// Bounded so a cold-start on a heavy library doesn't tail-block the
/// app; it'll catch up across a handful of launches.
/// Sequential one-shot variant used by the test suite and by any
/// caller that doesn't need per-trip progress. The production startup
/// path goes through `startup::run`, which loops the two helpers
/// below and emits a `startup:task-progress` event after each trip.
#[allow(dead_code)]
pub fn backfill_trip_gps(db: &DbHandle, max_trips: usize) -> Result<usize, AppError> {
    let candidates = backfill_candidates(db, max_trips)?;
    if candidates.is_empty() {
        return Ok(0);
    }

    let mut written = 0usize;
    for trip_id in &candidates {
        if backfill_one_trip(db, trip_id)? {
            written += 1;
        }
    }

    if written > 0 {
        eprintln!("[timelapse] gps backfill: persisted GPS for {written} trip(s)");
    }
    Ok(written)
}

/// Trip ids that still need a `trip_gps` row written. The same selection
/// criteria as `backfill_trip_gps`: completed timelapse, at least one
/// non-tombstone segment on disk, no `trip_gps` row at the current
/// `parser_version`. Bounded by `max_trips` so a heavy library doesn't
/// pin startup on one launch.
pub fn backfill_candidates(
    db: &DbHandle,
    max_trips: usize,
) -> Result<Vec<String>, AppError> {
    let conn = db
        .lock()
        .map_err(|_| AppError::Internal("db mutex poisoned".into()))?;
    let mut stmt = conn.prepare(
        "SELECT DISTINCT t.id FROM trips t
         WHERE EXISTS (
             SELECT 1 FROM timelapse_jobs j
             WHERE j.trip_id = t.id AND j.status = ?1
         )
         AND EXISTS (
             SELECT 1 FROM segments s
             WHERE s.trip_id = t.id AND s.is_tombstone = 0
         )
         AND NOT EXISTS (
             SELECT 1 FROM trip_gps g
             WHERE g.trip_id = t.id AND g.parser_version >= ?2
         )
         ORDER BY t.start_time_ms DESC
         LIMIT ?3",
    )?;
    let rows = stmt.query_map(
        params![
            db::timelapse_jobs::STATUS_DONE,
            GPS_PARSER_VERSION as i64,
            max_trips as i64
        ],
        |r| r.get::<_, String>(0),
    )?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

/// Stitch and persist GPS for one trip. Returns `Ok(true)` when a
/// `trip_gps` row was written, `Ok(false)` when the trip yielded no
/// segments to stitch (caller can treat as a skip). Per-trip failures
/// during stitch or upsert are logged and folded into `Ok(false)` so a
/// single bad trip doesn't abort a sweep.
pub fn backfill_one_trip(db: &DbHandle, trip_id: &str) -> Result<bool, AppError> {
    let segments = match worker::trip_segment_info(db, trip_id) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("[timelapse] gps backfill: trip_segment_info({trip_id}) failed: {e}");
            return Ok(false);
        }
    };
    if segments.is_empty() {
        return Ok(false);
    }
    let stitched = worker::stitch_trip_gps(&segments);
    let conn = db
        .lock()
        .map_err(|_| AppError::Internal("db mutex poisoned".into()))?;
    if let Err(e) = db::trip_gps::upsert(&conn, trip_id, &stitched, GPS_PARSER_VERSION) {
        eprintln!("[timelapse] gps backfill: upsert({trip_id}) failed: {e}");
        return Ok(false);
    }
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::open_in_memory;
    use std::env::temp_dir;
    use std::io::Write;

    #[test]
    fn resets_running_rows_and_deletes_output_files() {
        let db = open_in_memory().unwrap();

        // Create a partial output file on disk we can verify is deleted.
        let tmp = temp_dir().join("tripviewer-cleanup-test.mp4");
        {
            let mut f = fs::File::create(&tmp).unwrap();
            writeln!(f, "not a real mp4").unwrap();
        }

        {
            let conn = db.lock().unwrap();
            db::timelapse_jobs::upsert_pending(&conn, "trip-1", "8x", "F").unwrap();
            db::timelapse_jobs::mark_running(&conn, "trip-1", "8x", "F").unwrap();
            // Simulate mid-encode state: output_path populated but status still running.
            conn.execute(
                "UPDATE timelapse_jobs SET output_path = ?1 WHERE trip_id = ?2",
                rusqlite::params![tmp.to_string_lossy().to_string(), "trip-1"],
            )
            .unwrap();
        }

        let reset_count = cleanup_stale_jobs(&db).unwrap();
        assert_eq!(reset_count, 1);
        assert!(!tmp.exists(), "partial output file should be removed");

        let conn = db.lock().unwrap();
        let row = db::timelapse_jobs::get(&conn, "trip-1", "8x", "F")
            .unwrap()
            .unwrap();
        assert_eq!(row.status, db::timelapse_jobs::STATUS_PENDING);
        assert!(row.output_path.is_none());
    }

    #[test]
    fn missing_output_file_is_not_an_error() {
        let db = open_in_memory().unwrap();
        {
            let conn = db.lock().unwrap();
            db::timelapse_jobs::upsert_pending(&conn, "t", "8x", "F").unwrap();
            db::timelapse_jobs::mark_running(&conn, "t", "8x", "F").unwrap();
            conn.execute(
                "UPDATE timelapse_jobs SET output_path = ?1 WHERE trip_id = ?2",
                rusqlite::params!["C:/does/not/exist.mp4", "t"],
            )
            .unwrap();
        }
        let n = cleanup_stale_jobs(&db).unwrap();
        assert_eq!(n, 1);
    }

    #[test]
    fn noop_when_no_running_rows() {
        let db = open_in_memory().unwrap();
        {
            let conn = db.lock().unwrap();
            db::timelapse_jobs::upsert_pending(&conn, "t", "8x", "F").unwrap();
        }
        let n = cleanup_stale_jobs(&db).unwrap();
        assert_eq!(n, 0);
    }
}
