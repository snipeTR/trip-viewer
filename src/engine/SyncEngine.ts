import { useStore } from "../state/store";
import { type CurveSegment, coverageAt, fileToConcat } from "../utils/speedCurve";

// How often to re-evaluate coverage gaps. Gaps are seconds-to-minutes
// long, so a coarse cadence is plenty — and crucially this runs on a
// timer, not `requestVideoFrameCallback`, because rVFC does not fire
// under the GStreamer playback pipeline on WebKitGTK (see the rVFC note
// below). A ~150 ms slip entering/leaving a gap is hidden by the black
// overlay and imperceptible given we don't drift-correct on WebKit.
const GAP_CHECK_INTERVAL_MS = 150;

const HARD_RESYNC_S = 0.15;
const SOFT_CORRECT_S = 0.04;
const SOFT_BIAS = 0.05;

// WebKit-based <video> pipelines (WebKitGTK + GStreamer on Linux,
// WKWebView + AVFoundation/Video Toolbox on macOS) implement any
// `currentTime=` assignment as a full pipeline flush + re-decode — far
// heavier than Chromium/Blink's frame-level scrub. Running our Chromium-
// tuned drift correction on these platforms causes a thrash loop: the
// slave never catches up inside HARD_RESYNC_S, so every tick re-flushes
// the pipeline, which starves the compositor (observed as a full GPU
// hang on AMD Vega 11 / VCN 1.0 under Linux, and as primary-view freezes
// with secondary-channel glitching on an M4 Mac mini).
//
// On these platforms we leave slaves free-running at the same
// playbackRate. All three channels come from the same firmware, same
// clock, same fps, so passive drift is in the microseconds-per-second
// range — imperceptible for dashcam playback. The drift HUD still
// reports live drift so we can confirm this empirically. Seeks and
// speed changes, which are one-shot and affect all three equally, are
// kept.
const SKIP_DRIFT_CORRECTION =
  typeof navigator !== "undefined" &&
  // WebKitGTK + GStreamer (Linux)
  ((navigator.userAgent.includes("Linux") &&
    !navigator.userAgent.includes("Android")) ||
    // WKWebView + AVFoundation (macOS)
    navigator.userAgent.includes("Mac OS X"));

// Stall watchdog. On the same WebKit-based pipelines that need
// SKIP_DRIFT_CORRECTION, a `play()` Promise can resolve before the
// decoder produces any frames past the first: the element reads
// `paused=false`, `readyState>=2`, and the UI shows the Pause button,
// but `currentTime` never advances. rVFC and `timeupdate` both go
// silent in that state — there is no event to react to — so we have
// to poll. Every WATCHDOG_INTERVAL_MS we sample each video's
// currentTime; if a video shows no progress for WATCHDOG_STALL_MS
// while not paused/ended, we kick it with pause()→play(), which
// forces GStreamer / AVFoundation to flush and reinit the pipeline.
// This mirrors the manual "pause then play again" workaround users
// hit on Linux.
const WATCHDOG_INTERVAL_MS = 500;
const WATCHDOG_STALL_MS = 1500;
const WATCHDOG_COOLDOWN_MS = 1500;
const ENABLE_STALL_WATCHDOG = SKIP_DRIFT_CORRECTION;

interface WatchdogEntry {
  /** Last sampled `currentTime` for this video. */
  lastTime: number;
  /** `performance.now()` of the most recent sample where `currentTime`
   *  actually differed from the previous sample. Compared against the
   *  current tick's `now()` to compute how long the video has been
   *  stuck on the same frame. */
  lastChangedAt: number;
  /** `performance.now()` of the most recent kick. Prevents a continuous
   *  storm of kicks while the pipeline takes a moment to recover. */
  lastKickAt: number;
}

