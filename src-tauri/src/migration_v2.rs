//! Per-archive DB migration: relocate the legacy single-archive DB at
//! `app_data_dir/tripviewer.db` into `<archive_root>/.tripviewer/tripviewer.db`
//! so the user's metadata travels with their video drive.
//!
//! Triggered on launch when:
//! - the legacy file at `app_data_dir/tripviewer.db` exists, AND
//! - `AppSettings.last_archive` is `None`, AND
//! - we can derive an archive root from the legacy DB's segments.
//!
//! Approach: rename the file in place after a WAL checkpoint. No path
//! rewriting yet — the absolute paths inside the DB stay valid because
//! the user is migrating on the same machine. Cross-OS portability is
//! a separate change that wires the `paths::to/from_archive_relative`
//! helpers into every read/write site.
//!
//! UX-wise this is **silent** when discovery succeeds: the legacy DB
//! has segments whose master_path lives under a `Videos/` folder, so
//! we know the user's archive root without asking. PR 3 will add an
//! explicit "Open archive…" picker so users in the edge case (no
//! segments, or non-standard layout) can pick a folder themselves.
//! Showing a dialog here is not an option — Tauri's blocking dialog
//! API requires the event loop, which the `setup()` callback runs
//! before.
//!
//! The migration is idempotent: if it can't run (no legacy DB, or
//! discovery fails), the legacy file stays where it is and we re-check
//! every launch.

use std::path::{Path, PathBuf};

use rusqlite::Connection;

use crate::app_settings::AppSettingsHandle;
use crate::error::AppError;
use crate::timelapse::worker::{discover_library_root, DiscoveredRoot};

/// Outcome of a migration attempt. The string is logged to stderr for
/// post-launch debugging; the frontend doesn't see this directly.
pub enum MigrationOutcome {
    NotNeeded,
    Migrated { archive_root: PathBuf },
    Skipped { reason: String },
}

