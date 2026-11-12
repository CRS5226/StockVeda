import { describe, expect, it } from "vitest";
import {
  avgRr,
  backtestCsvFilename,
  buildBacktestCsv,
  escapeCsvCell,
  formatConditions,
  indicatorsUsed,
  matrixCsv,
  multiAlgoCsv,
  multiStockCsv,
  rrAchieved,
  type StrategyConfigLike,
} from "./backtestCsv";
import type {
  BacktestTradeV2,
  BacktestV2Response,
  MatrixResponse,
} from "./api";

const trade = (over: Partial<BacktestTradeV2> = {}): BacktestTradeV2 => ({
  entry_date: "2024-01-02",
  exit_date: "2024-01-10",
  entry_price: 100,
  target_price: 115,
  sl_price: 90,
  exit_price: 130,
  exit_reason: "target",
  pnl: 300,
  pnl_pct: 30,
  shares: 10,
  ...over,
});

const strategy = (over: Partial<StrategyConfigLike> = {}): StrategyConfigLike => ({
  entry_conditions: [
    { left: "rsi_14", operator: "above", right: "50" },
    { left: "macd", operator: "crosses_above", right: "macd_signal" },
  ],
  exit_conditions: [],
  target_pct: 15,
  sl_pct: 7,
  max_bars: 30,
  from_date: "2023-01-01",
  to_date: "2024-12-31",
  capital_per_trade: 10000,
  ...over,
});

describe("escapeCsvCell", () => {
  it("leaves plain values untouched and blanks null/undefined", () => {
    expect(escapeCsvCell("RELIANCE")).toBe("RELIANCE");
    expect(escapeCsvCell(42)).toBe("42");
    expect(escapeCsvCell(null)).toBe("");
    expect(escapeCsvCell(undefined)).toBe("");
  });

  it("quotes values containing commas, quotes or newlines", () => {
    expect(escapeCsvCell("a,b")).toBe('"a,b"');
    expect(escapeCsvCell('say "hi"')).toBe('"say ""hi"""');
    expect(escapeCsvCell("a\nb")).toBe('"a\nb"');
  });
});

describe("rrAchieved / avgRr", () => {
  it("computes R as (exit - entry) / (entry - stop)", () => {
    expect(rrAchieved(trade())).toBe(3); // +30 gained on 10 risked
    expect(rrAchieved(trade({ exit_price: 90, exit_reason: "sl" }))).toBe(-1);
    expect(rrAchieved(trade({ exit_price: 100 }))).toBe(0);
  });

  it("returns null when the stop equals the entry (no defined risk)", () => {
    expect(rrAchieved(trade({ sl_price: 100 }))).toBeNull();
  });

  it("averages only trades with a usable stop", () => {
    const trades = [trade(), trade({ exit_price: 90 }), trade({ sl_price: 100 })];
    expect(avgRr(trades)).toBe(1); // (3 + -1) / 2
    expect(avgRr([trade({ sl_price: 100 })])).toBeNull();
    expect(avgRr([])).toBeNull();
  });
});

describe("formatConditions / indicatorsUsed", () => {
  it("joins conditions with AND and dedupes indicator names", () => {
    const conds = strategy().entry_conditions;
    expect(formatConditions(conds)).toBe("rsi_14 above 50 AND macd crosses_above macd_signal");
    expect(formatConditions([])).toBe("");
    expect(indicatorsUsed(conds, [{ left: "rsi_14", operator: "below", right: "30" }])).toBe("rsi_14, macd");
  });
});

describe("buildBacktestCsv", () => {
  it("puts the summary block first, then a blank line, then the trade table", () => {
    const csv = buildBacktestCsv(
      [["Strategy", "Test"], ["Win rate %", 50]],
      [{ algo: "", symbol: "RELIANCE", trade: trade() }],
    );
    const lines = csv.trimEnd().split("\n");
    expect(lines[0]).toBe("Strategy,Test");
    expect(lines[1]).toBe("Win rate %,50");
    expect(lines[2]).toBe("");
    expect(lines[3]).toBe(
      "symbol,entry_date,entry_price,exit_date,exit_price,stop,target,exit_reason,shares,pnl,pnl_pct,rr_achieved,score_tier",
    );
    expect(lines[4]).toBe("RELIANCE,2024-01-02,100,2024-01-10,130,90,115,target,10,300,30,3,");
  });

  it("adds a leading algo column when trades carry algo labels", () => {
    const csv = buildBacktestCsv(
      [["Mode", "Matrix"]],
      [{ algo: "Algo A", symbol: "TCS", trade: trade() }],
    );
    const lines = csv.trimEnd().split("\n");
    expect(lines[2]).toMatch(/^algo,symbol,/);
    expect(lines[3]).toMatch(/^Algo A,TCS,/);
  });
});

