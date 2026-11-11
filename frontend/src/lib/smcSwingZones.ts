// Order blocks and fair value gaps found inside the legs that broke structure, following the ICT notes
// (4.2 order blocks, 4.4 FVG, 3.6 "plot the zone inside the leg that caused the break"). The order block
// is the pivot candle of the leg (its lowest low / highest high), one single candle. The legs come
// from the every-swing structure map (smcSwingStructure.ts), so every BOS / ChoCH has its own leg.
// Chart-overlay only. The lecture-rule detectors in smcOrderBlocks.ts / smcFvg.ts stay for the Backtest tab.

import { barKey } from "./barTime";
import { classifyFvg, detectInverseFvgs, judgeFvg, type Fvg, type FvgType } from "./smcFvg";
import { classifySwingLevels, mapSwingStructure, type SwingStructureOptions } from "./smcSwingStructure";

interface OhlcvRow { date: string; open: number; high: number; low: number; close: number }

/** The leg that caused one BOS / ChoCH: from the swing it broke, down (up) to its extreme, then to the break bar. */
interface BreakLeg {
  direction: "bullish" | "bearish";
  pivotK: number;   // the swing that was broken
  originK: number;  // lowest low (highest high when bearish) between that swing and the break: where the impulse starts
  breakK: number;   // the bar that closed beyond the swing
}

export interface SwingOrderBlock {
  direction: "bullish" | "bearish";
  k: number;
  date: string;
  top: number;      // full range, wick to wick
  bottom: number;
  ce: number;       // 50% of the range
  /**
   * unmitigated: price has not come back; partial: it wicked into the block and the close held;
   * full: a candle closed through the far side, so the block is invalidated.
   */
  status: "unmitigated" | "partial" | "full";
  /** Candle index where it was invalidated; the last candle while it still stands. */
  endK: number;
  endDate: string;
  /** 4-candle rule, close version: the 4th candle after the block closes beyond its far edge; null until it forms. */
  followThrough: boolean | null;
}

/** Plain bars with the bar key as their date, so zone dates line up with the chart's time axis. */
function keyed(ohlcv: OhlcvRow[]) {
  return ohlcv.map((r) => ({ date: barKey(r.date), open: r.open, high: r.high, low: r.low, close: r.close }));
}

function breakLegs(rows: ReturnType<typeof keyed>, opts: SwingStructureOptions): BreakLeg[] {
  const map = mapSwingStructure(rows, opts);
  const at = new Map(rows.map((r, i) => [r.date, i] as const));
  const legs: BreakLeg[] = [];
  for (const ev of map.events) {
    const pivotK = at.get(ev.fromDate);
    const breakK = at.get(ev.date);
    if (pivotK === undefined || breakK === undefined || pivotK >= breakK) continue;
    const bull = ev.direction === "bullish";
    let originK = pivotK;
    for (let j = pivotK; j <= breakK; j++) {
      if (bull ? rows[j].low < rows[originK].low : rows[j].high > rows[originK].high) originK = j;
    }
    if (originK >= breakK) continue;
    legs.push({ direction: ev.direction, pivotK, originK, breakK });
  }
  return legs;
}

/**
 * One block per leg that broke structure: the leg's pivot candle, i.e. the candle at the lowest low of a
 * bullish leg (highest high of a bearish one), whatever its colour. It is a single candle, not a run of
 * candles. Drawn over its full range with a CE line. Status is judged on the bars after the break: a
 * wick into the zone that holds is partial, a close through the far side invalidates it.
 */
export function detectSwingOrderBlocks(ohlcv: OhlcvRow[], opts: SwingStructureOptions = {}): SwingOrderBlock[] {
  const rows = keyed(ohlcv);
  const n = rows.length;
  const seen = new Set<string>();
  const out: SwingOrderBlock[] = [];
  for (const leg of breakLegs(rows, opts)) {
    const k = leg.originK;
    const key = `${leg.direction}:${k}`;
    if (seen.has(key)) continue; // a ChoCH and a later BOS can share an origin
    seen.add(key);
    const bull = leg.direction === "bullish";
    const { high: top, low: bottom } = rows[k];
    let status: SwingOrderBlock["status"] = "unmitigated";
    let endK = n - 1;
    for (let j = leg.breakK + 1; j < n; j++) {
      if (bull ? rows[j].close < bottom : rows[j].close > top) { status = "full"; endK = j; break; }
      if (bull ? rows[j].low <= top : rows[j].high >= bottom) status = "partial";
    }
    const f = k + 4;
    out.push({
      direction: leg.direction, k, date: rows[k].date, top, bottom, ce: (top + bottom) / 2, status, endK,
      endDate: rows[endK].date,
      followThrough: f < n ? (bull ? rows[f].close > top : rows[f].close < bottom) : null,
    });
  }
  return out;
}

