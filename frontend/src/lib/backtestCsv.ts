// Single-file CSV export for backtest reports (issue #2).
//
// Every export is one CSV with two blocks:
//   1. a run-summary block (label,value rows: strategy config, entry /
//      target / stop-loss rules, indicators used, win rate, total P&L,
//      avg R:R, capital per trade, date range, symbols), then a blank line;
//   2. the full trade log — every trade across every symbol in the run.
//
// Built purely from the result JSON the page already has, so no extra
// backend endpoint is needed.

import type {
  BacktestTradeV2,
  BacktestV2Response,
  ConditionRow,
  MatrixResponse,
} from "./api";

/** Structural subset of the store's StrategyV2 that the export needs. */
export interface StrategyConfigLike {
  entry_conditions: ConditionRow[];
  exit_conditions: ConditionRow[];
  target_pct: number;
  sl_pct: number;
  max_bars: number;
  from_date: string;
  to_date: string;
  capital_per_trade: number;
}

export type CsvCell = string | number | null | undefined;

export function escapeCsvCell(value: CsvCell): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function csvLine(cells: CsvCell[]): string {
  return cells.map(escapeCsvCell).join(",");
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** R multiple achieved by a closed long trade: (exit − entry) / (entry − stop). */
export function rrAchieved(trade: BacktestTradeV2): number | null {
  const risk = trade.entry_price - trade.sl_price;
  if (!risk) return null;
  return (trade.exit_price - trade.entry_price) / risk;
}

/** Mean R:R achieved across trades; null when no trade has a usable stop. */
export function avgRr(trades: BacktestTradeV2[]): number | null {
  const vals = trades
    .map(rrAchieved)
    .filter((v): v is number => v !== null);
  if (vals.length === 0) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

export function formatConditions(conditions: ConditionRow[]): string {
  return conditions
    .map((c) => `${c.left} ${c.operator} ${c.right}`)
    .join(" AND ");
}

/** Unique indicator/column names referenced by the given condition groups. */
export function indicatorsUsed(...groups: ConditionRow[][]): string {
  const seen: string[] = [];
  for (const group of groups) {
    for (const c of group) {
      if (!seen.includes(c.left)) seen.push(c.left);
    }
  }
  return seen.join(", ");
}

export interface CsvTradeEntry {
  algo: string;
  symbol: string;
  trade: BacktestTradeV2;
}

const TRADE_COLUMNS = [
  "symbol", "entry_date", "entry_price", "exit_date", "exit_price",
  "stop", "target", "exit_reason", "shares", "pnl", "pnl_pct",
  "rr_achieved", "score_tier",
] as const;

/**
 * Assemble the final CSV text: summary rows, a blank line, then the trade
 * table. The leading `algo` column is only emitted when at least one trade
 * carries an algo label (Multi-Algo / Matrix exports). `score_tier` is part
 * of the requested shape but the current result payloads carry no per-trade
 * score, so it is exported empty.
 */
export function buildBacktestCsv(
  summary: [string, CsvCell][],
  trades: CsvTradeEntry[],
): string {
  const lines = summary.map(([label, value]) => csvLine([label, value]));
  lines.push("");
  const withAlgo = trades.some((t) => t.algo !== "");
  lines.push(csvLine(withAlgo ? ["algo", ...TRADE_COLUMNS] : [...TRADE_COLUMNS]));
  for (const { algo, symbol, trade } of trades) {
    const rr = rrAchieved(trade);
    const row: CsvCell[] = [
      symbol,
      trade.entry_date,
      trade.entry_price,
      trade.exit_date,
      trade.exit_price,
      trade.sl_price,
      trade.target_price,
      trade.exit_reason,
      trade.shares,
      trade.pnl,
      trade.pnl_pct,
      rr === null ? "" : round2(rr),
      "",
    ];
    if (withAlgo) row.unshift(algo);
    lines.push(csvLine(row));
  }
  return lines.join("\n") + "\n";
}

function strategySummary(
  name: string,
  strategy: StrategyConfigLike,
): [string, CsvCell][] {
  return [
    ["Strategy", name],
    ["Entry rule", formatConditions(strategy.entry_conditions)],
    ["Exit rule", formatConditions(strategy.exit_conditions)],
    ["Target rule", `+${strategy.target_pct}%`],
    ["Stop-loss rule", `-${strategy.sl_pct}%`],
    ["Max holding (bars)", strategy.max_bars],
    ["Indicators used", indicatorsUsed(strategy.entry_conditions, strategy.exit_conditions)],
    ["Capital per trade", strategy.capital_per_trade],
    ["Date range", `${strategy.from_date} to ${strategy.to_date}`],
  ];
}

/** Multi-Stock export: one strategy run across many symbols. */
export function multiStockCsv(
  response: BacktestV2Response,
  strategy: StrategyConfigLike,
  strategyName = "Multi-Stock strategy",
): string {
  const symbols = Object.keys(response.per_symbol);
  const entries: CsvTradeEntry[] = symbols.flatMap((symbol) =>
    response.per_symbol[symbol].trades.map((trade) => ({ algo: "", symbol, trade })),
  );
  const allTrades = entries.map((e) => e.trade);
  const avg = avgRr(allTrades);
  const summary: [string, CsvCell][] = [
    ...strategySummary(strategyName, strategy),
    ["Symbols", symbols.join(", ")],
    ["Total trades", response.aggregate.total_trades],
    ["Win rate %", response.aggregate.win_rate_pct],
    ["Total P&L", response.aggregate.total_pnl],
    ["Avg R:R", avg === null ? "" : round2(avg)],
  ];
  return buildBacktestCsv(summary, entries);
}

/** Multi-Algo export: several strategies run on a single symbol. */
export function multiAlgoCsv(
  symbol: string,
  slots: {
    label: string;
    strategy: StrategyConfigLike;
    results: { trades: BacktestTradeV2[]; stats: { total_trades: number; win_rate_pct: number; total_pnl: number } } | null;
  }[],
): string {
  const withResults = slots.filter((s) => s.results);
  const entries: CsvTradeEntry[] = withResults.flatMap((slot) =>
    slot.results!.trades.map((trade) => ({ algo: slot.label, symbol, trade })),
  );
  const allTrades = entries.map((e) => e.trade);
  const avg = avgRr(allTrades);
  const summary: [string, CsvCell][] = [["Mode", "Multi-Algo"], ["Symbol", symbol]];
  if (withResults.length > 0) {
    summary.push(
      ["Date range", `${withResults[0].strategy.from_date} to ${withResults[0].strategy.to_date}`],
      ["Capital per trade", withResults[0].strategy.capital_per_trade],
    );
  }
  for (const slot of withResults) {
    summary.push(
      [`Algo "${slot.label}" entry rule`, formatConditions(slot.strategy.entry_conditions)],
      [`Algo "${slot.label}" target / stop-loss`, `+${slot.strategy.target_pct}% / -${slot.strategy.sl_pct}%`],
      [`Algo "${slot.label}" indicators`, indicatorsUsed(slot.strategy.entry_conditions, slot.strategy.exit_conditions)],
      [`Algo "${slot.label}" trades`, slot.results!.stats.total_trades],
      [`Algo "${slot.label}" win rate %`, slot.results!.stats.win_rate_pct],
      [`Algo "${slot.label}" total P&L`, slot.results!.stats.total_pnl],
    );
  }
  summary.push(
    ["Total trades", allTrades.length],
    ["Avg R:R", avg === null ? "" : round2(avg)],
  );
  return buildBacktestCsv(summary, entries);
}

/** Matrix export: every algo × every symbol, one combined trade log. */
export function matrixCsv(
  response: MatrixResponse,
  algos: { id: string; label: string; strategy: StrategyConfigLike }[],
): string {
  const labelFor = (id: string) =>
    algos.find((a) => a.id === id)?.label ?? response.per_algo[id]?.label ?? id;
  const entries: CsvTradeEntry[] = [];
  for (const [algoId, bySymbol] of Object.entries(response.matrix)) {
    for (const [symbol, combo] of Object.entries(bySymbol)) {
      for (const trade of combo.trades) {
        entries.push({ algo: labelFor(algoId), symbol, trade });
      }
    }
  }
  const allTrades = entries.map((e) => e.trade);
  const avg = avgRr(allTrades);
  const symbols = Object.keys(response.per_symbol);
  const summary: [string, CsvCell][] = [["Mode", "Matrix"]];
  if (algos.length > 0) {
    summary.push(
      ["Date range", `${algos[0].strategy.from_date} to ${algos[0].strategy.to_date}`],
      ["Capital per trade", algos[0].strategy.capital_per_trade],
    );
  }
  for (const algo of algos) {
    const stats = response.per_algo[algo.id];
    summary.push(
      [`Algo "${algo.label}" entry rule`, formatConditions(algo.strategy.entry_conditions)],
      [`Algo "${algo.label}" target / stop-loss`, `+${algo.strategy.target_pct}% / -${algo.strategy.sl_pct}%`],
      [`Algo "${algo.label}" indicators`, indicatorsUsed(algo.strategy.entry_conditions, algo.strategy.exit_conditions)],
    );
    if (stats) {
      summary.push(
        [`Algo "${algo.label}" trades`, stats.total_trades],
        [`Algo "${algo.label}" win rate %`, stats.win_rate_pct],
        [`Algo "${algo.label}" total P&L`, stats.total_pnl],
      );
    }
  }
  summary.push(
    ["Symbols", symbols.join(", ")],
    ["Total trades", response.aggregate.total_trades],
    ["Win rate %", response.aggregate.win_rate_pct],
    ["Total P&L", response.aggregate.total_pnl],
    ["Avg R:R", avg === null ? "" : round2(avg)],
  );
  return buildBacktestCsv(summary, entries);
}

export function backtestCsvFilename(mode: string): string {
  const day = new Date().toISOString().slice(0, 10);
  return `backtest-${mode}-${day}.csv`;
}

/** Trigger a browser download of CSV text. */
export function downloadCsv(filename: string, text: string): void {
  const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
