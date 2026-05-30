import type { Segment, Trip } from "../types/model";

/**
 * Recording mode of a clip. Dashcams that distinguish more than
 * "event vs normal" (notably 70mai) encode the mode in the filename;
 * everything else collapses to normal/event.
 */
export type RecordingMode = "normal" | "event" | "parking" | "lapse";

export const MODE_ORDER: RecordingMode[] = [
  "normal",
  "event",
  "parking",
  "lapse",
];

export const MODE_LABELS: Record<RecordingMode, string> = {
  normal: "Normal",
  event: "Event",
  parking: "Parking",
  lapse: "Time-lapse",
};

/** Last path component of a (possibly Windows or POSIX) path. */
function baseName(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] ?? "";
}

/**
 * Recording mode of a single segment. 70mai names every clip with a
 * two-letter mode prefix (`NO`/`EV`/`PA`/`LA`); for other cameras we
 * only know event vs normal, derived from the parsed event flag.
 */
export function segmentMode(seg: Segment): RecordingMode {
  if (seg.cameraKind === "seventyMai") {
    const name = baseName(seg.channels[0]?.filePath ?? "");
    switch (name.slice(0, 2).toUpperCase()) {
      case "NO":
        return "normal";
      case "EV":
        return "event";
      case "PA":
        return "parking";
      case "LA":
        return "lapse";
    }
  }
  return seg.isEvent ? "event" : "normal";
}

/** The set of recording modes present across a trip's segments. */
export function tripModes(trip: Trip): Set<RecordingMode> {
  const modes = new Set<RecordingMode>();
  for (const seg of trip.segments) {
    modes.add(segmentMode(seg));
  }
  return modes;
}
