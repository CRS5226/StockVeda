import { describe, expect, it } from "vitest";
import {
  barIndexAtOrBefore, chartTimeToNorm, clampLevel, defaultLevels, indexToTime, newPlotDraft, normTime, plotMetrics, timeToIndex, toDraft, validatePlot,
} from "./tradePlot";

describe("defaultLevels", () => {
  it("puts a long's stop below and target above, a short's the other way, 0.25% and 0.5% from the entry", () => {
    expect(defaultLevels("long", 800)).toEqual({ stop_loss: 798, target: 804 });
    expect(defaultLevels("short", 800)).toEqual({ stop_loss: 802, target: 796 });
  });
});

describe("validatePlot and clampLevel", () => {
  it("accepts a good long and short and rejects the wrong side", () => {
    expect(validatePlot("long", 100, 99, 102)).toBeNull();
    expect(validatePlot("short", 100, 101, 98)).toBeNull();
    expect(validatePlot("long", 100, 101, 102)).toMatch(/below/);
    expect(validatePlot("short", 100, 99, 98)).toMatch(/above/);
    expect(validatePlot("long", 100, 0, 102)).toMatch(/above 0/);
  });

  it("pulls a dragged level back to the valid side of the entry", () => {
    expect(clampLevel("long", 100, "stop", 105)).toBeCloseTo(99.99);
    expect(clampLevel("long", 100, "target", 95)).toBeCloseTo(100.01);
    expect(clampLevel("short", 100, "stop", 95)).toBeCloseTo(100.01);
    expect(clampLevel("short", 100, "target", 105)).toBeCloseTo(99.99);
    expect(clampLevel("long", 100, "stop", 90)).toBe(90);
  });
});

describe("plotMetrics", () => {
  it("gives points, percent, money and the risk-reward for a long", () => {
    const m = plotMetrics({ side: "long", entry_price: 800, stop_loss: 792, target: 816, qty: 10 });
    expect(m.target).toMatchObject({ price: 816, points: 16, pct: 2, money: 160 });
    expect(m.stop).toMatchObject({ price: 792, points: -8, pct: -1, money: -80 });
    expect(m.rr).toBe(2);
  });

  it("works the same for a short, whose reward is the fall", () => {
    const m = plotMetrics({ side: "short", entry_price: 800, stop_loss: 808, target: 784, qty: null });
    expect(m.target).toMatchObject({ points: 16, pct: 2, money: null });
    expect(m.stop).toMatchObject({ points: -8, pct: -1 });
    expect(m.rr).toBe(2);
  });

  it("has no risk-reward when there is no risk", () => {
    expect(plotMetrics({ side: "long", entry_price: 100, stop_loss: 100, target: 102, qty: null }).rr).toBeNull();
  });
});

describe("time helpers", () => {
  const days = ["2026-11-09 00:00:00", "2026-11-10 00:00:00", "2026-11-11 00:00:00"];

  it("normalises daily and intraday times", () => {
    expect(normTime("2026-11-11")).toBe("2026-11-11 00:00:00");
    expect(normTime("2026-11-11T09:15:00")).toBe("2026-11-11 09:15:00");
    expect(normTime("2026-11-11 09:15:00")).toBe("2026-11-11 09:15:00");
  });

  it("finds the last bar at or before a time", () => {
    expect(barIndexAtOrBefore(days, "2026-11-10 12:00:00")).toBe(1);
    expect(barIndexAtOrBefore(days, "2026-11-10 00:00:00")).toBe(1);
    expect(barIndexAtOrBefore(days, "2026-11-08 00:00:00")).toBe(-1);
    expect(barIndexAtOrBefore(days, "2026-12-01 00:00:00")).toBe(2);
  });

  it("maps a time past the last bar to an index past the end, and back", () => {
    expect(timeToIndex(days, "2026-11-10 00:00:00")).toBe(1);
    expect(timeToIndex(days, "2026-11-14 00:00:00")).toBe(5); // three bars after the last
    expect(indexToTime(days, 5)).toBe("2026-11-14 00:00:00");
    expect(indexToTime(days, 1)).toBe("2026-11-10 00:00:00");
  });

  it("keeps a 5-minute step for intraday bars", () => {
    const bars = ["2026-11-11 09:15:00", "2026-11-11 09:20:00", "2026-11-11 09:25:00"];
    expect(indexToTime(bars, 4)).toBe("2026-11-11 09:35:00");
    expect(timeToIndex(bars, "2026-11-11 09:35:00")).toBe(4);
  });
});

describe("newPlotDraft", () => {
  it("starts a box at the clicked bar with default levels and a 20-bar width", () => {
    const bars = ["2026-11-09 00:00:00", "2026-11-10 00:00:00", "2026-11-11 00:00:00"];
    const d = newPlotDraft("HDFCBANK", "long", bars, 2, 800.456);
    expect(d).toMatchObject({
      symbol: "HDFCBANK", side: "long", entry_price: 800.46, qty: null, note: "",
      entry_time: "2026-11-11T00:00:00", end_time: "2026-12-01T00:00:00",
    });
    expect(d.stop_loss).toBeLessThan(d.entry_price);
    expect(d.target).toBeGreaterThan(d.entry_price);
  });
});

describe("chartTimeToNorm and toDraft", () => {
  it("reads the three kinds of chart time", () => {
    expect(chartTimeToNorm("2026-11-11")).toBe("2026-11-11 00:00:00");
    expect(chartTimeToNorm(Date.UTC(2026, 10, 11, 9, 15) / 1000)).toBe("2026-11-11 09:15:00");
    expect(chartTimeToNorm({ year: 2026, month: 3, day: 5 })).toBe("2026-03-05 00:00:00");
  });

  it("keeps only the fields the API stores", () => {
    const d = toDraft({
      id: 4, symbol: "TCS", side: "short", entry_time: "2026-11-11T09:15:00", end_time: "2026-11-11T11:00:00",
      entry_price: 100, stop_loss: 101, target: 98, qty: 5, note: "x", created_at: "a", updated_at: "b",
    });
    expect(Object.keys(d).sort()).toEqual(["end_time", "entry_price", "entry_time", "note", "qty", "side", "stop_loss", "symbol", "target"]);
  });
});
