import { describe, expect, it } from "vitest";
import { detectCisd } from "./smcCisd";

const day = (i: number) => new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10);
const bars = (rows: [number, number][]) => rows.map(([open, close], i) => ({ date: day(i), open, close }));

describe("detectCisd", () => {
  it("fires bullish when a body closes above the open of the first candle in the down run", () => {
    // down run opens 20 -> 18 -> 16; a close of 19 stays under 20, a close of 21 is above it
    const found = detectCisd(bars([[20, 18], [18, 16], [16, 19], [19, 21]]));
    expect(found).toEqual([{ date: day(3), level: 20, fromDate: day(0), direction: "bullish" }]);
  });

  it("fires bearish for the mirror case", () => {
    const found = detectCisd(bars([[10, 12], [12, 14], [14, 11], [11, 9]]));
    expect(found).toEqual([{ date: day(3), level: 10, fromDate: day(0), direction: "bearish" }]);
  });

  it("ignores a close exactly at the level (a wick-style touch does not count)", () => {
    expect(detectCisd(bars([[20, 18], [18, 20]]))).toEqual([]);
  });

  it("fires once per run, and a new run replaces the level", () => {
    const found = detectCisd(bars([[20, 18], [18, 21], [21, 23], [23, 20], [20, 17]]));
    // bar 1 closes 21 > 20 (bullish CISD); the up run opened at 18 and bar 3... bar 4 closes 17 < 18 (bearish)
    expect(found.map((c) => [c.direction, c.level, c.date])).toEqual([
      ["bullish", 20, day(1)],
      ["bearish", 18, day(4)],
    ]);
  });

  it("does not let a doji end a run", () => {
    const found = detectCisd(bars([[20, 18], [18, 18], [18, 16], [16, 21]]));
    expect(found).toEqual([{ date: day(3), level: 20, fromDate: day(0), direction: "bullish" }]);
  });
});
