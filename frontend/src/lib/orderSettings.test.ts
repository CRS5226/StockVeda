import { describe, expect, it } from "vitest";
import { buildOrder, clampLevel, DEFAULT_SETTINGS, fieldToLevel, levelToField, validateLevel } from "./orderSettings";
import type { Position } from "./paperTrading";

const pos = (over: Partial<Position> = {}): Position => ({
  instrument: "CE", side: "buy", direction: 1, qty: 10, avgPrice: 100, stopLoss: 99, target: 102, floating: 0, ...over,
});

describe("levelToField and fieldToLevel", () => {
  it("shows a long position's levels as distances from the entry", () => {
    expect(levelToField(pos(), "stoploss", "%")).toBe("1");
    expect(levelToField(pos(), "target", "%")).toBe("2");
    expect(levelToField(pos(), "stoploss", "pts")).toBe("1");
    expect(levelToField(pos({ stopLoss: 98.5 }), "stoploss", "pts")).toBe("1.5");
  });

  it("counts a Buy PE the other way round: its stop-loss is above the entry", () => {
    const pe = pos({ instrument: "PE", direction: -1, stopLoss: 101, target: 98 });
    expect(levelToField(pe, "stoploss", "%")).toBe("1");
    expect(levelToField(pe, "target", "%")).toBe("2");
  });

  it("shows a stop-loss moved past the entry as a negative number, and a missing level as empty", () => {
    expect(levelToField(pos({ stopLoss: 101 }), "stoploss", "%")).toBe("-1");
    expect(levelToField(pos({ target: null }), "target", "%")).toBe("");
  });

  it("turns typed text back into a level price", () => {
    expect(fieldToLevel(pos(), "stoploss", "2", "%")).toBe(98);
    expect(fieldToLevel(pos(), "target", "5", "pts")).toBe(105);
    expect(fieldToLevel(pos({ instrument: "PE", direction: -1 }), "stoploss", "2", "%")).toBe(102);
    expect(fieldToLevel(pos(), "stoploss", "", "%")).toBeNull();
    expect(fieldToLevel(pos(), "stoploss", "abc", "%")).toBeUndefined();
  });

  it("round-trips what a drag produces", () => {
    const p = pos({ stopLoss: 97.25 });
    expect(fieldToLevel(p, "stoploss", levelToField(p, "stoploss", "pts"), "pts")).toBeCloseTo(97.25);
  });
});

describe("validateLevel and clampLevel", () => {
  it("keeps the stop-loss on the losing side of the current price and the target on the winning side", () => {
    expect(validateLevel(1, 104, "stoploss", 102)).toBeNull(); // a trailing stop above the entry is fine
    expect(validateLevel(1, 104, "stoploss", 105)).toMatch(/below the current price/);
    expect(validateLevel(1, 104, "target", 103)).toMatch(/above the current price/);
    expect(validateLevel(-1, 100, "stoploss", 99)).toMatch(/above the current price/);
    expect(validateLevel(-1, 100, "target", 101)).toMatch(/below the current price/);
    expect(validateLevel(1, 100, "stoploss", -5)).toMatch(/not a valid price/);
  });

  it("pulls a dragged level back to the nearest valid price", () => {
    expect(clampLevel(1, 100, "stoploss", 120)).toBeCloseTo(99.99);
    expect(clampLevel(1, 100, "target", 80)).toBeCloseTo(100.01);
    expect(clampLevel(-1, 100, "stoploss", 80)).toBeCloseTo(100.01);
    expect(clampLevel(1, 100, "stoploss", 90)).toBe(90); // already valid
  });
});

describe("buildOrder", () => {
  it("builds a fresh order with the card's levels", () => {
    expect(buildOrder("CE", "buy", DEFAULT_SETTINGS, 100, null)).toEqual({
      order: { instrument: "CE", side: "buy", qty: 1, stopLoss: 99, target: 102 },
    });
    expect(buildOrder("PE", "buy", DEFAULT_SETTINGS, 100, null)).toEqual({
      order: { instrument: "PE", side: "buy", qty: 1, stopLoss: 101, target: 98 },
    });
  });

  it("takes a quantity override (the dialog on the chart)", () => {
    const r = buildOrder("CE", "buy", DEFAULT_SETTINGS, 100, null, 25);
    expect("order" in r && r.order.qty).toBe(25);
  });

  it("needs no levels for an order that only books part of a holding", () => {
    const r = buildOrder("CE", "sell", { ...DEFAULT_SETTINGS, slValue: "x" }, 100, pos(), 3);
    expect(r).toEqual({ order: { instrument: "CE", side: "sell", qty: 3, stopLoss: null, target: null } });
  });

  it("leaves the levels to the position when adding to it", () => {
    const r = buildOrder("CE", "buy", DEFAULT_SETTINGS, 100, pos(), 5);
    expect(r).toEqual({ order: { instrument: "CE", side: "buy", qty: 5, stopLoss: null, target: null } });
  });

  it("applies the card's levels to the part of a sell that opens a new short", () => {
    const r = buildOrder("CE", "sell", DEFAULT_SETTINGS, 100, pos({ qty: 4 }), 10);
    expect(r).toEqual({ order: { instrument: "CE", side: "sell", qty: 10, stopLoss: 101, target: 98 } });
  });

  it("rejects a bad quantity and bad distances", () => {
    expect(buildOrder("CE", "buy", DEFAULT_SETTINGS, 100, null, 0)).toHaveProperty("error");
    expect(buildOrder("CE", "buy", { ...DEFAULT_SETTINGS, slValue: "-1" }, 100, null)).toHaveProperty("error");
  });
});
