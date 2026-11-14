// Pure helpers for the lines and rectangles drawn on the Charts page. Times are anchored to bars, so
// moving a drawing is done in bar indexes (also past the last bar).

import type { ChartDrawing, DrawingDraft } from "./api";
import { indexToTime, normTime, timeToIndex, toApiTime } from "./tradePlot";

export type DrawKind = ChartDrawing["kind"];

export const DRAW_COLORS = ["#3b82f6", "#22c55e", "#ef4444", "#f59e0b", "#a855f7", "#94a3b8"];
export const DEFAULT_DRAW_COLOR = DRAW_COLORS[0];

/** Which anchor values a drag handle controls: time 1 or 2, price 1 or 2 (either may be absent). */
export interface Handle { t?: 1 | 2; p?: 1 | 2 }

const round2 = (n: number) => Math.round(n * 100) / 100;

export function toDrawingDraft(d: ChartDrawing): DrawingDraft {
  const { id: _id, created_at: _c, updated_at: _u, ...draft } = d; // eslint-disable-line @typescript-eslint/no-unused-vars
  return draft;
}

/** A finished drawing from two clicks. A horizontal line keeps the first click's price and runs to the second click's time. */
export function newDrawing(
  symbol: string, kind: DrawKind, a: { time: string; price: number }, b: { time: string; price: number } = a,
): DrawingDraft {
  const price1 = round2(a.price);
  return {
    symbol, kind, color: DEFAULT_DRAW_COLOR,
    time1: toApiTime(a.time), price1,
    time2: toApiTime(b.time), price2: kind === "hline" ? price1 : round2(b.price),
  };
}

/** Moves the anchor values a handle controls to a new time and price. A horizontal line keeps both prices equal. */
export function applyHandle(d: DrawingDraft, h: Handle, time: string, price: number): DrawingDraft {
  const next = { ...d };
  const p = round2(price);
  if (h.t === 1) next.time1 = toApiTime(time);
  if (h.t === 2) next.time2 = toApiTime(time);
  if (h.p === 1) next.price1 = p;
  if (h.p === 2) next.price2 = p;
  if (next.kind === "hline" && h.p) { next.price1 = p; next.price2 = p; }
  return next;
}

/** The whole drawing shifted by whole bars and a price. Null if a price would go to 0 or below. */
export function translate(d: DrawingDraft, barTimes: string[], dIndex: number, dPrice: number): DrawingDraft | null {
  const shift = (t: string) => (dIndex === 0
    ? t
    : toApiTime(indexToTime(barTimes, Math.max(0, timeToIndex(barTimes, normTime(t)) + dIndex))));
  const price1 = round2(d.price1 + dPrice), price2 = round2(d.price2 + dPrice);
  if (price1 <= 0 || price2 <= 0) return null;
  return { ...d, time1: shift(d.time1), time2: shift(d.time2), price1, price2 };
}
