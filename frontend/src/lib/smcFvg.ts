// SMC fair value gaps that follow the structure map — client-side, chart-overlay only.
// Rules from lectures/YTlecture "order block / FVG / order flow" and the Alchemy Markets FVG guide
// (issue #88): gaps are searched along each leg, measured on candles with nested inside bars folded
// away, tagged with a mitigation status, a CE and a type (PFG / BFG / RFG / IFVG).

import { detectLegBlocks } from "./smcOrderBlocks";
import { buildCandles, mapStructure, type Candle, type StructureLeg } from "./smcStructure";

interface OhlcvRow { date: string; open: number; high: number; low: number; close: number }

/** Plain FVG, or one of the Alchemy types. IFVG is a gap that price cut through and that now works the other way. */
export type FvgType = "FVG" | "PFG" | "BFG" | "RFG" | "IFVG";

export interface Fvg {
  type: FvgType;
  direction: "bullish" | "bearish";
  /** Candle indexes (into `buildCandles(ohlcv)`): the first candle of the gap, and where the zone starts. */
  k: number;
  date: string;
  top: number;
  bottom: number;
  /** CE: the 50% midpoint. */
  ce: number;
  /** unmitigated: not revisited; partial: price tapped in but did not fill it; full: price filled it. */
  status: "unmitigated" | "partial" | "full";
  /** True once a candle has closed beyond the CE, after which a bounce off the gap is no longer valid. */
  ceBroken: boolean;
  /** Candle index where it was filled, else the last candle. */
  endK: number;
  endDate: string;
  /** The gap that makes an order block valid (see smcOrderBlocks.ts); other gaps are context only. */
  attached: boolean;
  leg: number;
}

/**
 * How a third candle compares with the middle one, as ratios of their high-low ranges. Alchemy gives no
 * numbers, so these are the chosen cut-offs: at most half the middle candle's range is a small
 * consolidation candle, at least three quarters of it is a large, expansive one.
 */
export const SMALL_THIRD = 0.5;
export const LARGE_THIRD = 0.75;

type Dir = 1 | -1;

/**
 * Type of the gap opened by candles k, k+1, k+2 (bullish shown, bearish mirrors):
 *  - RFG: the third candle closes back into the middle candle (below its high);
 *  - PFG: a small third candle that never trades back past the middle candle's close;
 *  - BFG: a large third candle that closes beyond the middle candle's extreme;
 *  - FVG: anything else.
 */
function classify(c: Candle[], k: number, d: Dir): FvgType {
  const mid = c[k + 1], third = c[k + 2];
  const ratio = (third.high - third.low) / Math.max(mid.high - mid.low, 1e-9);
  const closedBack = d > 0 ? third.close < mid.high : third.close > mid.low;
  const heldClose = d > 0 ? third.low >= mid.close : third.high <= mid.close;
  if (closedBack) return "RFG";
  if (ratio <= SMALL_THIRD && heldClose) return "PFG";
  if (ratio >= LARGE_THIRD) return "BFG";
  return "FVG";
}

/** Status, CE state and the end of a zone, judged on the candles after `from`. */
function judge(c: Candle[], from: number, top: number, bottom: number, d: Dir) {
  const ce = (top + bottom) / 2;
  let status: Fvg["status"] = "unmitigated";
  let ceBroken = false;
  let endK = c.length - 1;
  for (let j = from; j < c.length; j++) {
    if (d > 0 ? c[j].close < ce : c[j].close > ce) ceBroken = true;
    if (d > 0 ? c[j].low <= bottom : c[j].high >= top) { status = "full"; endK = j; break; }
    if (d > 0 ? c[j].low <= top : c[j].high >= bottom) status = "partial";
  }
  return { ce, status, ceBroken, endK };
}

/**
 * Gaps for one leg: only gaps in the leg's direction (bullish in an up-trend), from the bar that took
 * the IDM through the pullback and on to where the move reaches the leg's HH/LL again — nothing
 * between the HH/LL and the IDM. The gap is the space between the first candle's high and the third
 * candle's low (low and high when bearish); no gap, no FVG. `attached` marks the gap an order block
 * of this leg stands on.
 */
export function detectLegFvgs(c: Candle[], leg: StructureLeg, legIndex = 0): Fvg[] {
  const d: Dir = leg.direction === "bullish" ? 1 : -1;
  const n = c.length;
  let bound = n - 1;
  for (let j = leg.to + 1; j < n; j++) {
    if (d > 0 ? c[j].high > leg.extreme.price : c[j].low < leg.extreme.price) { bound = j; break; }
  }
  const attachedAt = new Set(detectLegBlocks(c, leg, legIndex).map((b) => b.k));
  const out: Fvg[] = [];
  for (let k = leg.from; k + 2 <= bound; k++) {
    const a = c[k], b = c[k + 2];
    const gap = d > 0 ? (a.high < b.low ? { top: b.low, bottom: a.high } : null) : (a.low > b.high ? { top: a.low, bottom: b.high } : null);
    if (!gap) continue;
    out.push({
      type: classify(c, k, d), direction: leg.direction, k, date: c[k].date, ...gap,
      ...judge(c, k + 3, gap.top, gap.bottom, d), endDate: "", attached: attachedAt.has(k), leg: legIndex,
    });
  }
  out.forEach((f) => { f.endDate = c[f.endK].date; });
  return out;
}

/**
 * Inverse FVG: a gap that price closed straight through. The zone keeps its edges but flips role — a
 * broken bullish gap becomes a bearish IFVG and the reverse — starting at the bar that closed through.
 */
export function detectInverseFvgs(c: Candle[], fvgs: Fvg[]): Fvg[] {
  const out: Fvg[] = [];
  fvgs.forEach((f) => {
    const d: Dir = f.direction === "bullish" ? 1 : -1;
    for (let j = f.k + 3; j < c.length; j++) {
      if (!(d > 0 ? c[j].close < f.bottom : c[j].close > f.top)) continue;
      const flip: Dir = d > 0 ? -1 : 1;
      const m = judge(c, j + 1, f.top, f.bottom, flip);
      out.push({
        type: "IFVG", direction: flip > 0 ? "bullish" : "bearish", k: j, date: c[j].date, top: f.top, bottom: f.bottom,
        ...m, endDate: c[m.endK].date, attached: false, leg: f.leg,
      });
      break;
    }
  });
  return out;
}

/** Fair value gaps for the whole chart, with the inverse ones that price has since created. */
export function detectStructureFvgs(ohlcv: OhlcvRow[]): Fvg[] {
  const map = mapStructure(ohlcv);
  if (!map.legs.length) return [];
  const c = buildCandles(ohlcv);
  const seen = new Set<string>();
  const fvgs = map.legs.flatMap((leg, i) => detectLegFvgs(c, leg, i)).filter((f) => {
    const key = `${f.direction}:${f.k}`; // neighbouring legs can share a bar range
    return seen.has(key) ? false : (seen.add(key), true);
  });
  return [...fvgs, ...detectInverseFvgs(c, fvgs)];
}
