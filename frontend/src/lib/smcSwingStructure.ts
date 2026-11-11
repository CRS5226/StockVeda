// Swing-based market structure (BOS / ChoCH / HH-HL-LH-LL), the common indicator-style rules.
// Every confirmed swing counts, so it marks far more breaks than the lecture mapper in
// smcStructure.ts, whose swings must pass the liquidity-take + body-close tests and whose BOS needs
// an IDM first. Chart-overlay only. Returns the same shape as mapStructure (no IDM, no legs).

import { barKey } from "./barTime";
import type { StructureMap, StructureEvent, StructurePoint } from "./smcStructure";

interface OhlcvRow { date: string; open: number; high: number; low: number; close: number }

export interface SwingStructureOptions {
  /** Bars on each side a swing must out-reach. Smaller = more swings and more breaks. Default 3. */
  length?: number;
  /** "close": a body close beyond the swing breaks it (default). "wick": a wick through is enough. */
  breakOn?: "close" | "wick";
}

export const DEFAULT_SWING_LENGTH = 3;

interface Level { index: number; price: number; broken: boolean }

/** A bar whose high is the highest of `L` bars either side (ties on the right do not count). */
function isSwingHighAt(o: OhlcvRow[], p: number, L: number): boolean {
  for (let j = p - L; j <= p + L; j++) {
    if (j === p) continue;
    if (j < p ? o[j].high > o[p].high : o[j].high >= o[p].high) return false;
  }
  return true;
}

function isSwingLowAt(o: OhlcvRow[], p: number, L: number): boolean {
  for (let j = p - L; j <= p + L; j++) {
    if (j === p) continue;
    if (j < p ? o[j].low < o[p].low : o[j].low <= o[p].low) return false;
  }
  return true;
}

export interface SwingLevelPoint {
  date: string;
  index: number;
  price: number;
  side: "high" | "low";
  /** S = short-term (every swing), I = intermediate, L = long-term. */
  level: "S" | "I" | "L";
}

/**
 * The zigzag: the swings in time order as one alternating high / low line. Two swings of the same side
 * in a row (no opposite swing between them) collapse to the more extreme one.
 */
export function zigzagPoints(ohlcv: OhlcvRow[], length: number = DEFAULT_SWING_LENGTH): SwingLevelPoint[] {
  const out: SwingLevelPoint[] = [];
  for (const p of classifySwingLevels(ohlcv, length)) {
    const last = out[out.length - 1];
    if (last && last.index === p.index) continue; // an outside bar can be both; one point per bar
    if (!last || last.side !== p.side) out.push(p);
    else if (p.side === "high" ? p.price > last.price : p.price < last.price) out[out.length - 1] = p;
  }
  return out;
}

/**
 * Swing hierarchy: STH/STL are the plain swings; an ITH is an STH with a lower STH on both sides (an
 * ITL: a higher STL on both sides); an LTH is an ITH with a lower ITH on both sides (LTL likewise).
 * The first and last swing of each kind have no neighbour on one side, so they are never promoted.
 */
export function classifySwingLevels(ohlcv: OhlcvRow[], length: number = DEFAULT_SWING_LENGTH): SwingLevelPoint[] {
  const L = Math.max(1, Math.floor(length));
  const out: SwingLevelPoint[] = [];
  for (const side of ["high", "low"] as const) {
    const isHigh = side === "high";
    const price = (i: number) => (isHigh ? ohlcv[i].high : ohlcv[i].low);
    const swings: number[] = [];
    for (let p = L; p < ohlcv.length - L; p++) {
      if (isHigh ? isSwingHighAt(ohlcv, p, L) : isSwingLowAt(ohlcv, p, L)) swings.push(p);
    }
    // keep the swings that stand out from both neighbours in the given sequence
    const promote = (seq: number[]) =>
      seq.filter((_, i) => i > 0 && i < seq.length - 1
        && (isHigh
          ? price(seq[i]) > price(seq[i - 1]) && price(seq[i]) > price(seq[i + 1])
          : price(seq[i]) < price(seq[i - 1]) && price(seq[i]) < price(seq[i + 1])));
    const inter = promote(swings);
    const long = new Set(promote(inter));
    const interSet = new Set(inter);
    swings.forEach((p) => out.push({
      date: barKey(ohlcv[p].date), index: p, price: price(p), side,
      level: long.has(p) ? "L" : interSet.has(p) ? "I" : "S",
    }));
  }
  return out.sort((a, b) => a.index - b.index);
}

