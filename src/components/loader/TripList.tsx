import { useMemo, useState } from "react";
import clsx from "clsx";
import { extractGpsBatch, loadTripGps } from "../../ipc/gps";
import { useStore } from "../../state/store";
import type { Trip } from "../../types/model";
import type { TimelapseJobRow } from "../../ipc/timelapse";
import { TripBadges } from "../sidebar/TripBadges";
import { TripActionsMenu } from "../trip/TripActionsMenu";
import { MergeTripsDialog } from "../trip/MergeTripsDialog";
import { formatBytes, formatTripStart } from "../../utils/format";
import {
  MODE_LABELS,
  MODE_ORDER,
  tripModes,
  type RecordingMode,
} from "../../utils/recordingMode";

function formatDuration(trip: Trip): string {
  const total = trip.segments.reduce((sum, s) => sum + s.durationS, 0);
  const mins = Math.floor(total / 60);
  const secs = Math.round(total % 60);
  return `${mins}m ${secs}s`;
}

/**
 * Sum segment sizes for a trip. Returns `null` when *any* segment has
 * an unknown size — partial totals would mislead, so we'd rather show
 * "—" until the next scan stamps the missing rows.
 */
function tripOriginalsBytes(trip: Trip): number | null {
  if (trip.segments.length === 0) return null;
  let total = 0;
  for (const seg of trip.segments) {
    if (seg.sizeBytes == null) return null;
    total += seg.sizeBytes;
  }
  return total;
}

function tripTimelapseBytes(
  tripId: string,
  jobs: TimelapseJobRow[],
): number | null {
  const tripJobs = jobs.filter(
    (j) => j.tripId === tripId && j.outputSizeBytes != null,
  );
  if (tripJobs.length === 0) return null;
  return tripJobs.reduce((sum, j) => sum + (j.outputSizeBytes ?? 0), 0);
}