export class SyncEngine {
  private master: HTMLVideoElement;
  private slaves: HTMLVideoElement[];
  private slaveLabels: string[];
  private disposed = false;
  private pauseIntentional = false;
  private cleanups: Array<() => void> = [];
  private watchdogState: WeakMap<HTMLVideoElement, WatchdogEntry> =
    new WeakMap();
  // Coverage curves for tiered playback. `masterCurve` maps the master's
  // file-time → concat-time (the trip clock); each `slaveCurves[i]` maps
  // concat-time → that slave's coverage. Null in Original mode / for
  // full-coverage channels (no gaps to handle).
  private masterCurve: CurveSegment[] | null;
  private slaveCurves: (CurveSegment[] | null)[];
  // Per-slave: does this channel have coverage gaps (camera off for part
  // of the trip)? A gappy channel's file is gap-closed and SHORTER than
  // the master's, so it lives on a different file-time axis — the
  // `slave.currentTime = masterT` drift correction is invalid for it and
  // must be skipped; it stays synced via free-run + gap hold/resume.
  private slaveGappy: boolean[];
  // Slaves WE paused for a coverage gap — so global pause/play and gap
  // hold/resume don't fight over the same element.
  private gapPaused: Set<HTMLVideoElement> = new Set();

  /** Total concat-seconds a curve covers (sum of segment spans). A
   *  full-coverage channel covers the whole trip; a gappy one covers
   *  less. */
  private static concatSpan(curve: CurveSegment[] | null): number {
    if (!curve) return 0;
    return curve.reduce((sum, s) => sum + (s.concatEnd - s.concatStart), 0);
  }

  constructor(
    master: HTMLVideoElement,
    slaves: HTMLVideoElement[],
    slaveLabels: string[] = [],
    masterCurve: CurveSegment[] | null = null,
    slaveCurves: (CurveSegment[] | null)[] = [],
  ) {
    this.master = master;
    this.slaves = slaves;
    // Pad/truncate labels to match slaves length so lookups are safe.
    this.slaveLabels = slaves.map((_, i) => slaveLabels[i] ?? `Slave ${i + 1}`);
    this.masterCurve = masterCurve;
    this.slaveCurves = slaves.map((_, i) => slaveCurves[i] ?? null);
    const masterSpan = SyncEngine.concatSpan(masterCurve);
    this.slaveGappy = this.slaves.map((_, i) => {
      const c = this.slaveCurves[i];
      if (!c || c.length === 0) return false;
      return SyncEngine.concatSpan(c) < masterSpan - 1.0;
    });
    this.attachPauseGuard();
    this.attachTimeUpdate();
    this.attachStallWatchdog();
    this.attachGapCheck();
  }

  start(): void {
    const speed = useStore.getState().speed;
    this.master.playbackRate = speed;
    this.slaves.forEach((s) => (s.playbackRate = speed));

    const tick: VideoFrameRequestCallback = (_now, meta) => {
      if (this.disposed) return;

      const masterT = meta.mediaTime;
      const store = useStore.getState();
      store.setCurrentTime(masterT);
      const speed = store.speed;

      const drifts: { label: string; driftMs: number }[] = [];
      for (let i = 0; i < this.slaves.length; i++) {
        const slave = this.slaves[i];
        if (slave.readyState < 2) continue;
        // Gappy slaves live on a different (shorter) file-time axis than
        // the master, so `currentTime = masterT` would be wrong. They're
        // kept in sync by free-run + the gap-check hold/resume instead.
        if (this.slaveGappy[i]) continue;
        const drift = slave.currentTime - masterT;
        drifts.push({
          label: this.slaveLabels[i],
          driftMs: Math.round(drift * 1000),
        });

        // On WebKit-based pipelines we deliberately do NOT correct drift
        // — see SKIP_DRIFT_CORRECTION comment at the top of the file. We
        // only record the reading so the drift HUD remains useful.
        if (SKIP_DRIFT_CORRECTION) continue;

        const absDrift = Math.abs(drift);
        if (absDrift > HARD_RESYNC_S) {
          slave.currentTime = masterT;
          slave.playbackRate = speed;
        } else if (absDrift > SOFT_CORRECT_S) {
          const bias = drift > 0 ? 1 - SOFT_BIAS : 1 + SOFT_BIAS;
          slave.playbackRate = speed * bias;
        } else if (slave.playbackRate !== speed) {
          slave.playbackRate = speed;
        }
      }

      if (store.showDriftHud) {
        store.setDrift(drifts);
      }

      this.master.requestVideoFrameCallback(tick);
    };

    this.master.requestVideoFrameCallback(tick);
  }

