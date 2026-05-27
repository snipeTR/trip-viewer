import { describe, expect, it } from "vitest";
import { type CurveSegment, coverageAt, fileToConcat } from "./speedCurve";

// A full-coverage (front) curve: contiguous, one event slowdown.
const contiguous: CurveSegment[] = [
  { concatStart: 0, concatEnd: 60, rate: 16 },
  { concatStart: 60, concatEnd: 75, rate: 1 },
  { concatStart: 75, concatEnd: 300, rate: 16 },
];

// A gappy (rear) curve: real footage over [0,30] and [90,300]; the
// camera was off over concat [30,90]. Note the [60,75] event from the
// trip curve is entirely inside the gap, so it's simply absent here.
const gappy: CurveSegment[] = [
  { concatStart: 0, concatEnd: 30, rate: 16 },
  { concatStart: 90, concatEnd: 300, rate: 16 },
];

describe("coverageAt — contiguous curve behaves like full coverage", () => {
  it("reports covered everywhere in range", () => {
    expect(coverageAt(0, contiguous).covered).toBe(true);
    expect(coverageAt(67, contiguous).covered).toBe(true); // inside the event
    expect(coverageAt(299, contiguous).covered).toBe(true);
  });
  it("maps file-time identically to fileToConcat's inverse at a segment edge", () => {
    // End of first 16x segment: 60 concat-s / 16 = 3.75 file-s.
    expect(coverageAt(60, contiguous).fileTime).toBeCloseTo(3.75, 5);
  });
});

describe("coverageAt — gappy curve", () => {
  it("is covered inside real ranges", () => {
    expect(coverageAt(10, gappy).covered).toBe(true);
    expect(coverageAt(200, gappy).covered).toBe(true);
  });
  it("is NOT covered inside the gap", () => {
    expect(coverageAt(31, gappy).covered).toBe(false);
    expect(coverageAt(60, gappy).covered).toBe(false);
    expect(coverageAt(89, gappy).covered).toBe(false);
  });
  it("holds at the gap's leading edge so resume is seamless (no seek)", () => {
    // First segment [0,30]@16x = 30/16 = 1.875 file-s. The gap should
    // hold exactly there, and the next covered frame (concat 90) is the
    // very next file frame — contiguous, no seek.
    const atGap = coverageAt(50, gappy);
    expect(atGap.covered).toBe(false);
    expect(atGap.fileTime).toBeCloseTo(1.875, 5);
    const afterGap = coverageAt(90, gappy);
    expect(afterGap.covered).toBe(true);
    expect(afterGap.fileTime).toBeCloseTo(1.875, 5); // resumes from the held position
  });
  it("treats before-first and after-last as gaps", () => {
    expect(coverageAt(-5, gappy).covered).toBe(false);
    expect(coverageAt(400, gappy).covered).toBe(false);
  });
  it("file-time is monotonic across the gap (gap-closed file)", () => {
    // Walking concat-time forward, the returned fileTime never goes
    // backwards — the held value equals the next covered start.
    const a = coverageAt(29, gappy).fileTime;
    const b = coverageAt(50, gappy).fileTime; // gap
    const c = coverageAt(91, gappy).fileTime;
    expect(b).toBeGreaterThanOrEqual(a - 1e-9);
    expect(c).toBeGreaterThanOrEqual(b - 1e-9);
  });
});

// Sanity: fileToConcat still round-trips on the contiguous curve.
describe("fileToConcat unaffected for contiguous curves", () => {
  it("inverts coverageAt within a segment", () => {
    const ft = coverageAt(120, contiguous).fileTime;
    expect(fileToConcat(ft, contiguous)).toBeCloseTo(120, 4);
  });
});
