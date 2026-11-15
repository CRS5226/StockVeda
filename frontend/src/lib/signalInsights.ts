import type { SignalRow, SignalsReport } from "./api";

export interface Slice { label: string; value: number; color: string }
export interface Bin { label: string; count: number; color: string }

const GREEN = "#10b981", RED = "#ef4444", GREY = "#cbd5e1", AMBER = "#f59e0b", BLUE = "#3b82f6";

/** Stocks above and below their 200-day average, and those without enough candles to tell. */
export function trendSplit(rows: SignalRow[]): Slice[] {
  const above = rows.filter((r) => r.trend.above_sma200 === true).length;
  const below = rows.filter((r) => r.trend.above_sma200 === false).length;
  return [
    { label: "Above 200-day average", value: above, color: GREEN },
    { label: "Below 200-day average", value: below, color: RED },
    { label: "Not enough candles", value: rows.length - above - below, color: GREY },
  ];
}

/** What the daily rules lean towards, stock by stock. */
export function leanSplit(rows: SignalRow[]): Slice[] {
  const count = (lean: string) => rows.filter((r) => r.timeframes["1D"]?.lean === lean).length;
  return [
    { label: "Bullish", value: count("bullish"), color: GREEN },
    { label: "Neutral", value: count("neutral"), color: GREY },
    { label: "Bearish", value: count("bearish"), color: RED },
  ];
}

/** Values counted into bins. `edges` are the upper limits of every bin but the last, ascending; a value on an edge goes in the lower bin. */
export function histogram(values: number[], edges: number[], labels: string[], colors: string[]): Bin[] {
  const counts = new Array(edges.length + 1).fill(0);
  for (const v of values) {
    const i = edges.findIndex((e) => v <= e);
    counts[i === -1 ? edges.length : i] += 1;
  }
  return counts.map((count, i) => ({ label: labels[i], count, color: colors[i] }));
}

/** How far the latest close is below the 52-week high, in bins of distance (a stock at its high is in the first). */
export function highDistance(rows: SignalRow[]): Bin[] {
  const values = rows.map((r) => (r.trend.from_high_pct === null ? null : -r.trend.from_high_pct)).filter((v): v is number => v !== null);
  return histogram(values, [5, 15, 25, 40], ["Within 5%", "5–15%", "15–25%", "25–40%", "Over 40%"], [GREEN, "#84cc16", AMBER, "#f97316", RED]);
}

/** The profit or loss of each position, in bins. */
export function profitSpread(rows: SignalRow[]): Bin[] {
  const values = rows.map((r) => r.pnl_pct).filter((v): v is number => v !== null);
  return histogram(values, [-40, -20, 0, 20, 40], ["Down 40%+", "−40 to −20", "−20 to 0", "0 to 20", "20 to 40", "Up 40%+"], [RED, "#f97316", AMBER, "#84cc16", GREEN, "#059669"]);
}

export interface Insight { tone: "good" | "watch" | "info"; text: string }

const names = <T extends { symbol: string }>(rows: T[], max = 3) => {
  const list = rows.slice(0, max).map((r) => r.symbol).join(", ");
  return rows.length > max ? `${list} and ${rows.length - max} more` : list;
}

/** A few plain sentences about what stands out. Neutral wording: what the numbers show, never what to do. */
export function buildInsights(report: SignalsReport): Insight[] {
  const { rows, summary: s, concentration: c, settings } = report;
  const out: Insight[] = [];
  if (s.with_sma200 > 0) {
    out.push({ tone: s.below_sma200 > s.with_sma200 / 2 ? "watch" : "info", text: `${s.below_sma200} of ${s.with_sma200} stocks are below their 200-day average, and ${s.deep_drawdown} are 25% or more below their 52-week high.` });
  }
  if (s.aligned_bullish + s.aligned_bearish > 0) {
    out.push({ tone: "info", text: `${s.aligned_bullish} ${s.aligned_bullish === 1 ? "stock leans" : "stocks lean"} bullish on weekly, daily and 1-hour candles together; ${s.aligned_bearish} lean bearish on all of them.` });
  }
  const recovery = rows.filter((r) => r.zone === "recovery"), profit = rows.filter((r) => r.zone === "profit");
  if (profit.length > 0) out.push({ tone: "watch", text: `${profit.length} ${profit.length === 1 ? "stock meets" : "stocks meet"} your profit-booking conditions (gain of ${settings.profit_gain_pct}% or more and stretched): ${names(profit)}.` });
  if (recovery.length > 0) out.push({ tone: "info", text: `${recovery.length} ${recovery.length === 1 ? "stock meets" : "stocks meet"} your recovery-zone conditions (down ${settings.loss_pct}% or more, MACD turned up, close above the 20-day EMA): ${names(recovery)}.` });
  const over = c.positions.filter((p) => p.over_limit);
  if (over.length > 0) out.push({ tone: "watch", text: `${names(over)} ${over.length === 1 ? "is" : "are"} above your ${c.max_pct}% limit for one stock; the largest is ${over[0].symbol} at ${over[0].weight_pct.toFixed(1)}% of your stock holdings.` });
  else if (c.positions.length > 0) out.push({ tone: "good", text: `No stock is above your ${c.max_pct}% size limit. The top 5 hold ${c.top5_pct.toFixed(0)}% of your stock holdings.` });
  return out;
}
