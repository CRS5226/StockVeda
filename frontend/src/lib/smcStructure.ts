// SMC (Smart Money Concepts) market-structure detection — client-side, chart-overlay only.
// Currently covers BOS (Break of Structure) and ChoCH (Change of Character).
// See GitHub issue #79 for the full SMC/ICT concept list this will grow into.

interface OhlcvRow { date: string; open: number; high: number; low: number; close: number }

export interface SwingPoint {
  date: string;
  index: number;
  price: number;
  type: "high" | "low";
}

export interface StructureEvent {
  date: string;               // breakout bar's date
  index: number;
  type: "BOS" | "ChoCH";
  direction: "bullish" | "bearish"; // bullish = broke above a swing high, bearish = broke below a swing low
  level: number;               // the swing price that was broken
  fromDate: string;            // the swing point's date (line start)
  fromIndex: number;
}

/**
 * Simple fractal swing detection: a swing high/low is a bar whose high/low is the
 * most extreme within `lookback` bars on either side. A swing is only "confirmed"
 * once `lookback` bars have closed after it — that lag is inherent to fractals and
 * matches how most SMC/ICT charting tools mark structure.
 */
export function detectSwingPoints(ohlcv: OhlcvRow[], lookback = 2): SwingPoint[] {
  const swings: SwingPoint[] = [];
  for (let i = lookback; i < ohlcv.length - lookback; i++) {
    const window = ohlcv.slice(i - lookback, i + lookback + 1);
    const isHigh = window.every((r) => r.high <= ohlcv[i].high);
    const isLow  = window.every((r) => r.low  >= ohlcv[i].low);
    if (isHigh) swings.push({ date: ohlcv[i].date.slice(0, 10), index: i, price: ohlcv[i].high, type: "high" });
    if (isLow)  swings.push({ date: ohlcv[i].date.slice(0, 10), index: i, price: ohlcv[i].low,  type: "low" });
  }
  return swings;
}

/**
 * Walks bars in order, tracking the most recent confirmed-but-not-yet-broken swing
 * high/low. A close beyond that level is a structure break:
 *  - same direction as the current trend (or no trend established yet) → BOS
 *  - opposite direction to the current trend → ChoCH, and the trend flips
 */
export function detectStructureEvents(ohlcv: OhlcvRow[], lookback = 2): StructureEvent[] {
  if (ohlcv.length < lookback * 2 + 1) return [];
  const swings = detectSwingPoints(ohlcv, lookback);
  const swingsByIndex = new Map<number, SwingPoint>();
  swings.forEach((s) => swingsByIndex.set(s.index, s));

  const events: StructureEvent[] = [];
  let trend: "up" | "down" | null = null;
  let activeHigh: SwingPoint | null = null;
  let activeLow: SwingPoint | null = null;

  for (let i = 0; i < ohlcv.length; i++) {
    // A swing at index (i - lookback) is confirmed by bar i — adopt it as the
    // active reference for its type, replacing any earlier unbroken swing.
    const confirmed = swingsByIndex.get(i - lookback);
    if (confirmed?.type === "high") activeHigh = confirmed;
    if (confirmed?.type === "low")  activeLow  = confirmed;

    const close = ohlcv[i].close;
    const date  = ohlcv[i].date.slice(0, 10);

    if (activeHigh && close > activeHigh.price) {
      events.push({
        date, index: i,
        type: trend === "down" ? "ChoCH" : "BOS",
        direction: "bullish",
        level: activeHigh.price,
        fromDate: activeHigh.date, fromIndex: activeHigh.index,
      });
      trend = "up";
      activeHigh = null; // consumed — wait for the next confirmed swing high
    }

    if (activeLow && close < activeLow.price) {
      events.push({
        date, index: i,
        type: trend === "up" ? "ChoCH" : "BOS",
        direction: "bearish",
        level: activeLow.price,
        fromDate: activeLow.date, fromIndex: activeLow.index,
      });
      trend = "down";
      activeLow = null; // consumed — wait for the next confirmed swing low
    }
  }

  return events;
}
