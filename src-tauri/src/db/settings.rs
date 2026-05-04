//! Legacy key/value settings table accessor.
//!
//! The `settings` table itself is **dropped** by migration 0011 in fresh
//! per-archive DBs — per-machine state lives in `app_data_dir/settings.json`
//! (see `crate::app_settings`) and the per-archive cache that previously
//! lived here (`library_root`) is redundant once the DB is colocated with
//! the videos. This module is kept around solely so the per-archive
//! migration in `migration_v2.rs` can read the four legacy keys out of
//! the *legacy* DB (which still has the settings table at migration
//! head 10) before snapshotting it into the new per-archive DB.

use rusqlite::{params, Connection, OptionalExtension};

use crate::error::AppError;

pub fn get(conn: &Connection, key: &str) -> Result<Option<String>, AppError> {
    let value: Option<String> = conn
        .query_row(
            "SELECT value FROM settings WHERE key = ?1",
            params![key],
            |r| r.get(0),
        )
        .optional()?;
    Ok(value)
}

// `set` exists only for the migration tests' legacy-conn setup. New
// per-archive DBs don't carry the settings table; nothing in production
// writes here.
#[allow(dead_code)]
pub fn set(conn: &Connection, key: &str, value: &str) -> Result<(), AppError> {
    let now = chrono::Utc::now().timestamp_millis();
    conn.execute(
        "INSERT INTO settings (key, value, updated_at_ms) VALUES (?1, ?2, ?3)
         ON CONFLICT(key) DO UPDATE SET
            value = excluded.value,
            updated_at_ms = excluded.updated_at_ms",
        params![key, value, now],
    )?;
    Ok(())
}

#[allow(dead_code)]
pub fn delete(conn: &Connection, key: &str) -> Result<(), AppError> {
    conn.execute("DELETE FROM settings WHERE key = ?1", params![key])?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Connection at the legacy schema shape (settings table present),
    /// matching what `migration_v2.rs` sees when it opens a pre-PR-2 DB.
    /// Fresh per-archive DBs no longer carry this table — see migration
    /// 0011 — so our `open_in_memory` helper can't be used here.
    fn legacy_settings_conn() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                updated_at_ms INTEGER NOT NULL
            )",
        )
        .unwrap();
        conn
    }

    #[test]
    fn set_and_get_roundtrip() {
        let conn = legacy_settings_conn();
        set(&conn, "ffmpeg_path", "C:/ffmpeg/bin/ffmpeg.exe").unwrap();
        let got = get(&conn, "ffmpeg_path").unwrap();
        assert_eq!(got.as_deref(), Some("C:/ffmpeg/bin/ffmpeg.exe"));
    }

    #[test]
    fn missing_key_returns_none() {
        let conn = legacy_settings_conn();
        assert!(get(&conn, "nope").unwrap().is_none());
    }

    #[test]
    fn set_overwrites() {
        let conn = legacy_settings_conn();
        set(&conn, "k", "v1").unwrap();
        set(&conn, "k", "v2").unwrap();
        assert_eq!(get(&conn, "k").unwrap().as_deref(), Some("v2"));
    }

    #[test]
    fn delete_removes_key() {
        let conn = legacy_settings_conn();
        set(&conn, "k", "v").unwrap();
        delete(&conn, "k").unwrap();
        assert!(get(&conn, "k").unwrap().is_none());
    }
}
