// Maths and time helpers for the trade boxes plotted on the Charts page. Pure, so it can be tested.

import type { PlotDraft, PlottedTrade } from "./api";

export type PlotSide = PlottedTrade["side"];

/** Stop-loss and target, as a percent of the entry, a new box starts with. */
export const DEFAULT_STOP_PCT = 1;
export const DEFAULT_TARGET_PCT = 2;
/** Bars a new box is drawn across. */
export const DEFAULT_WIDTH_BARS = 20;

const dir = (side: PlotSide) => (side === "long" ? 1 : -1);
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Stop-loss and target for a new box: below / above a long's entry, above / below a short's. */
export function defaultLevels(side: PlotSide, entry: number, stopPct = DEFAULT_STOP_PCT, targetPct = DEFAULT_TARGET_PCT) {
  const d = dir(side);
  return {
    stop_loss: round2(entry * (1 - (d * stopPct) / 100)),
    target: round2(entry * (1 + (d * targetPct) / 100)),
  };
}

/** Why three prices cannot be a trade box, or null. Same rules as the backend. */
export function validatePlot(side: PlotSide, entry: number, stop: number, target: number): string | null {
  if (![entry, stop, target].every((n) => Number.isFinite(n) && n > 0)) return "Prices must be above 0.";
  const long = side === "long";
  if (long ? stop >= entry : stop <= entry) return long ? "A long needs its stop-loss below the entry price." : "A short needs its stop-loss above the entry price.";
  if (long ? target <= entry : target >= entry) return long ? "A long needs its target above the entry price." : "A short needs its target below the entry price.";
  return null;
}

/** A dragged stop-loss or target pulled back to the nearest valid price (a hair beyond the entry). */
export function clampLevel(side: PlotSide, entry: number, kind: "stop" | "target", level: number): number {
  const margin = entry * 0.0001;
  const below = (kind === "stop") === (side === "long"); // the level belongs below the entry
  return below ? Math.min(level, entry - margin) : Math.max(level, entry + margin);
}

export interface LevelStats {
  price: number;
  /** Distance from the entry in the trade's favour: positive for a target, negative for a stop-loss. */
  points: number;
  pct: number;
  /** points x quantity; null when no quantity is set. */
  money: number | null;
}

export interface PlotMetrics {
  target: LevelStats;
  stop: LevelStats;
  /** Reward divided by risk, null when there is no risk. */
  rr: number | null;
}

export function plotMetrics(t: Pick<PlottedTrade, "side" | "entry_price" | "stop_loss" | "target" | "qty">): PlotMetrics {
  const d = dir(t.side);
  const stats = (price: number): LevelStats => {
    const points = (price - t.entry_price) * d;
    return { price, points, pct: (points / t.entry_price) * 100, money: t.qty ? points * t.qty : null };
  };
  const target = stats(t.target), stop = stats(t.stop_loss);
  return { target, stop, rr: stop.points < 0 ? target.points / -stop.points : null };
}

// ── Time ───────────────────────────────────────────────────────────────────

/** "YYYY-MM-DD HH:MM:SS" for a bar key or an API time, so times compare as plain strings. */
export function normTime(t: string): string {
  const s = t.replace("T", " ");
  return s.length <= 10 ? `${s} 00:00:00` : s.slice(0, 19);
}

export const toApiTime = (norm: string) => norm.replace(" ", "T");

const epoch = (norm: string) => Date.parse(norm.replace(" ", "T") + "Z") / 1000;

function fromEpoch(sec: number): string {
  return new Date(sec * 1000).toISOString().slice(0, 19).replace("T", " ");
}

/** Index of the last bar at or before `t` (bar times normalised and ascending), or -1 when `t` is before the first. */
export function barIndexAtOrBefore(barTimes: string[], t: string): number {
  let lo = 0, hi = barTimes.length - 1, found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (barTimes[mid] <= t) { found = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return found;
}

/** Seconds between bars: the smallest gap among the last few (so a weekend gap does not count). */
function barStep(barTimes: string[]): number {
  let step = Infinity;
  for (let i = Math.max(1, barTimes.length - 10); i < barTimes.length; i++) {
    const gap = epoch(barTimes[i]) - epoch(barTimes[i - 1]);
    if (gap > 0) step = Math.min(step, gap);
  }
  return Number.isFinite(step) ? step : 86400;
}

/** Chart bar index for a time; a time after the last bar maps to an index past the end, one bar per step. */
export function timeToIndex(barTimes: string[], t: string): number {
  if (barTimes.length === 0) return -1;
  const last = barTimes.length - 1;
  if (t <= barTimes[last]) return barIndexAtOrBefore(barTimes, t);
  return last + Math.max(1, Math.round((epoch(t) - epoch(barTimes[last])) / barStep(barTimes)));
}

/** A time as the chart reports it (date string, epoch seconds or a business-day object) in the normalised form. */
export function chartTimeToNorm(time: string | number | { year: number; month: number; day: number }): string {
  if (typeof time === "number") return fromEpoch(time);
  if (typeof time === "string") return normTime(time);
  return `${time.year}-${String(time.month).padStart(2, "0")}-${String(time.day).padStart(2, "0")} 00:00:00`;
}

/** The fields the API stores for a plotted trade. */
export function toDraft(p: PlottedTrade): PlotDraft {
  const { id: _id, created_at: _c, updated_at: _u, ...draft } = p; // eslint-disable-line @typescript-eslint/no-unused-vars
  return draft;
}

/** The time of a bar index, also for an index past the last bar. */
export function indexToTime(barTimes: string[], index: number): string {
  const last = barTimes.length - 1;
  if (index <= last) return barTimes[Math.max(0, index)];
  return fromEpoch(epoch(barTimes[last]) + (index - last) * barStep(barTimes));
}

/** A new box starting at bar `index`: draft levels from the entry price and the default width. */
export function newPlotDraft(symbol: string, side: PlotSide, barTimes: string[], index: number, entry: number): PlotDraft {
  const levels = defaultLevels(side, entry);
  return {
    symbol, side, entry_price: round2(entry), ...levels, qty: null, note: "",
    entry_time: toApiTime(barTimes[index]),
    end_time: toApiTime(indexToTime(barTimes, index + DEFAULT_WIDTH_BARS)),
  };
}
