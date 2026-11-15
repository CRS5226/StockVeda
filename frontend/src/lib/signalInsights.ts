import type { SignalRow } from "./api";

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

/** The biggest gains and losses in rupees: up to `n` of each, largest first. */
export function contributors(rows: SignalRow[], n = 5): { gainers: SignalRow[]; losers: SignalRow[] } {
  const sorted = [...rows].sort((a, b) => b.gain - a.gain);
  return { gainers: sorted.filter((r) => r.gain > 0).slice(0, n), losers: sorted.filter((r) => r.gain < 0).reverse().slice(0, n) };
}

/** Share of the stock holdings by sector, biggest first. The smallest are merged into "Other" beyond `max` entries. */
export function sectorSplit(rows: SignalRow[], max = 8): { label: string; value: number; count: number }[] {
  const by = new Map<string, { value: number; count: number }>();
  for (const r of rows) {
    const label = r.sector ?? (r.kind === "etf" ? "ETFs" : r.kind === "reit" || r.kind === "invit" ? "REITs & InvITs" : "Not synced");
    const cur = by.get(label) ?? { value: 0, count: 0 };
    by.set(label, { value: cur.value + r.value, count: cur.count + 1 });
  }
  const list = [...by.entries()].map(([label, v]) => ({ label, ...v })).sort((a, b) => b.value - a.value);
  if (list.length <= max) return list;
  const rest = list.slice(max - 1);
  return [...list.slice(0, max - 1), { label: "Other", value: rest.reduce((a, b) => a + b.value, 0), count: rest.reduce((a, b) => a + b.count, 0) }];
}

/** A colour for a profit or loss: red when down, grey near zero, green when up, saturating at ±`limit` percent. */
export function pnlColor(pnl: number | null, limit = 50): string {
  if (pnl === null) return "#e2e8f0";
  const t = Math.max(-1, Math.min(1, pnl / limit));
  const hue = t >= 0 ? 152 : 4;
  const strength = Math.abs(t);
  return `hsl(${hue} ${35 + 45 * strength}% ${88 - 38 * strength}%)`;
}

/** Rupees in short form: ₹1.2L, ₹3.4k, ₹850. */
export function compactRupees(n: number): string {
  const a = Math.abs(n), sign = n < 0 ? "-" : "";
  if (a >= 1e7) return `${sign}₹${(a / 1e7).toFixed(1)}Cr`;
  if (a >= 1e5) return `${sign}₹${(a / 1e5).toFixed(1)}L`;
  if (a >= 1e3) return `${sign}₹${(a / 1e3).toFixed(1)}k`;
  return `${sign}₹${Math.round(a)}`;
}
