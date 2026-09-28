// SMC (Smart Money Concepts) price-zone detection — client-side, chart-overlay only.
// Order Blocks and FVG (Fair Value Gap). See GitHub issue #79 for the full concept list.

interface OhlcvRow { date: string; open: number; high: number; low: number; close: number }

export interface SmcZone {
  type: "orderBlock" | "fvg";
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
    if (ohlcv[i].low <= top && ohlcv[i].high >= bottom) return ohlcv[i].date.slice(0, 10);
  }
  return ohlcv[ohlcv.length - 1].date.slice(0, 10); // unmitigated — draw to the last bar
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
        startDate: prev.date.slice(0, 10),
        endDate: firstMitigationDate(ohlcv, i + 1, top, bottom),
        top, bottom, originIndex: i - 1,
      });
    }
    if (prevUp && currDown && curr.close < prev.low) {
      zones.push({
        type: "orderBlock", direction: "bearish",
        startDate: prev.date.slice(0, 10),
        endDate: firstMitigationDate(ohlcv, i + 1, top, bottom),
        top, bottom, originIndex: i - 1,
      });
    }
  }
  return zones;
}

/**
 * Standard 3-candle FVG: the middle (displacement) candle leaves a gap between the
 * first and third candles' wicks — first.high < third.low (bullish, price gapped up)
 * or first.low > third.high (bearish, gapped down). Zone spans that gap and is drawn
 * until price first trades back into it.
 */
export function detectFvgZones(ohlcv: OhlcvRow[]): SmcZone[] {
  const zones: SmcZone[] = [];
  for (let i = 1; i < ohlcv.length - 1; i++) {
    const left = ohlcv[i - 1], right = ohlcv[i + 1];

    if (left.high < right.low) {
      const top = right.low, bottom = left.high;
      zones.push({
        type: "fvg", direction: "bullish",
        startDate: left.date.slice(0, 10),
        endDate: firstMitigationDate(ohlcv, i + 2, top, bottom),
        top, bottom, originIndex: i - 1,
      });
    }
    if (left.low > right.high) {
      const top = left.low, bottom = right.high;
      zones.push({
        type: "fvg", direction: "bearish",
        startDate: left.date.slice(0, 10),
        endDate: firstMitigationDate(ohlcv, i + 2, top, bottom),
        top, bottom, originIndex: i - 1,
      });
    }
  }
  return zones;
}
