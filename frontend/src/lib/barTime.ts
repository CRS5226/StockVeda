import type { Time } from "lightweight-charts";

/**
 * Key identifying a bar on the time axis. Daily and higher bars keep the plain `YYYY-MM-DD`
 * date; intraday bars keep their full `YYYY-MM-DD HH:MM:SS` stamp so they don't collapse
 * onto one day. Keys sort chronologically as strings within a single dataset.
 */
export function barKey(date: string): string {
  const s = date.replace("T", " ");
  return s.length > 10 && !s.slice(11, 19).startsWith("00:00") ? s.slice(0, 19) : s.slice(0, 10);
}

/**
 * lightweight-charts time for a bar key: the date string for daily bars, a UTC timestamp for
 * intraday. The exchange wall-clock time is stored as if it were UTC so the axis reads 09:15,
 * not a browser-timezone shift of it.
 */
export function toChartTime(key: string): Time {
  if (key.length <= 10) return key as Time;
  return (Date.parse(key.replace(" ", "T") + "Z") / 1000) as Time;
}
