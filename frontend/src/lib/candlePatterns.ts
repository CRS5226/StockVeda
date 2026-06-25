export interface PatternHit {
  date: string;
  pattern: "hammer" | "bull_engulf" | "inside_bar" | "pin_bar_bull";
  label: "H" | "E" | "I" | "P";
  bias: "bullish" | "neutral";
  tip: string;
}

interface OhlcvRow { date: string; open: number; high: number; low: number; close: number }

export function detectPatterns(ohlcv: OhlcvRow[]): PatternHit[] {
  const hits: PatternHit[] = [];
  const tiny = 1e-9;

  for (let i = 1; i < ohlcv.length; i++) {
    const c = ohlcv[i];
    const p = ohlcv[i - 1];

    const body       = Math.abs(c.close - c.open);
    const range      = c.high - c.low;
    const upperWick  = c.high - Math.max(c.close, c.open);
    const lowerWick  = Math.min(c.close, c.open) - c.low;
    const safeRange  = Math.max(range, tiny);
    const safeBody   = Math.max(body, tiny);

    // Hammer: long lower wick, tiny upper wick, small body
    if (
      lowerWick >= 2.0 * safeBody &&
      upperWick <= 0.2 * safeRange &&
      body <= 0.4 * safeRange
    ) {
      hits.push({ date: c.date.slice(0, 10), pattern: "hammer", label: "H", bias: "bullish", tip: "Hammer — buyers rejected lower prices" });
      continue;
    }

    // Bullish Engulfing: today bullish, yesterday bearish, body engulfs previous
    if (
      c.close > c.open &&
      p.open > p.close &&
      c.close > p.open &&
      c.open < p.close
    ) {
      hits.push({ date: c.date.slice(0, 10), pattern: "bull_engulf", label: "E", bias: "bullish", tip: "Bullish Engulfing — buying pressure overwhelmed sellers" });
      continue;
    }

    // Inside Bar: today's range inside previous bar's range
    if (c.high < p.high && c.low > p.low) {
      hits.push({ date: c.date.slice(0, 10), pattern: "inside_bar", label: "I", bias: "neutral", tip: "Inside Bar — consolidation, watch for breakout direction" });
      continue;
    }

    // Bullish Pin Bar: strong lower wick rejection (≥ 60% of range, ≥ 2.5× body)
    if (
      lowerWick >= 2.5 * safeBody &&
      lowerWick >= 0.6 * safeRange
    ) {
      hits.push({ date: c.date.slice(0, 10), pattern: "pin_bar_bull", label: "P", bias: "bullish", tip: "Bullish Pin Bar — sharp rejection of lower prices" });
      continue;
    }
  }

  return hits;
}
