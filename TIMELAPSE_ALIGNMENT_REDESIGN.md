# Timelapse Channel Alignment — Metadata-Driven Redesign

Status: **implemented** (2026-05-27). Drafted while diagnosing the May 18 2026 trip,
where the rear channel ran ~72 s (16×) shorter than front/interior and raced ahead of
it during playback. The kill-switch spike (a dev-only `HoldSpike` component, since
removed) validated that hold+overlay+resume is hitch-free on WebKitGTK (~5 ms resume).

## Why

Two recurring pains share one root cause:

1. **Channel desync when a camera is off mid-trip.** The rear cam (commonly) stops
   recording for stretches. To keep the three per-channel timelapse files the same
   length, the encoder bakes **black filler** clips into the short channel. That
   filler is fragile — it gets dropped during the variable-speed concat — and the
   channel ends up shorter, so it drifts ahead of the others.
2. **Every alignment bug costs hours of re-encoding**, because the fix lives in the
   pixels.

Root cause: **channel alignment is baked into the encoded video.** Cheap,
frequently-wrong logic (alignment) is welded to expensive, stable work (encoding),
so we pay the expensive cost every time the cheap part breaks.

## Goal

Make per-channel timelapses **self-consistent files aligned at playback via
metadata**, so an alignment bug costs a metadata regen (milliseconds) instead of a
re-encode (hours) — while preserving the **smooth single-file playback** that makes
the timelapse better than the Originals.

## Non-goals (explicitly out of scope)

- **Speed-ramp encoding is unchanged.** An event/GPS bug that changes the ramp still
  requires a re-encode. The ramp stays baked because `playbackRate` can't reach 1×
  from a 60× source (browsers floor around 0.0625×).
- **Merge concatenation is unchanged.** Merges still produce a per-channel file.
- **The Originals' segment-boundary skipping is untouched.** That's a separate
  problem (the player switches `<video>` sources at each boundary → GStreamer
  pipeline rebuild → hitch, worst on WebKitGTK). Its real fix is gapless sequential
  playback via MSE, and HEVC-in-MSE on WebKitGTK is uncertain. Out of scope here.
- **Per-segment timelapse clips are rejected.** They reproduce exactly the Originals'
  source-switch skipping, on the platform where it's already worst. The timelapse is
  smooth *because* it's one continuous file per channel; we keep that.

## Core idea

For each `(trip, tier, channel)`:

- Encode **only that channel's real footage** into one continuous file. No black
  filler. The file stays a clean, gap-closed stream.
- Record a per-channel **coverage map** (metadata): which *global trip concat-time*
  ranges the channel covers, and how each maps to file-time and rate. Concat-time
  ranges absent from the map are **gaps** (camera was off).
- At playback, all channels are driven off the **master's global concat-time**. In a
  channel's gap, the player **holds that channel and draws black over its panel** —
  no seek, no source switch — so it stays smooth. Because the file is gap-closed, the
  frame after a gap is contiguous, so resuming is an un-pause, not a seek.

This is how the Original "just deals" (front is the spine, others attach where they
have footage) — but achieved without switching video sources, so it stays smooth.

## Data model

`timelapse_jobs` keeps **one row per `(trip, tier, channel)`** (unchanged).

The existing `speed_curve_json` generalizes into a **coverage map**. Today an entry
is `{ concatStart, concatEnd, rate }` and file-time is *derived* by accumulating
`(concatEnd-concatStart)/rate`. That derivation assumes no gaps. New entry shape:

```jsonc
{
  "version": 2,
  "tripConcatDurationS": 9670.4,   // full trip timeline (front coverage)
  "segments": [
    // contiguous in fileTime (gap-closed); may jump in concatTime (gaps between entries)
    { "concatStart": 0.0,    "concatEnd": 540.0,  "fileStart": 0.0,   "fileEnd": 33.75, "rate": 16 },
    { "concatStart": 540.0,  "concatEnd": 555.0,  "fileStart": 33.75, "fileEnd": 48.75, "rate": 1  },
    // ... gap from 555.0 -> 1290.0 (rear off): NO entry covers it
    { "concatStart": 1290.0, "concatEnd": 1470.0, "fileStart": 48.75, "fileEnd": 60.0,  "rate": 16 }
  ]
}
```

- **Front** (full coverage): entries are contiguous in *both* concat and file —
  identical to today's curve, plus explicit `fileStart/fileEnd`.
- **Non-front** (gaps allowed): entries are contiguous in *file*, with jumps in
  *concat* wherever the camera was off.

Add a `timelapse_format_version` (a single Rust const compared per row, mirroring
`GPS_PARSER_VERSION`) so old files get rebuilt exactly once on migration.