  dispose(): void {
    this.disposed = true;
    for (const fn of this.cleanups) fn();
    this.cleanups = [];
    // Drop any gap overlays this engine set so a stale black panel
    // doesn't linger after teardown / before the next engine paints.
    const store = useStore.getState();
    for (const label of this.slaveLabels) store.setChannelGapped(label, false);
    this.gapPaused.clear();
  }

  // Coverage-gap handling for tiered playback. On a timer (NOT rVFC —
  // dead under GStreamer playback on WebKitGTK), map the master's
  // file-time to concat-time, then for each slave with a curve decide
  // whether it has footage there: if not, hold it (pause + black
  // overlay); if so, resume a slave we held. No-op when there are no
  // slave curves (Original mode / all channels full-coverage).
  private attachGapCheck(): void {
    const masterCurve = this.masterCurve;
    if (!masterCurve || masterCurve.length === 0) return;
    if (!this.slaveCurves.some((c) => c && c.length > 0)) return;

    const tick = () => {
      if (this.disposed) return;
      if (this.master.readyState < 1) return;
      const concatT = fileToConcat(this.master.currentTime, masterCurve);
      const store = useStore.getState();
      const playing = store.isPlaying;
      for (let i = 0; i < this.slaves.length; i++) {
        const curve = this.slaveCurves[i];
        if (!curve || curve.length === 0) continue; // full-coverage slave
        const slave = this.slaves[i];
        const label = this.slaveLabels[i];
        const covered = coverageAt(concatT, curve).covered;
        if (!covered) {
          // In a gap: hold the slave on its last covered frame and show
          // black. The file is gap-closed, so it's already sitting where
          // playback resumes — no seek.
          if (!slave.paused) {
            this.gapPaused.add(slave);
            try {
              slave.pause();
            } catch {
              /* best-effort */
            }
          }
          store.setChannelGapped(label, true);
        } else {
          store.setChannelGapped(label, false);
          if (this.gapPaused.has(slave)) {
            this.gapPaused.delete(slave);
            // Resume only while globally playing. Un-pausing is a
            // contiguous continuation (no seek) — validated smooth on
            // WebKitGTK by the hold/resume spike.
            if (playing && slave.paused) slave.play().catch(() => {});
          }
        }
      }
    };

    const handle = setInterval(tick, GAP_CHECK_INTERVAL_MS);
    this.cleanups.push(() => clearInterval(handle));
    tick(); // paint the opening frame's coverage immediately
  }

  private attachPauseGuard(): void {
    const m = this.master;
    const onPause = () => {
      if (this.disposed || this.pauseIntentional) return;
      const { isPlaying } = useStore.getState();
      if (isPlaying && m.paused && !m.ended) {
        m.play().then(() => {
          this.slaves.forEach((s) => {
            if (s.paused && !s.ended) s.play().catch(() => {});
          });
        }).catch(() => {});
      }
    };
    m.addEventListener("pause", onPause);
    this.cleanups.push(() => m.removeEventListener("pause", onPause));
  }

  // Authoritative writer of store.currentTime. The rVFC tick in start()
  // ALSO writes the store, but on WebKitGTK (Linux) the rVFC callback
  // does not fire under the GStreamer playback pipeline — observed as a
  // permanently-zero timeline playhead and time counter during playback.
  // `timeupdate` is part of the HTML5 video spec and fires at ~4Hz on
  // every UA, which is plenty for the timeline indicator. On Chromium
  // (Windows) both fire; same-value writes don't churn React because
  // Zustand short-circuits identical state.
  private attachTimeUpdate(): void {
    const m = this.master;
    const onTimeUpdate = () => {
      if (this.disposed) return;
      useStore.getState().setCurrentTime(m.currentTime);
    };
    m.addEventListener("timeupdate", onTimeUpdate);
    m.addEventListener("seeked", onTimeUpdate);
    this.cleanups.push(() => {
      m.removeEventListener("timeupdate", onTimeUpdate);
      m.removeEventListener("seeked", onTimeUpdate);
    });
  }

