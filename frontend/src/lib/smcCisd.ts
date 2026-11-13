// CISD (change in state of delivery): a body close back through the open of the first candle of the last
// run of opposite-coloured candles. Needs no swing break, so it fires earlier than a ChoCH.

export interface CisdBar { date: string; open: number; close: number }

export interface Cisd {
  /** Bar whose body closed through the level. */
  date: string;
  /** Open of the first candle in the run; the level that was closed through. */
  level: number;
  /** First candle of the run, where the line starts. */
  fromDate: string;
  direction: "bullish" | "bearish";
}

/**
 * Bullish: after a run of down candles, a close above the open of the run's first candle.
 * Bearish: the mirror. Each run fires at most once; a new run (after a candle of the other colour) replaces it.
 * Only the body close counts, and a doji neither starts nor ends a run.
 */
export function detectCisd(bars: CisdBar[]): Cisd[] {
  const out: Cisd[] = [];
  let downRun: { level: number; fromDate: string } | null = null; // armed bullish CISD
  let upRun: { level: number; fromDate: string } | null = null;   // armed bearish CISD
  let prev = 0; // colour of the previous non-doji candle: -1 down, 1 up
  for (const b of bars) {
    if (downRun && b.close > downRun.level) {
      out.push({ date: b.date, level: downRun.level, fromDate: downRun.fromDate, direction: "bullish" });
      downRun = null;
    }
    if (upRun && b.close < upRun.level) {
      out.push({ date: b.date, level: upRun.level, fromDate: upRun.fromDate, direction: "bearish" });
      upRun = null;
    }
    const colour = Math.sign(b.close - b.open);
    if (colour === 0) continue;
    if (colour !== prev) {
      if (colour < 0) downRun = { level: b.open, fromDate: b.date };
      else upRun = { level: b.open, fromDate: b.date };
    }
    prev = colour;
  }
  return out;
}
