# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Development (hot-reload, ~10s incremental Rust builds)
npm run tauri dev

# Production build (creates NSIS installer at src-tauri/target/release/bundle/nsis/)
npm run tauri build

# Type-check TypeScript
npx tsc --noEmit

# Rust tests (35+ unit tests, mostly in src-tauri/src/import/ and src-tauri/src/scan/)
cargo test --manifest-path src-tauri/Cargo.toml

# Run a single Rust test (example)
cargo test --manifest-path src-tauri/Cargo.toml test_copy_and_hash_matches_hash_file

# Clippy (should be zero warnings — enforce this)
cargo clippy --manifest-path src-tauri/Cargo.toml -- -W clippy::all
```

## Architecture

Trip Viewer is a **Tauri v2** desktop app: Rust backend (`src-tauri/src/`) communicates with a React/TypeScript frontend (`src/`) via Tauri commands and events. Targets Windows (NSIS installer) and Linux (AppImage; Flatpak planned). Windows is the primary development platform; the Linux port relies on WebKitGTK 4.1 and GStreamer for video rendering.

### Rust backend module map

- **`scan/`** — folder scanner. `naming.rs` holds a **modular, multi-format filename parser** (`scan/naming.rs`): Wolf Box (`YYYY_MM_DD_HHMMSS_EE_C.MP4`), Thinkware (`REC_/EVT_...`), Miltona (`FILE…`), 70mai (`NO/EV/PA/LA{YYYYMMDD}-{HHMMSS}-{serial}{F|B}.MP4`), and a generic 4-channel fallback. Each parser yields an `EventMode` (Normal / Event / **Parked** / **Lapse** / Other) and a `CameraKind`. `grouping.rs` fuzzy-matches a segment's channels within a 3-second window and merges segments into trips with a 120s gap threshold. Uses `rayon` for parallel metadata probing. **To add a camera, add a parser here** — see `ADDING_A_CAMERA.md`.
- **`gps/`** — per-`CameraKind` GPS dispatch (`gps/mod.rs::extract_for_kind`). Decoders: `shenshu.rs` (Wolf Box — reverse-engineered ShenShu MetaData, NMEA DDMM.MMMM from the `gpmd` track), `miltona.rs` (NovaTek `gps0` atom), and `seventy_mai.rs` (70mai — parses the `GPSData*.txt` plain-text sidecar at the card/library root, matching rows to a clip by filename and deriving speed/heading from successive fixes; also falls back to an `Other/` subfolder for libraries imported before the sidecar was recognized). Thinkware returns no GPS. The frontend's `interpolate.ts` filters void fixes and **dead-reckons up to 2s** through brief dropouts.
- **`metadata/`** — MP4 probe using the `mp4` crate (pure Rust, **no ffprobe dependency** — this is a locked decision, see DESIGN.md).
- **`import/`** — SD card import pipeline (10 submodules). **Safety-critical**: files are SHA-256 hashed during copy, re-hashed on the destination, and the source is only wiped after every file is verified **and the user confirms**. The pipeline blocks on the frontend for three prompt types via dedicated mpsc channels (`resolve_unknowns`, `resolve_wipe_error`, `resolve_wipe_confirm`). See "Import pipeline invariants" below.
- **`timelapse/`** — background ffmpeg-driven pre-render pipeline that produces 8x / 16x / 60x fast-playback MP4s per (trip, tier, channel). ffmpeg is an opt-in user dependency (configured via the `settings` table, not bundled). NVENC + NVDEC path is used when available; see `ffmpeg.rs::Encoder::needs_cuda_hwaccel`. **Event-detection thresholds for the variable-speed 16x/60x tiers live in `events.rs` — see that module's top-of-file doc comment for how to verify the slowdown behavior after a run and how to tune thresholds.**
- **`error.rs`** — `AppError` enum with `thiserror`; implements `Serialize` for automatic JSON conversion to the frontend.

### Frontend structure

- **`App.tsx`** — sidebar (trip list, SD + folder import buttons, storage summary, version footer) plus a top tab bar (`MainNavTabs`) that switches between Player, Scan, Review, Timelapse, optional Issues, and Places. The Issues tab only renders when there are scan errors; Places lives at the right of the bar. The sidebar is **collapsible** (`sidebarCollapsed` local state → a thin strip with an expand chevron). The keyboard-shortcuts overlay **auto-opens on startup** unless `localStorage[SKIP_SHORTCUTS_KEY]` is set. Import prompt dialogs mounted here: `UnknownFilesDialog`, `WipeErrorDialog`, `WipeConfirmDialog`.
- **`components/loader/TripList.tsx`** — sidebar trip list. Shows a **recording-mode filter** row (All / Normal / Event / Parking / Time-lapse) when the library has more than one mode; the mode is derived client-side from the filename via `utils/recordingMode.ts` (no DB column), and the store holds `tripModeFilter`.
- **`components/video/`** — `VideoGrid`, `ChannelPanel`, `PlayerShell`. The grid renders one `<video>` per channel reported by the active segment (1 to 4). Channels are **always rendered in stable DOM order** for the dashcam's kind set; swap behavior uses CSS grid placement only. Moving them in the tree would cause React to unmount/remount the `<video>` elements and pause playback. `PlayerShell` decides the map slot via `decideShowMap.ts`; for **two-channel** segments it passes the map as `VideoGrid`'s `mapSlot` (tucked under the rear view) so the front grows to 2/3 width.
- **`components/map/`** — `MapPanel`, `VehicleMarker`, `TrackPolyline`. Two opt-in assist toggles (`MapPanel` local state) — **Lock centre** (recenter on the vehicle each tick) and **Auto-zoom** (zoom from speed) — drive `VehicleMarker`; a genuine drag / wheel / double-click gesture turns both off and restores the default leap-frog follow. Void GPS fixes are filtered out before they reach the marker/track.
- **`components/import/`** — confirm dialog, progress UI, unknown files dialog, summary. Progress events stream from Rust via `window.emit()`, frontend listens with `@tauri-apps/api/event`. There are two import flows: SD-card (destructive, wipes source) and folder (non-destructive).
- **`components/timelapse/`** — Timelapse Library view, ffmpeg config modal, per-trip rebuild, scope picker (new & unfinished / retry failed / rebuild all).
- **`engine/useSyncEngine.ts`** — video sync engine. Uses `requestVideoFrameCallback` against a stable master ref (front when present, otherwise the first channel); other channels are slaved to it. Master ref is the timing master regardless of which channel is visually primary.
- **`state/store.ts`** — Zustand store with `LibrarySlice`, `PlaybackSlice`, `ImportSlice`, plus timelapse state. `primaryChannel` controls layout but not sync.

## Locked architectural decisions (do not revisit without strong reason)

See DESIGN.md for full context. Key ones:

- **HTML5 `<video>` for playback** (not libmpv). `tauri-plugin-libmpv` is broken for multi-instance on Windows.
- **Pure Rust `mp4` crate** (not ffprobe). Bundling ffprobe adds 80 MB and triggers Defender heuristics.
- **HEVC Extension tax accepted** — app uses a `<HevcSupportGate>` startup check with Store deep-link on Windows, and an apt-install hint on Linux when GStreamer's libav plugin is missing.
- **NSIS on Windows, AppImage on Linux (Flatpak planned).** MSI rejected (~130 MB vs 3 MB NSIS). `.deb` skipped — AppImage bundles its own GStreamer plugins for codec-complete direct downloads. A future Flatpak would reach Debian/Ubuntu/Fedora/Arch with bundled codecs via `org.freedesktop.Platform.ffmpeg-full`, but no Flathub manifest exists yet.
- **No fullscreen API on single-click** — use double-click (conflict with play/pause expectation).

## Import pipeline invariants

The SD card import pipeline in `src-tauri/src/import/` has strict safety guarantees. Do not break these:

1. **Verify → confirm → wipe**: `wipe_source()` only runs if `manifest.iter().all(|e| e.verified)`, not cancelled, not read-only, **and** the user answered "Erase" to the post-copy `import:confirmWipe` prompt (`prompt_wipe_confirm`). Declining (or a torn-down prompt) leaves the card untouched; distribute still runs so the verified copies reach the library.
2. **Self-import guard**: `start_import` refuses any source that is, contains, or sits inside the destination library (`guard_against_self_import`). Without this, pointing the library at the SD card itself made the wipe delete the just-staged copies. Defense-in-depth: stage AND wipe walks skip dot-prefixed directories (`.staging`, `.tripviewer`, `.logs`, and proxy folders like 70mai's `.s_Front`).
3. **Wipe-error prompt**: a failed delete during the wipe emits `import:wipeError` and blocks on Retry / Skip / Cancel (`resolve_wipe_error`) instead of silently aborting. Cancel stops the wipe but keeps distributing.
4. **GPS sidecar placement**: `GPSData*.txt` is kept at the library root during distribute (not quarantined to `Other/` as an unknown file) so the 70mai decoder can find it.
5. **Cancel safety**: cancel flag is checked between every file operation. Cancel during staging → source NOT wiped.
6. **Lock file with PID recovery**: `<root>/.staging/.lock` contains the PID. On startup, if the PID is dead (verified via Windows `OpenProcess`), the stale lock is reclaimed.
7. **Hash-while-copy**: single-pass SHA-256 via explicit loop (no `TeeReader` in Rust std). Destination is re-hashed independently to detect storage corruption.
8. **Sequential phases**: pre-flight → stage → confirm → wipe → distribute → unknowns → cleanup. Each source is processed fully before the next.
9. **PreAllocFiles are skipped during staging** (not just deleted after) — they'd inflate progress counters and waste copy time.
10. **Import root adjustment**: if the user-supplied `root_path` ends in `/Videos`, the parent is used as the import root. Videos/ and Photos/ are siblings at the root.

## Video layout rules

1. Every channel reported by the active segment gets a `<ChannelPanel>` and stays mounted — hidden via CSS grid placement, not conditional rendering. Channel count is dashcam-dependent (1 for Miltona, 2 for Thinkware and 70mai, 3 for Wolf Box, up to 4 for Generic).
5. Two-channel segments place the map under the rear view (`VideoGrid` `mapSlot`, a `grid-cols-[2fr_1fr]` outer layout); 1/3/4-channel segments give the map its own column. The map slot itself is gated by `decideShowMap` (false for no-GPS cameras and archive-only trips without persisted GPS).
2. Refs are **stable per channel kind**, never swapped. The sync engine depends on this.
3. Audio follows `isMaster` prop (which tracks `primaryChannel`); sync timing is always driven by the master ref (front when the dashcam has one, otherwise the first channel).
4. On trip/segment change, `primaryChannel` resets to `null` in the store action; `VideoGrid` then sets it to the new segment's master channel.

## Event system (Rust → frontend)

The import pipeline emits these events via `app.emit()`: `import:phase`, `import:progress`, `import:warning`, `import:unknowns`, `import:wipeError`, `import:confirmWipe`, and `import:complete`. The three interactive ones (`unknowns`, `wipeError`, `confirmWipe`) pause the pipeline until the frontend answers through the matching `resolve_*` command. Progress events are **throttled to ~15/sec** (66ms minimum between emits) to avoid IPC saturation. See `types.rs` for payload shapes.

## Related documents

- **DESIGN.md** — architecture decisions, ruled-out options, tech stack, future roadmap
- **ADDING_A_CAMERA.md** — bilingual (EN/TR) user guide for capturing an SD card's layout (`dir.txt` + `tree.txt`) to request a new camera format; the parser entry point is `scan/naming.rs`
- **RELEASING.md** — how to cut a release, version bumping, GitHub Actions workflow, SignPath code signing roadmap
- **LINUX_DEV_SETUP.md** — Linux dev environment setup (distrobox recipe for atomic distros like Bazzite/Silverblue, plus direct-install steps for Fedora/Ubuntu/Arch)
- **README.md** — user-facing documentation
