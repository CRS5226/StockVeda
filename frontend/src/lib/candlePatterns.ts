export interface PatternHit {
  date: string;
  pattern:
    | "hammer" | "bull_engulf" | "inside_bar" | "pin_bar_bull"
    | "doji" | "shooting_star" | "morning_star" | "evening_star" | "bear_engulf";
  label: string;
  bias: "bullish" | "bearish" | "neutral";
  tip: string;
}

interface OhlcvRow { date: string; open: number; high: number; low: number; close: number }

export function detectPatterns(ohlcv: OhlcvRow[]): PatternHit[] {
  const hits: PatternHit[] = [];
  const tiny = 1e-9;

  for (let i = 2; i < ohlcv.length; i++) {
    const c  = ohlcv[i];
    const p  = ohlcv[i - 1];
    const p2 = ohlcv[i - 2];

    const body      = Math.abs(c.close - c.open);
    const range     = c.high - c.low;
    const upperWick = c.high - Math.max(c.close, c.open);
    const lowerWick = Math.min(c.close, c.open) - c.low;
    const safeRange = Math.max(range, tiny);
    const safeBody  = Math.max(body, tiny);

    // ── Single-bar patterns ────────────────────────────────────────────────

    // Doji: open ≈ close (body < 10% of range)
    if (body < 0.10 * safeRange) {
      hits.push({ date: c.date.slice(0, 10), pattern: "doji", label: "D", bias: "neutral", tip: "Doji — indecision, watch next candle for direction" });
      continue;
    }

    // Hammer: long lower wick, tiny upper wick, small body
    if (lowerWick >= 2.0 * safeBody && upperWick <= 0.2 * safeRange && body <= 0.4 * safeRange) {
      hits.push({ date: c.date.slice(0, 10), pattern: "hammer", label: "H", bias: "bullish", tip: "Hammer — buyers rejected lower prices" });
      continue;
    }

    // Shooting Star: long upper wick, tiny lower wick, small body (bearish)
    if (upperWick >= 2.0 * safeBody && lowerWick <= 0.2 * safeRange && body <= 0.4 * safeRange) {
      hits.push({ date: c.date.slice(0, 10), pattern: "shooting_star", label: "S", bias: "bearish", tip: "Shooting Star — sellers rejected higher prices" });
      continue;
    }

    // Bullish Pin Bar: strong lower wick rejection (≥ 60% of range, ≥ 2.5× body)
    if (lowerWick >= 2.5 * safeBody && lowerWick >= 0.6 * safeRange) {
      hits.push({ date: c.date.slice(0, 10), pattern: "pin_bar_bull", label: "P", bias: "bullish", tip: "Bullish Pin Bar — sharp rejection of lower prices" });
      continue;
    }

    // ── Two-bar patterns ──────────────────────────────────────────────────

    // Bullish Engulfing: today bullish, yesterday bearish, body engulfs previous
    if (c.close > c.open && p.open > p.close && c.close > p.open && c.open < p.close) {
      hits.push({ date: c.date.slice(0, 10), pattern: "bull_engulf", label: "E", bias: "bullish", tip: "Bullish Engulfing — buying pressure overwhelmed sellers" });
      continue;
    }

    // Bearish Engulfing: today bearish, yesterday bullish, body engulfs previous
    if (c.open > c.close && p.close > p.open && c.open > p.close && c.close < p.open) {
      hits.push({ date: c.date.slice(0, 10), pattern: "bear_engulf", label: "BE", bias: "bearish", tip: "Bearish Engulfing — selling pressure overwhelmed buyers" });
      continue;
    }

    // Inside Bar: today's range fully inside previous bar
    if (c.high < p.high && c.low > p.low) {
      hits.push({ date: c.date.slice(0, 10), pattern: "inside_bar", label: "I", bias: "neutral", tip: "Inside Bar — consolidation, watch for breakout direction" });
      continue;
    }

    // ── Three-bar patterns ────────────────────────────────────────────────

    // Morning Star: bearish bar → small middle → bullish bar closing above p2 midpoint
    const p1Body  = Math.abs(p.close - p.open);
    const p1Range = Math.max(p.high - p.low, tiny);
    const p2Mid   = (p2.open + p2.close) / 2;
    if (
      p2.open > p2.close &&                     // bar[-2] bearish
      p1Body < 0.3 * p1Range &&                 // bar[-1] small body
      c.close > c.open &&                        // bar[0] bullish
      c.close > p2Mid                            // bar[0] closes above p2 midpoint
    ) {
      hits.push({ date: c.date.slice(0, 10), pattern: "morning_star", label: "MS", bias: "bullish", tip: "Morning Star — 3-bar bullish reversal pattern" });
      continue;
    }

    // Evening Star: bullish bar → small middle → bearish bar closing below p2 midpoint
    if (
      p2.close > p2.open &&                     // bar[-2] bullish
      p1Body < 0.3 * p1Range &&                 // bar[-1] small body
      c.open > c.close &&                        // bar[0] bearish
      c.close < p2Mid                            // bar[0] closes below p2 midpoint
    ) {
      hits.push({ date: c.date.slice(0, 10), pattern: "evening_star", label: "ES", bias: "bearish", tip: "Evening Star — 3-bar bearish reversal pattern" });
      continue;
    }
  }

  return hits;
}
