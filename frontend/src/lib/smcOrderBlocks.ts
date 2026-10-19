// SMC order blocks that follow the structure map — client-side, chart-overlay only.
// Rules from lectures/YTlecture "order block / FVG / order flow" (issue #87): blocks are searched only
// inside a leg's pullback (IDM -> protected HL/LH), the block is the last selling (buying) candle before
// the move, and it is only valid with an FVG on its far side. The older colour-based detector in
// smcZones.ts stays for smcBlocks.ts (breaker / reclaimed / mitigation) until those are reworked.

import { buildCandles, findSwings, mapStructure, type Candle, type StructureLeg } from "./smcStructure";

interface OhlcvRow { date: string; open: number; high: number; low: number; close: number }

export interface OrderBlock {
  direction: "bullish" | "bearish";
  /** Which of the two blocks that matter in a leg this is: next to the IDM, or at the HL/LH (ChoCH point). */
  role: "nearIdm" | "extreme";
  /** Candle index (into `buildCandles(ohlcv)`) of the block candle. */
  k: number;
  date: string;
  top: number;
  bottom: number;
  /** The FVG on the block's far side that makes it valid: it opens at the block candle. */
  fvg: { top: number; bottom: number; endK: number };
  /** Index of the leg in `StructureMap.legs` the block was found in. */
  leg: number;
  /** CE: the 50% midpoint of the block. */
  ce: number;
  /**
   * unmitigated: price has not come back; partial: it wicked into the block but never traded through
   * it; full: it traded through the far edge. Judged on the bars after the displacement candle.
   */
  status: "unmitigated" | "partial" | "full";
  /** Candle index where the block was fully mitigated; the last candle while it is still standing. */
  endK: number;
  /**
   * Alchemy 4-candle filter, close version: the 4th candle after the block candle closes beyond the
   * block's far edge (above its high for bullish, below its low for bearish). null while that candle
   * has not formed yet.
   */
  followThrough: boolean | null;
}

type RawBlock = Omit<OrderBlock, "ce" | "status" | "endK" | "followThrough">;

/** Adds the CE, the mitigation status and the 4-candle check. */
function describeBlock(c: Candle[], b: RawBlock): OrderBlock {
  const bull = b.direction === "bullish";
  let status: OrderBlock["status"] = "unmitigated";
  let endK = c.length - 1;
  for (let j = b.fvg.endK + 1; j < c.length; j++) {
    if (bull ? c[j].low <= b.bottom : c[j].high >= b.top) { status = "full"; endK = j; break; }
    if (bull ? c[j].low <= b.top : c[j].high >= b.bottom) status = "partial";
  }
  const f = b.k + 4;
  const followThrough = f < c.length ? (bull ? c[f].close > b.top : c[f].close < b.bottom) : null;
  return { ...b, ce: (b.top + b.bottom) / 2, status, endK, followThrough };
}

/**
 * Blocks for one leg. For a bullish leg the pullback runs down from the bar that took the IDM to the HL;
 * the block is the candle at a pullback low (lowest low, whatever its colour) that is followed by an
 * up-move leaving an FVG above it. Only two blocks matter: the first pullback low after the IDM, and
 * the one at the HL itself. Bearish legs mirror this. Inside bars: nested bars are already folded into
 * their inside bar by buildCandles, so each candle here is one lecture "candle".
 */
export function detectLegBlocks(c: Candle[], leg: StructureLeg, legIndex = 0): OrderBlock[] {
  const d = leg.direction === "bullish" ? 1 : -1;
  const n = c.length;
  // far end of the move that follows a block: the leg's HH/LL being reached, or the data's end
  const reached = (j: number) => (d > 0 ? c[j].high > leg.extreme.price : c[j].low < leg.extreme.price);
  const fvgAt = (k: number, bound: number) => {
    if (k + 2 > Math.min(bound, n - 1)) return null;
    const a = c[k], b = c[k + 2];
    if (d > 0 && a.high < b.low) return { top: b.low, bottom: a.high, endK: k + 2 };
    if (d < 0 && a.low > b.high) return { top: a.low, bottom: b.high, endK: k + 2 };
    return null;
  };

  /** From pullback extreme `k`, shift along the move to the first candle with an FVG on its far side. */
  const blockFrom = (k: number, role: OrderBlock["role"]): OrderBlock | null => {
    let bound = n - 1;
    for (let j = k + 1; j < n; j++) if (reached(j)) { bound = j; break; }
    for (let j = k; j <= bound; j++) {
      const fvg = fvgAt(j, bound + 2);
      if (fvg) {
        return describeBlock(c, {
          direction: leg.direction, role, k: j, date: c[j].date, top: c[j].high, bottom: c[j].low, fvg, leg: legIndex,
        });
      }
    }
    return null;
  };

  // first valid pullback low (high, when bearish) after the IDM was taken, short of the HL/LH itself
  const nearK = findSwings(c, leg.from, leg.to, d > 0 ? "low" : "high").map((s) => s.k).find((k) => k < leg.to);
  const out: OrderBlock[] = [];
  const near = nearK !== undefined ? blockFrom(nearK, "nearIdm") : null;
  const far = blockFrom(leg.to, "extreme");
  if (near) out.push(near);
  if (far && !(near && near.k === far.k)) out.push(far);
  if (near && far && near.k === far.k) near.role = "extreme"; // one and the same candle
  return out;
}