/**
 * FVGs anywhere in a leg that broke structure, from the swing it broke to the break bar. The gap is
 * candle 1's wick to candle 3's wick; no gap, no FVG. A gap that opens at the order block candle is
 * `attached` (the notes: a block is stronger when the displacement leaves an FVG), the rest are
 * drawn dimmer. Inverse gaps that price later closed through are added, drawn from the three candles where the gap first formed.
 */
export function detectSwingFvgs(ohlcv: OhlcvRow[], opts: SwingStructureOptions = {}): Fvg[] {
  const rows = keyed(ohlcv);
  const seen = new Set<string>();
  const fvgs: Fvg[] = [];
  breakLegs(rows, opts).forEach((leg, legIndex) => {
    const d = leg.direction === "bullish" ? 1 : -1;
    for (let k = leg.pivotK; k + 2 <= leg.breakK; k++) {
      const a = rows[k], b = rows[k + 2];
      const gap = d > 0 ? (a.high < b.low ? { top: b.low, bottom: a.high } : null) : (a.low > b.high ? { top: a.low, bottom: b.high } : null);
      const key = `${leg.direction}:${k}`;
      if (!gap || seen.has(key)) continue;
      seen.add(key);
      const m = judgeFvg(rows, k + 3, gap.top, gap.bottom, d);
      fvgs.push({
        type: classifyFvg(rows, k, d), direction: leg.direction, k, date: rows[k].date, ...gap, ...m,
        endDate: rows[m.endK].date, attached: k === leg.originK, leg: legIndex,
      });
    }
  });

  return [...fvgs, ...dropCoveredIfvgs(fvgs, detectInverseFvgs(rows, fvgs, { fromOrigin: true }))];
}


/** Where a zone stands after the break: untouched, wicked into with the close holding, or closed through its far side. */
function judgeZone(rows: ReturnType<typeof keyed>, from: number, top: number, bottom: number, bull: boolean) {
  let status: SwingOrderBlock["status"] = "unmitigated";
  let endK = rows.length - 1;
  for (let j = from; j < rows.length; j++) {
    if (bull ? rows[j].close < bottom : rows[j].close > top) { status = "full"; endK = j; break; }
    if (bull ? rows[j].low <= top : rows[j].high >= bottom) status = "partial";
  }
  return { status, endK };
}

/** An IFVG is dropped when at least this share of its band is already covered by a same-direction gap. */
export const IFVG_OVERLAP = 0.5;

/**
 * An IFVG whose band is already marked by a same-direction gap, or by an earlier IFVG, adds nothing: bullish
 * and bearish gaps often share a price band, so most inversions just repeat a gap that is already drawn.
 */
export function dropCoveredIfvgs(fvgs: Fvg[], ifvgs: Fvg[]): Fvg[] {
  const kept: Fvg[] = [];
  for (const i of ifvgs) {
    const size = i.top - i.bottom;
    const covered = [...fvgs, ...kept].some((o) =>
      o.direction === i.direction
      && Math.min(i.top, o.top) - Math.max(i.bottom, o.bottom) >= IFVG_OVERLAP * size);
    if (!covered) kept.push(i);
  }
  return kept;
}

/** A wick has to be at least this share of the candle's range to make a rejection block (Alchemy's rule of thumb). */
export const REJECTION_WICK = 0.4;

export interface SwingTypedBlock {
  kind: "breaker" | "mitigation" | "rejection";
  direction: "bullish" | "bearish";
  k: number;
  date: string;
  top: number;
  bottom: number;
  ce: number;
  status: SwingOrderBlock["status"];
  endK: number;
  endDate: string;
}