describe("multiStockCsv", () => {
  it("summarises the run and combines trades from every symbol", () => {
    const response: BacktestV2Response = {
      aggregate: { total_trades: 2, win_rate_pct: 50, total_pnl: 200, avg_pnl_pct: 10, best_symbol: "RELIANCE", worst_symbol: "TCS" },
      per_symbol: {
        RELIANCE: { ohlcv: [], trades: [trade()], stats: { total_trades: 1, win_rate_pct: 100, total_pnl: 300, avg_pnl_pct: 30 } },
        TCS: { ohlcv: [], trades: [trade({ exit_price: 90, exit_reason: "sl", pnl: -100, pnl_pct: -10 })], stats: { total_trades: 1, win_rate_pct: 0, total_pnl: -100, avg_pnl_pct: -10 } },
      },
    };
    const csv = multiStockCsv(response, strategy());
    expect(csv).toContain("Entry rule,rsi_14 above 50 AND macd crosses_above macd_signal");
    expect(csv).toContain("Target rule,+15%");
    expect(csv).toContain("Stop-loss rule,-7%");
    expect(csv).toContain('Symbols,"RELIANCE, TCS"');
    expect(csv).toContain("Win rate %,50");
    expect(csv).toContain("Total P&L,200");
    expect(csv).toContain("Avg R:R,1"); // (3 + -1) / 2
    expect(csv).toContain("RELIANCE,2024-01-02,100");
    expect(csv).toContain("TCS,2024-01-02,100");
  });
});

describe("multiAlgoCsv", () => {
  it("labels every trade with its algo and summarises each slot", () => {
    const csv = multiAlgoCsv("RELIANCE", [
      { label: "Momentum", strategy: strategy(), results: { trades: [trade()], stats: { total_trades: 1, win_rate_pct: 100, total_pnl: 300 } } },
      { label: "Idle", strategy: strategy(), results: null },
    ]);
    expect(csv).toContain("Mode,Multi-Algo");
    expect(csv).toContain("Symbol,RELIANCE");
    // The label contains quotes, so it is CSV-escaped with doubled quotes.
    expect(csv).toContain('"Algo ""Momentum"" entry rule",rsi_14 above 50');
    const tradeLine = csv.trimEnd().split("\n").pop()!;
    expect(tradeLine).toMatch(/^Momentum,RELIANCE,/);
  });
});

describe("matrixCsv", () => {
  it("combines every algo x symbol combo into one trade log", () => {
    const response: MatrixResponse = {
      matrix: {
        a1: { RELIANCE: { trades: [trade()], stats: { total_trades: 1, win_rate_pct: 100, total_pnl: 300, avg_pnl_pct: 30 }, ohlcv: [] } },
      },
      per_algo: { a1: { label: "Momentum", total_trades: 1, win_rate_pct: 100, total_pnl: 300, avg_pnl_pct: 30 } },
      per_symbol: { RELIANCE: { total_trades: 1, win_rate_pct: 100, total_pnl: 300 } },
      aggregate: { total_trades: 1, win_rate_pct: 100, total_pnl: 300, avg_pnl_pct: 30, best_combo: null, worst_combo: null },
    };
    const csv = matrixCsv(response, [{ id: "a1", label: "Momentum", strategy: strategy() }]);
    expect(csv).toContain("Mode,Matrix");
    expect(csv).toContain("Total P&L,300");
    const tradeLine = csv.trimEnd().split("\n").pop()!;
    expect(tradeLine).toMatch(/^Momentum,RELIANCE,/);
  });
});

describe("backtestCsvFilename", () => {
  it("builds a dated .csv filename", () => {
    expect(backtestCsvFilename("multi-stock")).toMatch(/^backtest-multi-stock-\d{4}-\d{2}-\d{2}\.csv$/);
  });
});
