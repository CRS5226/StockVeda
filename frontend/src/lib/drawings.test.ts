import { describe, expect, it } from "vitest";
import { applyHandle, newDrawing, translate } from "./drawings";

const barTimes = ["2026-01-01 09:15:00", "2026-01-01 09:20:00", "2026-01-01 09:25:00", "2026-01-01 09:30:00"];
const rect = newDrawing("TCS", "rect", { time: barTimes[0], price: 100 }, { time: barTimes[1], price: 110 });

describe("newDrawing", () => {
  it("stores both clicks, and a horizontal line keeps the first price over the second time", () => {
    expect(rect).toMatchObject({ kind: "rect", time1: "2026-01-01T09:15:00", price1: 100, time2: "2026-01-01T09:20:00", price2: 110 });
    const h = newDrawing("TCS", "hline", { time: barTimes[0], price: 105.456 }, { time: barTimes[2], price: 99 });
    expect([h.time1, h.time2, h.price1, h.price2]).toEqual(["2026-01-01T09:15:00", "2026-01-01T09:25:00", 105.46, 105.46]);
  });
});

describe("applyHandle", () => {
  it("moves only the anchor values the handle controls", () => {
    const moved = applyHandle(rect, { t: 2, p: 1 }, barTimes[3], 95);
    expect(moved).toMatchObject({ time1: rect.time1, price1: 95, time2: "2026-01-01T09:30:00", price2: 110 });
  });
  it("an edge handle changes only the length or only the height", () => {
    expect(applyHandle(rect, { t: 2 }, barTimes[3], 999)).toMatchObject({ time2: "2026-01-01T09:30:00", price1: 100, price2: 110 });
    expect(applyHandle(rect, { p: 2 }, barTimes[3], 120)).toMatchObject({ time2: rect.time2, price1: 100, price2: 120 });
  });
  it("keeps a horizontal line flat", () => {
    const h = newDrawing("TCS", "hline", { time: barTimes[0], price: 100 }, { time: barTimes[2], price: 100 });
    expect(applyHandle(h, { t: 2, p: 2 }, barTimes[3], 120)).toMatchObject({ price1: 120, price2: 120 });
  });
});

describe("translate", () => {
  it("shifts by bars and price", () => {
    expect(translate(rect, barTimes, 2, 5)).toMatchObject({ time1: "2026-01-01T09:25:00", time2: "2026-01-01T09:30:00", price1: 105, price2: 115 });
  });
  it("moves a horizontal line along with its price", () => {
    const h = newDrawing("TCS", "hline", { time: barTimes[0], price: 100 }, { time: barTimes[1], price: 100 });
    expect(translate(h, barTimes, 2, -10)).toMatchObject({ time1: "2026-01-01T09:25:00", time2: "2026-01-01T09:30:00", price1: 90, price2: 90 });
  });
  it("refuses a move that would take a price to zero", () => {
    expect(translate(rect, barTimes, 0, -100)).toBeNull();
  });
});
