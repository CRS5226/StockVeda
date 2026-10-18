// Date range <-> candle count conversion for the SMC tab. Estimates only: they count weekdays
// (no holiday calendar) times the bars a trading day holds; once bars are loaded the panel shows
// the real count. Bar densities come from the backend (GET /intraday/timeframes).

const DAY_MS = 86_400_000;

export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  return isoDate(new Date(Date.parse(date) + days * DAY_MS));
}

/** Weekdays in (from, to]; negative ranges count as zero. */
export function weekdaysBetween(from: string, to: string): number {
  let n = 0;
  for (let t = Date.parse(from) + DAY_MS; t <= Date.parse(to); t += DAY_MS) {
    const dow = new Date(t).getUTCDay();
    if (dow !== 0 && dow !== 6) n++;
  }
  return n;
}

/** Date that is `weekdays` trading weekdays before `to`. */
export function subtractWeekdays(to: string, weekdays: number): string {
  let t = Date.parse(to);
  let left = weekdays;
  while (left > 0) {
    t -= DAY_MS;
    const dow = new Date(t).getUTCDay();
    if (dow !== 0 && dow !== 6) left--;
  }
  return isoDate(new Date(t));
}

export function candlesForRange(from: string, to: string, barsPerDay: number): number {
  return Math.max(1, Math.round((weekdaysBetween(from, to) + 1) * barsPerDay));
}

export function fromDateForCandles(candles: number, to: string, barsPerDay: number): string {
  return subtractWeekdays(to, Math.max(0, Math.ceil(candles / barsPerDay) - 1));
}
