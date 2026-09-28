// SMC (Smart Money Concepts) block-lifecycle detection — client-side, chart-overlay only.
// Breaker / Reclaimed / Mitigation blocks. See GitHub issue #79 for the full concept list.

import { detectOrderBlocks } from "./smcZones";

interface OhlcvRow { date: string; open: number; high: number; low: number; close: number }

export interface SmcBlockEvent {
  /** What happened to the underlying order block. */
  type: "breaker" | "reclaimed" | "mitigation";
  /**
   * Orientation to read the event as: for "mitigation" this is the OB's own direction
   * (it worked as intended); for "reclaimed" it's also the OB's original direction
   * (price came back and honoured it); for "breaker" it's the FLIPPED direction, since
   * a failed bullish OB becomes bearish resistance and vice versa.
   */
  direction: "bullish" | "bearish";
  date: string;   // bar where the event is confirmed
  index: number;
  top: number;
  bottom: number;
  originDate: string; // the underlying order block's origin candle
}

/**
 * v1 heuristic built on top of detectOrderBlocks: for each OB, walk forward bar by
 * bar and classify what happens to it —
 *  - price merely wicks into the zone without ever closing through the far edge →
 *    **mitigation** (the OB absorbed price as intended; zone's job is done).
 *  - price closes through the far edge (invalidating the OB), then a later close
 *    comes back onto the original side → **reclaimed** (the level held after all).
 *  - price closes through the far edge, then later retests the zone from the new
 *    side without reclaiming → **breaker** (zone flips polarity going forward).
 * Only the first such event per OB is recorded. This is a simplification — real
 * breaker/mitigation classification also considers how far price extends beyond
 * the zone and multiple retests, which this doesn't yet model.
 */
export function detectSmcBlocks(ohlcv: OhlcvRow[]): SmcBlockEvent[] {
  const events: SmcBlockEvent[] = [];

  detectOrderBlocks(ohlcv).forEach((ob) => {
    let invalidatedAt = -1;

    for (let i = ob.originIndex + 1; i < ohlcv.length; i++) {
      const bar = ohlcv[i];
      const touchesZone = bar.low <= ob.top && bar.high >= ob.bottom;

      if (invalidatedAt < 0) {
        const invalidated = ob.direction === "bullish" ? bar.close < ob.bottom : bar.close > ob.top;
        if (invalidated) { invalidatedAt = i; continue; }
        if (touchesZone) {
          events.push({
            type: "mitigation", direction: ob.direction,
            date: bar.date.slice(0, 10), index: i,
            top: ob.top, bottom: ob.bottom, originDate: ob.startDate,
          });
          break;
        }
      } else {
        const reclaimed = ob.direction === "bullish" ? bar.close > ob.bottom : bar.close < ob.top;
        if (reclaimed) {
          events.push({
            type: "reclaimed", direction: ob.direction,
            date: bar.date.slice(0, 10), index: i,
            top: ob.top, bottom: ob.bottom, originDate: ob.startDate,
          });
          break;
        }
        if (touchesZone) {
          events.push({
            type: "breaker", direction: ob.direction === "bullish" ? "bearish" : "bullish",
            date: bar.date.slice(0, 10), index: i,
            top: ob.top, bottom: ob.bottom, originDate: ob.startDate,
          });
          break;
        }
      }
    }
  });

  return events;
}