/** Order blocks for the whole chart: map the structure, then search each leg's pullback. */
export function detectStructureOrderBlocks(ohlcv: OhlcvRow[]): OrderBlock[] {
  const map = mapStructure(ohlcv);
  if (!map.legs.length) return [];
  const c = buildCandles(ohlcv);
  return map.legs.flatMap((leg, i) => detectLegBlocks(c, leg, i));
}

export interface AdvancedBlock {
  direction: "bullish" | "bearish";
  /** Candle range (into `buildCandles(ohlcv)`) of the run of same-colour candles the block is built from. */
  runFrom: number;
  runTo: number;
  date: string;
  top: number;
  bottom: number;
  /** The 50% mean threshold of the drawn zone: a body close beyond it invalidates the block. */
  mean: number;
  /** True when the zone was cut down to where the block overlaps an unfilled FVG. */
  fvgOverlap: boolean;
  /** Candle index of the invalidating body close, or null while the block stands. */
  invalidatedK: number | null;
  leg: number;
}

/**
 * Advanced order block (no FVG needed), from the block-types lecture. At the end of a leg's pullback
 * it takes the whole run of consecutive selling candles (buying, when bearish) ending at the last one
 * before the move, not a single candle; inside bars do not end the run, an opposite candle does.
 * If that run overlaps an unfilled FVG, only the overlap is used, else the whole run and its 50%.
 */
export function detectAdvancedBlock(c: Candle[], leg: StructureLeg, legIndex = 0): AdvancedBlock | null {
  const d = leg.direction === "bullish" ? 1 : -1;
  const n = c.length;
  const same = (k: number) => (d > 0 ? c[k].close < c[k].open : c[k].close > c[k].open);

  let end = leg.to;
  while (end >= leg.from && (c[end].inside || !same(end))) end--;
  if (end < leg.from) return null;
  let start = end;
  for (let k = end - 1; k >= leg.from; k--) {
    if (c[k].inside) continue;
    if (!same(k)) break;
    start = k;
  }
  let top = -Infinity, bottom = Infinity;
  for (let k = start; k <= end; k++) { top = Math.max(top, c[k].high); bottom = Math.min(bottom, c[k].low); }

  // unfilled FVG of the move that follows, which the run's range overlaps
  let bound = n - 1;
  for (let j = end + 1; j < n; j++) {
    if (d > 0 ? c[j].high > leg.extreme.price : c[j].low < leg.extreme.price) { bound = j; break; }
  }
  let overlap: { top: number; bottom: number } | null = null;
  for (let k = start; k + 2 <= Math.min(bound + 2, n - 1); k++) {
    const a = c[k], b = c[k + 2];
    const gap = d > 0 ? (a.high < b.low ? { top: b.low, bottom: a.high } : null) : (a.low > b.high ? { top: a.low, bottom: b.high } : null);
    if (!gap) continue;
    let filled = false;
    for (let j = k + 3; j < n && !filled; j++) filled = d > 0 ? c[j].low <= gap.bottom : c[j].high >= gap.top;
    if (filled || gap.top < bottom || gap.bottom > top) continue;
    overlap = { top: Math.min(top, gap.top), bottom: Math.max(bottom, gap.bottom) };
    break;
  }
  const zone = overlap ?? { top, bottom };
  const mean = (zone.top + zone.bottom) / 2;
  let invalidatedK: number | null = null;
  for (let j = end + 1; j < n; j++) {
    if (d > 0 ? c[j].close < mean : c[j].close > mean) { invalidatedK = j; break; }
  }
  return {
    direction: leg.direction, runFrom: start, runTo: end, date: c[start].date, top: zone.top, bottom: zone.bottom,
    mean, fvgOverlap: !!overlap, invalidatedK, leg: legIndex,
  };
}

/** Advanced order blocks for the whole chart, one per leg. */
export function detectAdvancedOrderBlocks(ohlcv: OhlcvRow[]): AdvancedBlock[] {
  const map = mapStructure(ohlcv);
  if (!map.legs.length) return [];
  const c = buildCandles(ohlcv);
  return map.legs.flatMap((leg, i) => detectAdvancedBlock(c, leg, i) ?? []);
}
