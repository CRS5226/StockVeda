import { describe, expect, it } from "vitest";
import type { SignalRow } from "./api";
import { compactRupees, contributors, highDistance, histogram, leanSplit, pnlColor, profitSpread, sectorSplit, trendSplit } from "./signalInsights";

const row = (over: Partial<SignalRow>): SignalRow => ({
  symbol: "X", zone: "hold", pnl_pct: 0, trend: { above_sma200: null, from_high_pct: null }, timeframes: { "1W": null, "1D": null, "1H": null }, ...over,
}) as unknown as SignalRow;

describe("histogram", () => {
  it("puts a value on an edge in the lower bin and counts everything", () => {
    const bins = histogram([-50, -40, -10, 0, 5, 100], [-40, 0], ["low", "mid", "high"], ["a", "b", "c"]);
    expect(bins.map((b) => [b.label, b.count])).toEqual([["low", 2], ["mid", 2], ["high", 2]]);
  });
});

describe("splits", () => {
  it("splits stocks by the 200-day average, with those lacking candles apart", () => {
    const s = trendSplit([row({ trend: { above_sma200: true } as never }), row({ trend: { above_sma200: false } as never }), row({})]);
    expect(s.map((x) => x.value)).toEqual([1, 1, 1]);
  });
  it("counts the daily lean", () => {
    const frame = (lean: string) => ({ lean }) as never;
    const s = leanSplit([row({ timeframes: { "1D": frame("bullish") } as never }), row({ timeframes: { "1D": frame("bearish") } as never }), row({})]);
    expect(s.map((x) => x.value)).toEqual([1, 0, 1]);
  });
  it("bins the distance from the 52-week high and the profit", () => {
    const d = highDistance([row({ trend: { from_high_pct: -3 } as never }), row({ trend: { from_high_pct: -30 } as never }), row({})]);
    expect(d.map((b) => b.count)).toEqual([1, 0, 0, 1, 0]);
    const p = profitSpread([row({ pnl_pct: -50 }), row({ pnl_pct: 10 }), row({ pnl_pct: 70 }), row({ pnl_pct: null })]);
    expect(p.map((b) => b.count)).toEqual([1, 0, 0, 1, 0, 1]);
  });
});

describe("contributors", () => {
  const r = (symbol: string, gain: number) => row({ symbol, gain } as Partial<SignalRow>);
  it("lists the biggest gains and the biggest losses, largest first", () => {
    const { gainers, losers } = contributors([r("A", 100), r("B", -50), r("C", 300), r("D", -900), r("E", 0)], 2);
    expect(gainers.map((x) => x.symbol)).toEqual(["C", "A"]);
    expect(losers.map((x) => x.symbol)).toEqual(["D", "B"]);
  });
});

describe("sectorSplit", () => {
  const r = (symbol: string, value: number, sector: string | null, kind = "stock") => row({ symbol, value, sector, kind } as Partial<SignalRow>);
  it("adds up each sector, names the ones without data by what they are, and merges the smallest into Other", () => {
    const rows = [r("A", 100, "Tech"), r("B", 50, "Tech"), r("C", 70, "Banks"), r("D", 30, null, "etf"), r("E", 20, null, "reit"), r("F", 10, null)];
    expect(sectorSplit(rows).map((s) => [s.label, s.value, s.count])).toEqual([["Tech", 150, 2], ["Banks", 70, 1], ["ETFs", 30, 1], ["REITs & InvITs", 20, 1], ["Not synced", 10, 1]]);
    const merged = sectorSplit(rows, 3);
    expect(merged.map((s) => s.label)).toEqual(["Tech", "Banks", "Other"]);
    expect(merged[2]).toEqual({ label: "Other", value: 60, count: 3 });
  });
});

describe("colours and money", () => {
  it("colours losses red, gains green and unknowns grey", () => {
    expect(pnlColor(-60)).toContain("hsl(4");
    expect(pnlColor(60)).toContain("hsl(152");
    expect(pnlColor(null)).toBe("#e2e8f0");
  });
  it("shortens rupees", () => {
    expect(compactRupees(850)).toBe("₹850");
    expect(compactRupees(3400)).toBe("₹3.4k");
    expect(compactRupees(-120000)).toBe("-₹1.2L");
    expect(compactRupees(25000000)).toBe("₹2.5Cr");
  });
});