/**
 * Rules:
 *  - A swing high (low) is a bar whose high (low) is the highest (lowest) of `length` bars either
 *    side. It is known `length` bars later, and a break can only happen from that bar on.
 *  - The latest unbroken swing high is the level up-breaks are measured against; the same goes for
 *    the latest swing low and down-breaks.
 *  - A break in the direction of the current trend is a BOS; a break against it flips the trend and
 *    is a ChoCH. The first break seen is a BOS.
 *  - Swings are tagged HH / LH against the previous swing high and HL / LL against the previous swing low.
 */
export function mapSwingStructure(ohlcv: OhlcvRow[], opts: SwingStructureOptions = {}): StructureMap {
  const events: StructureEvent[] = [];
  const points: StructurePoint[] = [];
  const legs: StructureMap["legs"] = [];
  const L = Math.max(1, Math.floor(opts.length ?? DEFAULT_SWING_LENGTH));
  const wick = opts.breakOn === "wick";
  const n = ohlcv.length;
  if (n < 2 * L + 2) return { events, points, legs };

  const date = (i: number) => barKey(ohlcv[i].date);
  const isSwingHigh = (p: number) => isSwingHighAt(ohlcv, p, L);
  const isSwingLow = (p: number) => isSwingLowAt(ohlcv, p, L);

  let high: Level | null = null; // latest swing high, the up-break level while unbroken
  let low: Level | null = null;
  let prevHigh: number | null = null; // previous swing high / low price, for the HH / LH / HL / LL tags
  let prevLow: number | null = null;
  let trend = 0; // +1 up, -1 down, 0 not yet known

  for (let k = 0; k < n; k++) {
    const p = k - L; // the bar whose swing status is now known
    if (p >= L) {
      if (isSwingHigh(p)) {
        const price = ohlcv[p].high;
        if (prevHigh !== null && price !== prevHigh) {
          points.push({ type: price > prevHigh ? "HH" : "LH", date: date(p), price, confirmedDate: date(k) });
        }
        prevHigh = price;
        high = { index: p, price, broken: false };
      }
      if (isSwingLow(p)) {
        const price = ohlcv[p].low;
        if (prevLow !== null && price !== prevLow) {
          points.push({ type: price > prevLow ? "HL" : "LL", date: date(p), price, confirmedDate: date(k) });
        }
        prevLow = price;
        low = { index: p, price, broken: false };
      }
    }

    const upBreak = !!high && !high.broken && (wick ? ohlcv[k].high : ohlcv[k].close) > high.price;
    const downBreak = !!low && !low.broken && (wick ? ohlcv[k].low : ohlcv[k].close) < low.price;
    // Both on one bar is rare; the bar's own direction decides which break it is.
    const takeUp = upBreak && (!downBreak || ohlcv[k].close >= ohlcv[k].open);
    const takeDown = downBreak && !takeUp;

    if (takeUp && high) {
      events.push({
        date: date(k), type: trend < 0 ? "ChoCH" : "BOS", direction: "bullish",
        level: high.price, fromDate: date(high.index),
      });
      high.broken = true;
      trend = 1;
    } else if (takeDown && low) {
      events.push({
        date: date(k), type: trend > 0 ? "ChoCH" : "BOS", direction: "bearish",
        level: low.price, fromDate: date(low.index),
      });
      low.broken = true;
      trend = -1;
    }
  }
  return { events, points, legs };
}
