/**
 * Speed-curve mapper: translates file-time (what the currently-playing
 * MP4 reports via `<video>.currentTime`) ↔ concat-time (trip-time,
 * seconds-from-trip-start with segment gaps collapsed).
 *
 * The curve is produced at encode time by the Rust
 * `speed_curve::build_curve` and persisted as JSON on the
 * `timelapse_jobs.speed_curve_json` column. The shape here matches the
 * backend's `CurveSegment` serialization exactly (camelCase).
 *
 * Curves are always non-empty and cover [0, totalConcatDuration]
 * contiguously. Each segment has a constant `rate` (concat-seconds per
 * file-second). For tier 8x: one segment at rate=8. For variable tiers:
 * alternating base and event rates around GPS-detected event windows.
 */

export interface CurveSegment {
  /** Concat-time start (seconds from trip start). */
  concatStart: number;
  /** Concat-time end (exclusive in practice; inclusive at trip end). */
  concatEnd: number;
  /** Concat-seconds per file-second. rate=8 means this segment
   *  compresses 8 seconds of trip time into 1 second of MP4. */
  rate: number;
}

/** Trip-total duration in concat-time for a curve. */
export function totalConcatDuration(curve: CurveSegment[]): number {
  if (curve.length === 0) return 0;
  return curve[curve.length - 1].concatEnd;
}

/** Trip-total duration in file-time for a curve (length of the MP4). */
export function totalFileDuration(curve: CurveSegment[]): number {
  let t = 0;
  for (const seg of curve) {
    t += (seg.concatEnd - seg.concatStart) / seg.rate;
  }
  return t;
}

/**
 * Map a file-time (what the video element reports) to concat-time
 * (trip-time). Clamped to [0, totalConcat] for out-of-range inputs.
 */
export function fileToConcat(
  fileTime: number,
  curve: CurveSegment[],
): number {
  if (curve.length === 0) return 0;
  if (fileTime <= 0) return curve[0].concatStart;

  let cumulativeFile = 0;
  for (const seg of curve) {
    const segFileSpan = (seg.concatEnd - seg.concatStart) / seg.rate;
    if (fileTime <= cumulativeFile + segFileSpan) {
      const offset = fileTime - cumulativeFile;
      return seg.concatStart + offset * seg.rate;
    }
    cumulativeFile += segFileSpan;
  }
  // Past the end — clamp to trip total.
  return curve[curve.length - 1].concatEnd;
}

/**
 * Map a concat-time (trip-time) to file-time (position in the MP4).
 * Clamped to [0, totalFile] for out-of-range inputs.
 */
export function concatToFile(
  concatTime: number,
  curve: CurveSegment[],
): number {
  if (curve.length === 0) return 0;
  if (concatTime <= curve[0].concatStart) return 0;

  let cumulativeFile = 0;
  for (const seg of curve) {
    if (concatTime <= seg.concatEnd) {
      const offset = concatTime - seg.concatStart;
      return cumulativeFile + offset / seg.rate;
    }
    cumulativeFile += (seg.concatEnd - seg.concatStart) / seg.rate;
  }
  // Past the trip end — clamp to file total.
  return cumulativeFile;
}

/**
 * Coverage gaps. A per-channel curve may be NON-contiguous: when a
 * camera (commonly the rear) is off for part of a trip, that channel's
 * timelapse is built from its real footage only, with no black filler,
 * so the curve has no segment over the missing concat-time range. A
 * "gap" is simply a discontinuity between consecutive segments
 * (`next.concatStart > prev.concatEnd`) beyond a small epsilon, plus the
 * spans before the first segment and after the last.
 *
 * Front (or any full-coverage channel) is contiguous, so it never has
 * gaps and `coverageAt` always reports `covered: true` in-range —
 * identical behavior to the pre-gap curves already on disk.
 */
const GAP_EPSILON_S = 0.05;

export interface Coverage {
  /** True when this channel has real footage at the given concat-time. */
  covered: boolean;
  /** File-time to use. When covered, the mapped position in the MP4.
   *  When in a gap, the position at the *leading edge* of the gap (the
   *  last covered frame) — where a held <video> should sit so that
   *  resuming on gap-exit continues contiguously with no seek. */
  fileTime: number;
}