  // Polls each video for a frozen `currentTime` while playback is
  // active and kicks any video that has stalled. See the file-level
  // ENABLE_STALL_WATCHDOG comment for why this exists. No-op outside
  // the WebKit-based platforms where the bug appears.
  private attachStallWatchdog(): void {
    if (!ENABLE_STALL_WATCHDOG) return;
    const handle = setInterval(() => {
      if (this.disposed) return;
      if (!useStore.getState().isPlaying) return;
      this.checkOne(this.master, "master");
      for (let i = 0; i < this.slaves.length; i++) {
        this.checkOne(this.slaves[i], this.slaveLabels[i]);
      }
    }, WATCHDOG_INTERVAL_MS);
    this.cleanups.push(() => clearInterval(handle));
  }

  private checkOne(v: HTMLVideoElement, label: string): void {
    // A paused / ended / not-yet-buffered video is not "stalled" —
    // forget any prior reading so the next live state starts fresh.
    if (v.paused || v.ended || v.readyState < 2) {
      this.watchdogState.delete(v);
      return;
    }
    const now = performance.now();
    const t = v.currentTime;
    const entry = this.watchdogState.get(v);
    if (!entry) {
      this.watchdogState.set(v, {
        lastTime: t,
        lastChangedAt: now,
        lastKickAt: 0,
      });
      return;
    }
    if (t !== entry.lastTime) {
      entry.lastTime = t;
      entry.lastChangedAt = now;
      return;
    }
    const stalledMs = now - entry.lastChangedAt;
    const sinceKickMs = now - entry.lastKickAt;
    if (stalledMs >= WATCHDOG_STALL_MS && sinceKickMs >= WATCHDOG_COOLDOWN_MS) {
      console.warn(
        `[sync] watchdog: ${label} stuck at ${t.toFixed(3)}s for ${Math.round(
          stalledMs,
        )}ms — kicking pipeline`,
      );
      entry.lastKickAt = now;
      this.kickStalled(v);
    }
  }

  private kickStalled(v: HTMLVideoElement): void {
    // pause()→play() forces WebKit's pipeline (GStreamer on Linux,
    // AVFoundation on macOS) to flush its decoder state. This is the
    // same operation the user performs manually to unstick a frozen
    // channel — automating it removes the workaround burden.
    //
    // For the master we must briefly suppress the pause-guard, which
    // otherwise tries to auto-resume on the pause event and races our
    // play() call.
    const isMaster = v === this.master;
    if (isMaster) this.pauseIntentional = true;
    try {
      v.pause();
    } catch {
      // ignore — pause is best-effort
    }
    v.play()
      .catch((e) => {
        console.warn("[sync] watchdog: kick play() rejected:", e);
      })
      .finally(() => {
        if (isMaster) this.pauseIntentional = false;
      });
  }

  async play(): Promise<void> {
    this.pauseIntentional = false;
    try {
      const speed = useStore.getState().speed;
      this.master.playbackRate = speed;
      this.slaves.forEach((s) => (s.playbackRate = speed));
      await this.master.play();
      await Promise.all(this.slaves.map((s) => s.play()));
      useStore.getState().setIsPlaying(true);
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      console.error("SyncEngine.play failed:", e);
      useStore.getState().setError(
        e instanceof Error ? e.message : "playback failed",
      );
    }
  }

  pause(): void {
    this.pauseIntentional = true;
    this.master.pause();
    this.slaves.forEach((s) => s.pause());
    useStore.getState().setIsPlaying(false);
  }

  seek(t: number): void {
    const duration = Number.isFinite(this.master.duration)
      ? this.master.duration
      : Infinity;
    const clamped = Math.min(Math.max(0, t), duration);
    this.master.currentTime = clamped;
    this.slaves.forEach((s) => (s.currentTime = clamped));
    useStore.getState().setCurrentTime(clamped);
  }

  setSpeed(rate: number): void {
    this.master.playbackRate = rate;
    this.slaves.forEach((s) => (s.playbackRate = rate));
  }
}
