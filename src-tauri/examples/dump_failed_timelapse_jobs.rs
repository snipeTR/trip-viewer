//! One-off diagnostic: dump every failed row from a per-archive DB's
//! `timelapse_jobs` table along with its `error_message`. The frontend
//! doesn't surface error_message anywhere yet (it just shows a
//! `"{failedCount} failed"` count), and the worker writes the reason to
//! the DB silently — this lets you see why each job failed without
//! having to re-run the encode pass.
//!
//! Usage:
//!   cargo run --manifest-path src-tauri/Cargo.toml \
//!     --example dump_failed_timelapse_jobs -- \
//!     "/run/media/chris10/Matrix/Wolfbox Dashcam"

use std::path::PathBuf;

use chrono::{DateTime, Utc};
use rusqlite::Connection;

fn main() {
    let mut args = std::env::args().skip(1);
    let archive_root = args.next().unwrap_or_else(|| {
        eprintln!(
            "usage: dump_failed_timelapse_jobs <archive_root>\n\
             e.g. /run/media/chris10/Matrix/Wolfbox Dashcam"
        );
        std::process::exit(2);
    });

    let db_path: PathBuf = PathBuf::from(&archive_root)
        .join(".tripviewer")
        .join("tripviewer.db");
    if !db_path.exists() {
        eprintln!("no per-archive DB at {}", db_path.display());
        std::process::exit(1);
    }

    let conn = Connection::open(&db_path)
        .unwrap_or_else(|e| panic!("open {}: {e}", db_path.display()));

    let mut stmt = conn
        .prepare(
            "SELECT trip_id, tier, channel, completed_at_ms, error_message
             FROM timelapse_jobs
             WHERE status = 'failed'
             ORDER BY completed_at_ms DESC NULLS LAST, trip_id ASC",
        )
        .expect("prepare");

    let rows = stmt
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, Option<i64>>(3)?,
                r.get::<_, Option<String>>(4)?,
            ))
        })
        .expect("query");

    let mut count = 0usize;
    for row in rows {
        let (trip_id, tier, channel, completed_at_ms, error_message) =
            row.expect("row decode");
        count += 1;
        let ts = completed_at_ms
            .and_then(DateTime::<Utc>::from_timestamp_millis)
            .map(|dt| dt.to_rfc3339())
            .unwrap_or_else(|| "—".to_string());
        let msg = error_message.unwrap_or_else(|| "(no error_message recorded)".into());
        println!(
            "trip={trip_id} tier={tier} channel={channel} completed={ts}\n  error: {msg}\n"
        );
    }

    if count == 0 {
        println!("no failed timelapse_jobs rows in {}", db_path.display());
    } else {
        println!("{count} failed row(s)");
    }
}