/**
 * Map a concat-time to this channel's coverage: whether the channel has
 * footage there, and the file-time to use. The player holds + black-
 * overlays a channel while `covered` is false, and lets it free-run
 * while true. The file is gap-closed, so the `fileTime` returned at a
 * gap's leading edge is exactly where playback resumes on gap-exit.
 */
export function coverageAt(
  concatTime: number,
  curve: CurveSegment[],
): Coverage {
  if (curve.length === 0) return { covered: false, fileTime: 0 };
  let cumulativeFile = 0;
  for (const seg of curve) {
    // Before this segment's start (a gap, or before the first segment):
    // hold at the file position reached so far (end of prior coverage).
    if (concatTime < seg.concatStart - GAP_EPSILON_S) {
      return { covered: false, fileTime: cumulativeFile };
    }
    const segFileSpan = (seg.concatEnd - seg.concatStart) / seg.rate;
    if (concatTime <= seg.concatEnd + GAP_EPSILON_S) {
      const offset = Math.max(0, concatTime - seg.concatStart);
      return { covered: true, fileTime: cumulativeFile + offset / seg.rate };
    }
    cumulativeFile += segFileSpan;
  }
  // Past the last covered segment.
  return { covered: false, fileTime: cumulativeFile };
}

/**
 * Convenience: a single-segment curve at a constant rate covering
 * `totalDurationS` of concat-time. Used for the fallback when a
 * timelapse_jobs row has no persisted curve JSON (legacy data), and
 * as a trivial identity curve (rate=1) when needed.
 */
export function linearCurve(
  totalDurationS: number,
  rate: number,
): CurveSegment[] {
  return [
    {
      concatStart: 0,
      concatEnd: Math.max(0, totalDurationS),
      rate: Math.max(1, rate),
    },
  ];
}

/** Base rate (concat-seconds per file-second) for a fixed tier. Returns
 *  null for unknown labels. */
export function tierBaseRate(tier: string): number | null {
  if (tier === "8x") return 8;
  if (tier === "16x") return 16;
  if (tier === "60x") return 60;
  return null;
}

/** Schema version we know how to read. Mirrors Rust's
 *  `speed_curve::CURRENT_CURVE_VERSION`. Bump in lockstep when the
 *  segment shape or curve semantics change. */
const CURRENT_CURVE_VERSION = 1;

/**
 * Parse a JSON string (as persisted on `timelapse_jobs.speed_curve_json`)
 * into a curve, or return null if parsing fails or the shape is wrong.
 *
 * Accepts two shapes:
 *  - Versioned envelope: `{"version": N, "segments": [...]}` — what the
 *    current writer emits.
 *  - Bare array: `[...]` — legacy pre-versioning rows still on disk.
 *
 * Unknown future versions return null so the caller falls back to
 * `linearCurve` at the tier's base rate (same as any other parse fail).
 */
export function parseCurveJson(json: string | null | undefined): CurveSegment[] | null {
  if (!json) return null;
  let segments: unknown;
  try {
    const parsed = JSON.parse(json);
    if (Array.isArray(parsed)) {
      segments = parsed;
    } else if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as { version?: unknown }).version === "number" &&
      Array.isArray((parsed as { segments?: unknown }).segments)
    ) {
      if ((parsed as { version: number }).version !== CURRENT_CURVE_VERSION) {
        return null;
      }
      segments = (parsed as { segments: unknown[] }).segments;
    } else {
      return null;
    }
  } catch {
    return null;
  }
  if (!Array.isArray(segments) || segments.length === 0) return null;
  const valid = segments.every(
    (s) =>
      typeof s === "object" &&
      s !== null &&
      typeof (s as CurveSegment).concatStart === "number" &&
      typeof (s as CurveSegment).concatEnd === "number" &&
      typeof (s as CurveSegment).rate === "number" &&
      (s as CurveSegment).rate > 0 &&
      (s as CurveSegment).concatEnd >= (s as CurveSegment).concatStart,
  );
  return valid ? (segments as CurveSegment[]) : null;
}
