import { describe, expect, it } from "vitest";
import { classifySwingLevels, mapSwingStructure, zigzagPoints } from "./smcSwingStructure";

// A bar is [open, high, low, close]. All fixtures use a swing length of 1 to stay short.
type Bar = [number, number, number, number];

const day = (i: number) => new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10);
const bars = (rows: Bar[]) => rows.map(([open, high, low, close], i) => ({ date: day(i), open, high, low, close }));
const mirror = (rows: Bar[]): Bar[] => rows.map(([o, h, l, c]) => [200 - o, 200 - l, 200 - h, 200 - c]);
const run = (rows: Bar[], opts = {}) => mapSwingStructure(bars(rows), { length: 1, ...opts });

// Swing high 13 (bar 1), swing low 8 (bar 3), then a close above 13 and a close below 8.
const UP_THEN_DOWN: Bar[] = [
  [10, 11, 9, 10],
  [10, 13, 10, 12],
  [12, 12, 10, 11],
  [11, 11.5, 8, 9],
  [9, 11, 9, 10],
  [10, 14, 10, 14],  // body close above the swing high 13
  [14, 15, 7, 7],    // body close below the swing low 8
];

describe("mapSwingStructure", () => {
  it("marks a BOS on the first break and a ChoCH when price breaks back the other way", () => {
    const { events } = run(UP_THEN_DOWN);
    expect(events.map((e) => [e.type, e.direction, e.level, e.fromDate, e.date])).toEqual([
      ["BOS", "bullish", 13, day(1), day(5)],
      ["ChoCH", "bearish", 8, day(3), day(6)],
    ]);
  });

  it("mirrors for a down-trend", () => {
    const { events } = run(mirror(UP_THEN_DOWN));
    expect(events.map((e) => [e.type, e.direction])).toEqual([["BOS", "bearish"], ["ChoCH", "bullish"]]);
  });

  it("needs a body close to break by default, and accepts a wick in wick mode", () => {
    const wickOnly: Bar[] = UP_THEN_DOWN.slice(0, 5).concat([[10, 14, 10, 12]]); // wick to 14, closes at 12
    expect(run(wickOnly).events).toEqual([]);
    expect(run(wickOnly, { breakOn: "wick" }).events.map((e) => [e.type, e.direction])).toEqual([["BOS", "bullish"]]);
  });

  it("breaks each swing once", () => {
    const { events } = run([...UP_THEN_DOWN.slice(0, 6), [14, 16, 13, 15], [15, 17, 14, 16]]);
    expect(events.filter((e) => e.level === 13)).toHaveLength(1);
  });

  it("does not use a swing before it is confirmed", () => {
    // Bar 1 is only a swing high once bar 2 has closed lower; a close above 13 on bar 2 itself is not a break of it.
    const { events } = run([[10, 11, 9, 10], [10, 13, 10, 12], [12, 15, 11, 14]]);
    expect(events).toEqual([]);
  });

  it("tags higher highs and higher lows against the previous swing", () => {
    const rows: Bar[] = [
      [10, 11, 9, 10],
      [10, 13, 10, 12],
      [12, 12, 9, 10],
      [10, 14, 10, 13],
      [13, 13, 11, 12],
      [12, 12, 10.5, 11],
      [11, 12, 11, 12],
    ];
    const { points } = run(rows);
    expect(points.map((p) => [p.type, p.date, p.price])).toEqual([
      ["HH", day(3), 14],
      ["HL", day(5), 10.5],
    ]);
  });

  it("returns nothing for too little data", () => {
    expect(run(UP_THEN_DOWN.slice(0, 3))).toEqual({ events: [], points: [], legs: [] });
  });
});

describe("classifySwingLevels", () => {
  // Peaks (every second bar) at 10, 13, 11, 15, 12, 14, 11 between valleys at 8.
  const highs = [8, 10, 8, 13, 8, 11, 8, 15, 8, 12, 8, 14, 8, 11, 8];
  const rows = highs.map((h) => [h - 0.5, h, h - 1, h - 0.5] as Bar);

  it("promotes a swing high with a lower swing high each side to ITH, and an ITH with lower ITHs each side to LTH", () => {
    const levels = Object.fromEntries(
      classifySwingLevels(bars(rows), 1).filter((s) => s.side === "high").map((s) => [s.index, s.level]),
    );
    expect(levels).toEqual({ 1: "S", 3: "I", 5: "S", 7: "L", 9: "S", 11: "I", 13: "S" });
  });

  it("mirrors for lows", () => {
    const flipped = rows.map(([o, h, l, c]) => [200 - o, 200 - l, 200 - h, 200 - c] as Bar);
    const levels = Object.fromEntries(
      classifySwingLevels(bars(flipped), 1).filter((s) => s.side === "low").map((s) => [s.index, s.level]),
    );
    expect(levels).toEqual({ 1: "S", 3: "I", 5: "S", 7: "L", 9: "S", 11: "I", 13: "S" });
  });
});

describe("zigzagPoints", () => {
  const peaks = [8, 10, 8, 13, 8, 11, 8, 15, 8, 12, 8, 14, 8, 11, 8].map((h) => [h - 0.5, h, h - 1, h - 0.5] as Bar);

  it("joins the swings as one alternating high / low line", () => {
    const zz = zigzagPoints(bars(peaks), 1);
    expect(zz.map((p) => p.index)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
    expect(zz.map((p) => p.side)).toEqual(zz.map((_, i) => (i % 2 === 0 ? "high" : "low")));
  });

  it("keeps the more extreme of two swing highs with no swing low between them", () => {
    const rows: Bar[] = [
      [9, 9.5, 7.5, 9],
      [9, 10, 8, 9.5],      // swing high 10
      [9, 9, 8.5, 8.8],
      [9, 11, 9, 10.5],     // swing high 11, and the lows in between never make a swing low
      [10, 10.5, 9.5, 10],
    ];
    const zz = zigzagPoints(bars(rows), 1);
    expect(zz.map((p) => [p.index, p.price])).toEqual([[3, 11]]);
  });
});