## Encode changes (`src-tauri/src/timelapse/worker.rs`, `ffmpeg.rs`)

1. `resolve_channel_sources`: replace `ConcatEntry::MissingPlaceholder { duration_s }`
   with `ConcatEntry::Gap { concat_start, concat_end }`. The source list passed to
   ffmpeg becomes **real siblings only**.
2. Build the per-channel curve = the trip curve **intersected with covered ranges**;
   emit `fileStart/fileEnd` per entry as the encode lays footage down back-to-back.
3. Encode the real footage in the existing pipeline (multi-window stays — see note).
4. Persist the coverage map to `timelapse_jobs.speed_curve_json` (v2).
5. **Delete** `generate_black_placeholder` and the `software_input` forced-CPU path
   that existed *only* to survive the placeholder→real boundary on NVDEC. This also
   retires the NVDEC concat-placeholder limitation we documented earlier.

> Note on multi-window: the per-channel file is still built as a stream-copy concat
> of speed-windows (kept for the 12–36 GB OOM reason). That's fine — you confirmed
> the *timelapse* splices don't cause the skipping; only the Originals' *source
> switches* do. Removing black filler is orthogonal to the multi-window encode.

## Player / sync changes (`src/engine/`, `src/utils/speedCurve.ts`, `MapPanel`, grid)

1. `speedCurve.ts`: `concatToFile` / `fileToConcat` learn the v2 shape. `concatToFile`
   returns either a file-time **or** a `gap` sentinel when no entry covers the
   concat-time.
2. Sync engine: master plays continuously over global concat-time. For each slave
   channel at master concat-time `T`:
   - **Covered** → set `currentTime`/`playbackRate` as today; show video.
   - **Gap** → pause the slave (hold its frame) and show a black overlay on the
     panel. No seek.
   - **Gap → covered** → un-pause. The next frame is contiguous in the gap-closed
     file, so no seek/reload.
3. Black overlay = a CSS layer over the (always-mounted) channel panel — no
   unmount/remount of the `<video>`.

## Migration

- Bump `timelapse_format_version`. Channels below it are flagged for **one** rebuild
  (produces the real-only file + coverage map). The existing startup background
  runner already does staged rebuilds; reuse it.
- This is the **last forced re-encode for alignment**. After it, every alignment /
  missing-camera bug is a coverage-map regen (no pixels touched).

## Risks & validation

1. **WebKitGTK smoothness of hold+overlay.** ✅ **VALIDATED (2026-05-27)** by a dev-only
   spike (a `HoldSpike` component, run in-app via an env flag; since removed) that
   pause+black-overlaid a real HEVC timelapse channel for 3s every 4s and resumed it,
   measuring resume latency by polling `currentTime`. Result on WebKitGTK/GStreamer:
   worst resume **5ms** across 6 cycles, *below* the 22ms free-play baseline jitter —
   i.e. no pipeline flush, no perceptible hitch. The kill-switch assumption holds.
   (Real `currentTime=` seeks remain expensive per `SyncEngine.ts`; the design avoids
   them by keeping each channel's file gap-closed so resume is an un-pause, not a seek.)
2. **Edge drift** if pause/un-pause timing at a gap boundary is imprecise. Bound it
   by snapping to the coverage map and re-syncing on the first covered frame after the
   gap (which is contiguous, so cheap).
3. **Coverage-map completeness guard** at metadata-gen time: for every channel,
   `Σ covered + Σ gaps == tripConcatDurationS`, and entries are monotonic in
   fileTime. This catches alignment regressions *before* they ever reach playback —
   the failure mode the current design only reveals by eye, hours later.

## Phasing

1. ✅ **Spike** the hold+overlay smoothness on Linux (kill-switch) — *done, passed
   (worst resume 5ms).*
2. Encode side: emit real-only files + coverage maps behind the format-version bump.
3. Player side: consume maps; hold + black-overlay in gaps.
4. Delete the black-placeholder + forced-CPU code paths.
5. Migrate (one rebuild pass), then alignment is metadata forever.

## What this fixes vs. leaves

| Pain | Before | After |
|---|---|---|
| Rear/interior desync from missing camera | baked black, fragile | metadata, robust |
| Fixing an alignment bug | hours (re-encode) | milliseconds (regen map) |
| Wasted black on disk | yes | none |
| Smooth playback | yes | **still yes** |
| Event/GPS ramp bug | re-encode | re-encode (unchanged) |
| Merge concat | re-encode/concat | unchanged |
| Originals' boundary skipping | present | unchanged (separate effort) |
