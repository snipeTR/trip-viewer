//! Archive-relative path helpers.
//!
//! The per-archive DB stores file locations relative to the archive root
//! and always with forward-slash separators, so a Linux-written archive
//! opens cleanly on Windows and vice versa. Two helpers do all the work:
//!
//! - [`to_archive_relative`] strips the archive root prefix and
//!   normalizes separators. Used wherever we *write* a path into the DB.
//! - [`from_archive_relative`] rejoins the archive root with the stored
//!   string. Used wherever we *read* a path back out for the OS to act on.
//!
//! The contract: `from_archive_relative(to_archive_relative(p, root), root) == canonicalize(p)`
//! for every `p` that lives under `root`.
//!
//! Cross-OS round-trip relies on `Path::join` accepting forward slashes
//! on every platform Rust supports — verified by tests gated on
//! `cfg(windows)` and `cfg(unix)`.

use std::path::{Component, Path, PathBuf};

use crate::error::AppError;

/// Convert an absolute path to its archive-relative storage form.
///
/// Not yet wired into the read/write sites in `db/segments.rs` /
/// `db/timelapse_jobs.rs` — that's the per-archive migration's job.
/// Defined here in advance so the helper has tests and a clear contract
/// before the call sites change.
#[allow(dead_code)]
///
/// `archive_root` must already be canonicalized by the caller (use
/// `dunce::canonicalize` on Windows to strip `\\?\` prefixes that
/// `std::fs::canonicalize` injects).
///
/// Errors:
/// - [`AppError::PathOutsideArchive`] if `abs` is not a descendant of
///   `archive_root`.
/// - [`AppError::Internal`] for `..` segments after the prefix strip,
///   for an empty result (would alias the root itself), or for any
///   other unexpected component.
pub fn to_archive_relative(abs: &Path, archive_root: &Path) -> Result<String, AppError> {
    let canonical = dunce::canonicalize(abs)
        .map_err(|e| AppError::Internal(format!("canonicalize {}: {e}", abs.display())))?;

    let stripped = canonical.strip_prefix(archive_root).map_err(|_| {
        AppError::PathOutsideArchive {
            path: canonical.display().to_string(),
        }
    })?;

    let mut parts: Vec<String> = Vec::new();
    for c in stripped.components() {
        match c {
            Component::Normal(s) => parts.push(s.to_string_lossy().into_owned()),
            Component::CurDir => {}
            Component::ParentDir => {
                return Err(AppError::Internal(format!(
                    "refusing to encode '..' in archive-relative path: {}",
                    canonical.display()
                )));
            }
            Component::Prefix(_) | Component::RootDir => {
                return Err(AppError::Internal(format!(
                    "unexpected absolute component after strip_prefix: {}",
                    canonical.display()
                )));
            }
        }
    }

    if parts.is_empty() {
        return Err(AppError::Internal(format!(
            "archive-relative path is empty (would alias the archive root): {}",
            canonical.display()
        )));
    }

    Ok(parts.join("/"))
}

/// Recombine an archive-relative path with its archive root.
///
/// Pair to `to_archive_relative`; same wired-up-later note applies.
#[allow(dead_code)]
///
/// Forward-slash separators in the stored string are interpreted by
/// `Path::join` correctly on every platform — `"a/b/c"` is treated as
/// three components on both Unix and Windows.
pub fn from_archive_relative(rel: &str, archive_root: &Path) -> PathBuf {
    archive_root.join(rel)
}

/// True when `child` lies under `parent` after canonicalization. Used
/// for the "is this scan path part of the active archive?" guard. Both
/// arguments must already exist on disk — returns `false` if either
/// fails to canonicalize.
#[allow(dead_code)] // Used by PR 3's archive guards.
pub fn is_under(child: &Path, parent: &Path) -> bool {
    let Ok(c) = dunce::canonicalize(child) else {
        return false;
    };
    let Ok(p) = dunce::canonicalize(parent) else {
        return false;
    };
    c.starts_with(p)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn touch(p: &Path) {
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(p, b"").unwrap();
    }

    #[test]
    fn roundtrip_simple() {
        let dir = tempdir().unwrap();
        let root = dunce::canonicalize(dir.path()).unwrap();
        let video = root.join("Videos").join("2026_01_01.mp4");
        touch(&video);

        let rel = to_archive_relative(&video, &root).unwrap();
        // Always forward-slash, regardless of OS.
        assert_eq!(rel, "Videos/2026_01_01.mp4");

        let back = from_archive_relative(&rel, &root);
        assert_eq!(dunce::canonicalize(back).unwrap(), video);
    }

    #[test]
    fn roundtrip_nested() {
        let dir = tempdir().unwrap();
        let root = dunce::canonicalize(dir.path()).unwrap();
        let nested = root
            .join("Videos")
            .join("2026")
            .join("01")
            .join("clip.mp4");
        touch(&nested);

        let rel = to_archive_relative(&nested, &root).unwrap();
        assert_eq!(rel, "Videos/2026/01/clip.mp4");

        let back = from_archive_relative(&rel, &root);
        assert_eq!(dunce::canonicalize(back).unwrap(), nested);
    }

    #[test]
    fn rejects_path_outside_archive() {
        let archive = tempdir().unwrap();
        let other = tempdir().unwrap();
        let archive_root = dunce::canonicalize(archive.path()).unwrap();
        let outsider = other.path().join("video.mp4");
        touch(&outsider);

        match to_archive_relative(&outsider, &archive_root) {
            Err(AppError::PathOutsideArchive { .. }) => {}
            other => panic!("expected PathOutsideArchive, got {other:?}"),
        }
    }

    #[test]
    fn rejects_archive_root_itself() {
        let dir = tempdir().unwrap();
        let root = dunce::canonicalize(dir.path()).unwrap();
        // Passing the root itself would yield an empty relative path,
        // which would then re-resolve back to the root — meaningless as
        // a video path.
        match to_archive_relative(&root, &root) {
            Err(AppError::Internal(msg)) => {
                assert!(msg.contains("empty"), "msg was: {msg}");
            }
            other => panic!("expected Internal, got {other:?}"),
        }
    }

    #[test]
    fn from_archive_relative_handles_forward_slash_on_native_os() {
        // The whole point of the storage convention: a string written
        // with forward slashes on Linux must reconstruct correctly on
        // Windows and vice versa. Path::join treats / as a separator
        // on every platform Rust supports.
        let dir = tempdir().unwrap();
        let root = dunce::canonicalize(dir.path()).unwrap();
        let target = root.join("Videos").join("Front").join("clip.mp4");
        touch(&target);

        let p = from_archive_relative("Videos/Front/clip.mp4", &root);
        assert_eq!(dunce::canonicalize(p).unwrap(), target);
    }

    #[cfg(windows)]
    #[test]
    fn windows_unc_root_is_handled() {
        // On Windows, dunce::canonicalize collapses \\?\ prefixes that
        // std::fs::canonicalize would leave in place. This test exists
        // mostly as a smoke check — if dunce ever stops doing that,
        // the strip_prefix call in to_archive_relative will silently
        // break on UNC archives. Run with `cargo test --target x86_64-pc-windows-msvc`.
        let dir = tempdir().unwrap();
        let root = dunce::canonicalize(dir.path()).unwrap();
        assert!(
            !root.to_string_lossy().starts_with(r"\\?\"),
            "dunce should strip the verbatim prefix; got {}",
            root.display()
        );
    }
}