/**
 * Block types, following the Alchemy Markets guides:
 *  - Breaker / mitigation: the order block a structure break runs through. For a bullish break that is
 *    the candle at the swing high that was broken (a bearish order block), full range. If the leg that
 *    made the break first took the previous swing low (its low is below it) it is a breaker; if the
 *    leg held above that low (a failure swing, a higher low) it is a mitigation block. Either way the
 *    zone now supports price on a retest; a bearish break mirrors this.
 *  - Rejection: the leg's pivot (stop) candle when its wick is at least 40% of its range. Only the wick
 *    is the zone: low to body bottom for a bullish pivot, body top to high for a bearish one.
 * Status is judged on the bars after the break, like the order block.
 */
export function detectSwingTypedBlocks(ohlcv: OhlcvRow[], opts: SwingStructureOptions = {}): SwingTypedBlock[] {
  const rows = keyed(ohlcv);
  const swings = classifySwingLevels(ohlcv, opts.length);
  const seen = new Set<string>();
  const out: SwingTypedBlock[] = [];
  const add = (kind: SwingTypedBlock["kind"], leg: BreakLeg, k: number, top: number, bottom: number) => {
    const key = `${kind}:${leg.direction}:${k}`;
    if (seen.has(key)) return;
    seen.add(key);
    const bull = leg.direction === "bullish";
    const { status, endK } = judgeZone(rows, leg.breakK + 1, top, bottom, bull);
    out.push({ kind, direction: leg.direction, k, date: rows[k].date, top, bottom, ce: (top + bottom) / 2, status, endK, endDate: rows[endK].date });
  };

  for (const leg of breakLegs(rows, opts)) {
    const bull = leg.direction === "bullish";

    // breaker or mitigation block: the candle at the swing that was broken
    const ref = swings.filter((s) => s.side === (bull ? "low" : "high") && s.index < leg.pivotK).pop();
    if (ref) {
      const taken = bull ? rows[leg.originK].low < ref.price : rows[leg.originK].high > ref.price;
      const held = bull ? rows[leg.originK].low > ref.price : rows[leg.originK].high < ref.price;
      if (taken || held) add(taken ? "breaker" : "mitigation", leg, leg.pivotK, rows[leg.pivotK].high, rows[leg.pivotK].low);
    }

    // rejection block: the wick of the leg's pivot candle
    const p = rows[leg.originK];
    const range = p.high - p.low;
    const bodyEdge = bull ? Math.min(p.open, p.close) : Math.max(p.open, p.close);
    const wick = bull ? bodyEdge - p.low : p.high - bodyEdge;
    if (range > 0 && wick / range >= REJECTION_WICK) {
      add("rejection", leg, leg.originK, bull ? bodyEdge : p.high, bull ? p.low : bodyEdge);
    }
  }
  return out;
}

/** An order block drawn together with the FVG that opens at it: one zone, block candle range plus the gap. */
export interface SwingCombinedBlock {
  direction: "bullish" | "bearish";
  k: number;
  date: string;
  top: number;
  bottom: number;
  /** 50% of the whole combined zone. */
  ce: number;
  status: SwingOrderBlock["status"];
  endK: number;
  endDate: string;
  followThrough: boolean | null;
  fvgType: FvgType;
}

/**
 * Order block + FVG: a swing order block whose pivot candle is also candle 1 of an FVG, so the gap sits right
 * on the block's far side (above a bullish block, below a bearish one). The zone runs from the block's far
 * edge to the gap's far edge. Status and the 4-candle check come from the order block.
 */
export function detectSwingCombinedBlocks(ohlcv: OhlcvRow[], opts: SwingStructureOptions = {}): SwingCombinedBlock[] {
  const gaps = detectSwingFvgs(ohlcv, opts).filter((f) => f.type !== "IFVG" && f.attached);
  return detectSwingOrderBlocks(ohlcv, opts).flatMap((b) => {
    const gap = gaps.find((f) => f.direction === b.direction && f.k === b.k);
    if (!gap) return [];
    const top = Math.max(b.top, gap.top), bottom = Math.min(b.bottom, gap.bottom);
    return [{
      direction: b.direction, k: b.k, date: b.date, top, bottom, ce: (top + bottom) / 2, status: b.status,
      endK: b.endK, endDate: b.endDate, followThrough: b.followThrough, fvgType: gap.type,
    }];
  });
}
