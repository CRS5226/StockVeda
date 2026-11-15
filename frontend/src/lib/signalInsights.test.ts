import { describe, expect, it } from "vitest";
import type { SignalRow, SignalsReport } from "./api";
import { buildInsights, highDistance, histogram, leanSplit, profitSpread, trendSplit } from "./signalInsights";

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

describe("buildInsights", () => {
  const report = {
    settings: { profit_gain_pct: 40, loss_pct: 25 },
    summary: { with_sma200: 10, below_sma200: 7, deep_drawdown: 3, aligned_bullish: 2, aligned_bearish: 1, profit_zone: 0, recovery_zone: 1, over_limit: 1 },
    concentration: { max_pct: 10, top5_pct: 40, positions: [{ symbol: "BIG", weight_pct: 17.6, over_limit: true }, { symbol: "OK", weight_pct: 5, over_limit: false }] },
    rows: [row({ symbol: "REC", zone: "recovery" })],
  } as unknown as SignalsReport;
  it("writes plain sentences and never tells the user to act", () => {
    const text = buildInsights(report).map((i) => i.text).join(" ");
    expect(text).toContain("7 of 10 stocks are below their 200-day average");
    expect(text).toContain("REC");
    expect(text).toContain("BIG is above your 10% limit");
    expect(text).not.toMatch(/\b(buy|sell)\b/i);
  });
});
