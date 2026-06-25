// Pattern types — detection is now done server-side via TA-Lib
// GET /api/v1/candle-patterns/{symbol}

export interface PatternHit {
  date: string;
  pattern: string;
  label: string;
  bias: "bullish" | "bearish" | "neutral";
  tip: string;
}