export function TripList() {
  const trips = useStore((s) => s.trips);
  const selectedTripId = useStore((s) => s.selectedTripId);
  const selectTrip = useStore((s) => s.selectTrip);
  const markedForMerge = useStore((s) => s.markedForMerge);
  const clearMergeMarks = useStore((s) => s.clearMergeMarks);
  const timelapseJobs = useStore((s) => s.timelapseJobs);
  const reclaimableFilter = useStore((s) => s.reclaimableFilter);
  const setReclaimableFilter = useStore((s) => s.setReclaimableFilter);
  const reclaimableIds = useStore(
    (s) => s.librarySummary?.reclaimableTripIds ?? null,
  );
  const tripModeFilter = useStore((s) => s.tripModeFilter);
  const setTripModeFilter = useStore((s) => s.setTripModeFilter);
  const libraryFirstLoadDone = useStore((s) => s.libraryFirstLoadDone);
  const [showMergeDialog, setShowMergeDialog] = useState(false);

  const markedTrips = trips.filter((t) => markedForMerge.has(t.id));
  const canMerge = markedTrips.length >= 2;

  // Recording modes actually present in the library, in canonical order.
  // The mode filter row only appears when more than one mode exists.
  const presentModes = useMemo(() => {
    const seen = new Set<RecordingMode>();
    for (const t of trips) {
      for (const m of tripModes(t)) seen.add(m);
    }
    return MODE_ORDER.filter((m) => seen.has(m));
  }, [trips]);

  const visibleTrips = useMemo(() => {
    let result = trips;
    if (reclaimableFilter && reclaimableIds) {
      const allow = new Set(reclaimableIds);
      result = result.filter((t) => allow.has(t.id));
    }
    if (tripModeFilter !== "all") {
      result = result.filter((t) => tripModes(t).has(tripModeFilter));
    }
    return result;
  }, [trips, reclaimableFilter, reclaimableIds, tripModeFilter]);

  async function onSelectTrip(tripId: string) {
    selectTrip(tripId);
    const trip = useStore.getState().trips.find((t) => t.id === tripId);
    if (!trip) return;

    // Fast path: the timelapse encoder archives trip-stitched GPS in
    // the DB (migration 0012's trip_gps table). Use it when present so
    // the map + speed graph render even when originals are gone. An
    // empty result means "no row archived yet" — fall through to the
    // per-segment path which only succeeds when originals exist.
    try {
      const archived = await loadTripGps(tripId);
      if (archived.length > 0) {
        useStore.setState((s) => ({
          tripGpsByTrip: { ...s.tripGpsByTrip, [tripId]: archived },
        }));
        return;
      }
    } catch (e) {
      console.error("loadTripGps failed:", e);
    }

    // Archive-only trips have no segment files to extract from. Without
    // an archived GPS row they show an empty map — there's nothing to
    // fall back to since the originals are already trashed.
    if (trip.archiveOnly) return;

    // Fallback: extract from each segment's master channel file. The
    // backend dispatches to the right decoder per cameraKind.
    const requests = trip.segments
      .map((s) => {
        const path = s.channels[0]?.filePath;
        if (!path || !s.gpsSupported) return null;
        return { path, cameraKind: s.cameraKind };
      })
      .filter((r): r is { path: string; cameraKind: typeof trip.segments[0]["cameraKind"] } => r !== null);
    if (requests.length === 0) return;
    try {
      const results = await extractGpsBatch(requests);
      const gpsByFile = { ...useStore.getState().gpsByFile };
      for (const item of results) {
        gpsByFile[item.filePath] = item.points;
      }
      useStore.setState({ gpsByFile });
    } catch (e) {
      console.error("GPS extraction failed:", e);
    }
  }

  if (!libraryFirstLoadDone) {
    return (
      <div className="flex items-center gap-2 px-3 py-4 text-sm text-neutral-500">
        <span
          className="inline-block h-3 w-3 animate-pulse rounded-full bg-blue-500"
          aria-hidden
        />
        Loading library…
      </div>
    );
  }

  if (trips.length === 0) {
    return (
      <p className="px-3 py-4 text-sm text-neutral-500">
        No trips loaded. Open a folder to begin.
      </p>
    );
  }

  return (
    <>
      {presentModes.length > 1 && (
        <div className="flex flex-wrap gap-1 border-b border-neutral-800 px-2 py-2">
          <button
            onClick={() => setTripModeFilter("all")}
            className={clsx(
              "rounded px-2 py-0.5 text-xs font-medium",
              tripModeFilter === "all"
                ? "bg-blue-600 text-white"
                : "bg-neutral-800 text-neutral-300 hover:bg-neutral-700",
            )}
          >
            All
          </button>
          {presentModes.map((m) => (
            <button
              key={m}
              onClick={() => setTripModeFilter(m)}
              className={clsx(
                "rounded px-2 py-0.5 text-xs font-medium",
                tripModeFilter === m
                  ? "bg-blue-600 text-white"
                  : "bg-neutral-800 text-neutral-300 hover:bg-neutral-700",
              )}
            >
              {MODE_LABELS[m]}
            </button>
          ))}
        </div>
      )}
      {tripModeFilter !== "all" && visibleTrips.length === 0 && (
        <p className="px-3 py-4 text-sm text-neutral-500">
          No {MODE_LABELS[tripModeFilter].toLowerCase()} recordings.
        </p>
      )}
      {reclaimableFilter && (
        <div className="mx-2 mt-2 flex items-center gap-2 rounded-md border border-emerald-800 bg-emerald-950/60 px-2 py-1.5 text-xs text-emerald-200">
          <span className="flex-1">
            Showing {visibleTrips.length}{" "}
            {visibleTrips.length === 1 ? "trip" : "trips"} with reclaimable
            originals
          </span>
          <button
            onClick={() => setReclaimableFilter(false)}
            className="rounded px-2 py-0.5 text-emerald-300 hover:bg-emerald-900 hover:text-emerald-100"
            title="Show all trips again"
          >
            Clear
          </button>
        </div>
      )}
      {markedForMerge.size > 0 && (
        <div
          className={clsx(
            "mx-2 mt-2 flex items-center gap-2 rounded-md border px-2 py-1.5 text-xs",
            canMerge
              ? "border-sky-700 bg-sky-950/60 text-sky-200"
              : "border-neutral-700 bg-neutral-900 text-neutral-400",
          )}
        >
          <span className="flex-1">
            {markedForMerge.size}{" "}
            {markedForMerge.size === 1 ? "trip" : "trips"} marked
            {!canMerge && " · need 2+ to merge"}
          </span>
          <button
            onClick={() => setShowMergeDialog(true)}
            disabled={!canMerge}
            className={clsx(
              "rounded px-2 py-0.5 font-medium",
              canMerge
                ? "bg-sky-700 text-white hover:bg-sky-600"
                : "cursor-not-allowed bg-neutral-800 text-neutral-500",
            )}
            title={
              canMerge
                ? "Merge the marked trips into one"
                : "Mark at least one more trip to enable merge"
            }
          >
            Merge
          </button>
          <button
            onClick={() => clearMergeMarks()}
            className="rounded px-2 py-0.5 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
            title="Clear all marks"
          >
            Clear
          </button>
        </div>
      )}

      <ul className="flex flex-col gap-1 overflow-y-auto p-2">
        {visibleTrips.map((trip) => {
          const active = trip.id === selectedTripId;
          const archive = trip.archiveOnly === true;
          const marked = markedForMerge.has(trip.id);
          const archiveBytes = archive
            ? tripTimelapseBytes(trip.id, timelapseJobs)
            : null;
          const originalsBytes = archive ? null : tripOriginalsBytes(trip);
          return (
            <li key={trip.id}>
              <div
                className={clsx(
                  "group relative flex items-start rounded-md transition-colors",
                  active
                    ? "bg-neutral-700 text-white"
                    : "text-neutral-300 hover:bg-neutral-800",
                  // Marked trips get a sky-blue ring so the user can
                  // see the selection at a glance, even as they scroll
                  // away from the kebab they used to mark.
                  marked && "ring-1 ring-inset ring-sky-500",
                )}
              >
                <button
                  onClick={() => void onSelectTrip(trip.id)}
                  className="flex-1 px-3 py-2 text-left text-sm"
                >
                  <div className="flex items-center gap-2 pr-7 font-medium">
                    <span>{formatTripStart(trip.startTime)}</span>
                    {archive && (
                      <span
                        className="rounded-sm bg-amber-900/60 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-200"
                        title="Original files have been deleted; only the timelapse archive remains."
                      >
                        Archive
                      </span>
                    )}
                    {marked && (
                      <span
                        className="rounded-sm bg-sky-900/60 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sky-200"
                        title="Marked for merge"
                      >
                        Merge
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-neutral-500">
                    {archive
                      ? `Timelapse only · ${formatBytes(archiveBytes)}`
                      : `${trip.segments.length} ${trip.segments.length === 1 ? "segment" : "segments"} · ${formatDuration(trip)} · ${formatBytes(originalsBytes)}`}
                  </div>
                  <TripBadges tripId={trip.id} />
                </button>
                <div className="absolute right-1 top-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                  <TripActionsMenu trip={trip} />
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      {showMergeDialog && canMerge && (
        <MergeTripsDialog
          marked={markedTrips}
          onClose={() => setShowMergeDialog(false)}
        />
      )}
    </>
  );
}
