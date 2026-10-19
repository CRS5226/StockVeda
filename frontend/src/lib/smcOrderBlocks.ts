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
        return {
          direction: leg.direction, role, k: j, date: c[j].date, top: c[j].high, bottom: c[j].low, fvg, leg: legIndex,
        };
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