/// Run the per-archive migration if the launch state warrants it.
pub fn run_if_needed(
    app_data_dir: &Path,
    settings: &AppSettingsHandle,
) -> Result<MigrationOutcome, AppError> {
    let legacy_db_path = app_data_dir.join("tripviewer.db");
    if !legacy_db_path.exists() {
        return Ok(MigrationOutcome::NotNeeded);
    }
    if settings.read().last_archive.is_some() {
        return Ok(MigrationOutcome::NotNeeded);
    }

    // Pull any unmigrated per-machine settings out of the legacy DB
    // before we move it. Idempotent (gated by schema_version inside
    // app_settings) — for users who already went through the JSON
    // settings migration this is a no-op.
    {
        let conn = Connection::open(&legacy_db_path)?;
        if let Err(e) = crate::app_settings::migrate_from_sqlite(settings, &conn) {
            eprintln!("[migration_v2] settings extraction failed: {e}");
        }
    }

    // Derive the archive root from the legacy DB's segments. Only the
    // `Library` variant (parent-of-Videos) is treated as confident
    // enough to auto-migrate: that's the structured layout the import
    // pipeline produces. `SegmentParent` (no Videos/ ancestor) means
    // the user scanned in place from an arbitrary folder; auto-moving
    // their DB into a hidden subfolder there would be surprising, so
    // we leave it alone and let PR 3's archive picker handle that
    // case explicitly.
    let archive_root: PathBuf = {
        let conn = Connection::open(&legacy_db_path)?;
        match discover_library_root(&conn) {
            Ok(DiscoveredRoot::Library(p)) => p,
            Ok(DiscoveredRoot::SegmentParent(p)) => {
                return Ok(MigrationOutcome::Skipped {
                    reason: format!(
                        "segments live under {} but no Videos/ ancestor — \
                         auto-migration only handles structured archives. \
                         Use the upcoming Open Archive UI.",
                        p.display()
                    ),
                });
            }
            Err(e) => {
                return Ok(MigrationOutcome::Skipped {
                    reason: format!("could not derive archive root from segments: {e}"),
                });
            }
        }
    };

    // Pre-flight: refuse if the chosen folder already has a per-archive
    // DB. Better safe than overwriting.
    let new_db_dir = archive_root.join(".tripviewer");
    let new_db_path = new_db_dir.join("tripviewer.db");
    if new_db_path.exists() {
        return Ok(MigrationOutcome::Skipped {
            reason: format!(
                "target archive already has a Trip Viewer DB at {}: \
                 refusing to overwrite",
                new_db_path.display()
            ),
        });
    }

    // Checkpoint the WAL into the main file so the rename is safe to
    // do on the .db alone. Without this, an outstanding WAL would
    // either be orphaned at the legacy location (lost) or copied to
    // the new location (race-prone).
    {
        let conn = Connection::open(&legacy_db_path)?;
        conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE)")?;
    }

    std::fs::create_dir_all(&new_db_dir)?;

    // Copy first, verify, then delete the source. `fs::rename` only
    // works within a single filesystem; the typical migration moves
    // from the OS drive (~/.local/share) onto the user's NTFS/ext4
    // archive volume, which is a different mount, and would fail with
    // EXDEV. Copy is also a safer pattern for irreplaceable data —
    // a torn copy can be retried, but a half-moved rename can't.
    let src_segments: i64 = {
        let conn = Connection::open(&legacy_db_path)?;
        conn.query_row("SELECT COUNT(*) FROM segments", [], |r| r.get(0))?
    };

    std::fs::copy(&legacy_db_path, &new_db_path)?;

    // Sanity-check the destination before unlinking the source. If
    // anything's off (truncated copy, schema corruption, segment count
    // mismatch), roll back the destination and leave the legacy file
    // for retry next launch.
    let dest_segments: i64 = match Connection::open(&new_db_path) {
        Ok(conn) => match conn.query_row("SELECT COUNT(*) FROM segments", [], |r| r.get(0)) {
            Ok(n) => n,
            Err(e) => {
                let _ = std::fs::remove_file(&new_db_path);
                return Err(AppError::Internal(format!(
                    "destination DB unreadable after copy, rolled back: {e}"
                )));
            }
        },
        Err(e) => {
            let _ = std::fs::remove_file(&new_db_path);
            return Err(AppError::Internal(format!(
                "destination DB unopenable after copy, rolled back: {e}"
            )));
        }
    };
    if dest_segments != src_segments {
        let _ = std::fs::remove_file(&new_db_path);
        return Err(AppError::Internal(format!(
            "segment count mismatch after copy: src={src_segments}, dest={dest_segments}"
        )));
    }

    // Self-check passed. Now safe to delete the legacy file.
    std::fs::remove_file(&legacy_db_path)?;

    // Sweep stale WAL/SHM files left at the legacy location. After
    // wal_checkpoint(TRUNCATE) and the source delete these have no
    // purpose; SQLite will recreate fresh ones at the new location.
    for ext in ["-wal", "-shm"] {
        let stale = app_data_dir.join(format!("tripviewer.db{ext}"));
        if stale.exists() {
            let _ = std::fs::remove_file(stale);
        }
    }

    settings.update(|s| {
        s.last_archive = Some(archive_root.to_string_lossy().into_owned());
    })?;

    Ok(MigrationOutcome::Migrated { archive_root })
}

/// One-shot cleanup of orphan files in `app_data_dir` that previous
/// versions of Trip Viewer left behind.
pub fn cleanup_orphan_files(app_data_dir: &Path) {
    // recovery-config.json — referenced nowhere in current Rust or
    // TS code (verified via grep). Delete on sight.
    let orphan = app_data_dir.join("recovery-config.json");
    if orphan.exists() {
        match std::fs::remove_file(&orphan) {
            Ok(()) => eprintln!("[migration_v2] removed orphan {}", orphan.display()),
            Err(e) => eprintln!("[migration_v2] could not remove {}: {e}", orphan.display()),
        }
    }
}
