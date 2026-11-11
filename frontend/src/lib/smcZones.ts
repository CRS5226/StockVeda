// SMC (Smart Money Concepts) price-zone detection — client-side, chart-overlay only.
// Basic colour-based order blocks, still used by smcBlocks.ts. The structure-aware order blocks and FVGs
// are in smcOrderBlocks.ts and smcFvg.ts. See GitHub issue #79 for the full concept list.

import { barKey } from "./barTime";

interface OhlcvRow { date: string; open: number; high: number; low: number; close: number }

export interface SmcZone {
  type: "orderBlock";
  direction: "bullish" | "bearish";
  startDate: string;
  endDate: string;
  top: number;
  bottom: number;
  /** Index (into the ohlcv array) of the zone's origin candle — used by smcBlocks.ts. */
  originIndex: number;
}

/** First bar from `fromIndex` onward whose range trades back into [bottom, top] — i.e. mitigation. */
function firstMitigationDate(ohlcv: OhlcvRow[], fromIndex: number, top: number, bottom: number): string {
  for (let i = fromIndex; i < ohlcv.length; i++) {
    if (ohlcv[i].low <= top && ohlcv[i].high >= bottom) return barKey(ohlcv[i].date);
  }
  return barKey(ohlcv[ohlcv.length - 1].date); // unmitigated — draw to the last bar
}

/**
 * Basic order-block definition: the last opposite-colour candle immediately before a
 * displacement candle that closes beyond it (a bearish candle followed by a bullish
 * candle closing above its high = bullish OB, and the mirror for bearish). The zone
 * is that candle's high/low, drawn until price first returns into it (mitigation).
 *
 * v1 — no displacement-size or unmitigated-zone filtering yet, so this can be noisy
 * on choppy data. Worth revisiting once BOS/ChoCH context is used to require the OB
 * precede an actual structure break rather than any local displacement.
 */
export function detectOrderBlocks(ohlcv: OhlcvRow[]): SmcZone[] {
  const zones: SmcZone[] = [];
  for (let i = 1; i < ohlcv.length; i++) {
    const prev = ohlcv[i - 1], curr = ohlcv[i];
    const prevDown = prev.close < prev.open;
    const prevUp   = prev.close > prev.open;
    const currUp   = curr.close > curr.open;
    const currDown = curr.close < curr.open;
    const top = prev.high, bottom = prev.low;

    if (prevDown && currUp && curr.close > prev.high) {
      zones.push({
        type: "orderBlock", direction: "bullish",
        startDate: barKey(prev.date),
        endDate: firstMitigationDate(ohlcv, i + 1, top, bottom),
        top, bottom, originIndex: i - 1,
      });
    }
    if (prevUp && currDown && curr.close < prev.low) {
      zones.push({
        type: "orderBlock", direction: "bearish",
        startDate: barKey(prev.date),
        endDate: firstMitigationDate(ohlcv, i + 1, top, bottom),
        top, bottom, originIndex: i - 1,
      });
    }
  }
  return zones;
}
