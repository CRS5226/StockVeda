// Pure date helpers for the month calendar. Dates are plain "YYYY-MM-DD" strings, so no time zone can shift them.

export interface DayCell { date: string; day: number; inMonth: boolean }

const pad = (n: number) => String(n).padStart(2, "0");
export const isoDay = (year: number, month: number, day: number) => `${year}-${pad(month + 1)}-${pad(day)}`;

/** Weeks of a month (Sunday first), padded with the neighbouring months' days so every week has seven cells. `month` is 0 to 11. */
export function monthGrid(year: number, month: number): DayCell[][] {
  const first = new Date(Date.UTC(year, month, 1));
  const lead = first.getUTCDay();                          // days of the previous month shown before the 1st
  const length = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const cells: DayCell[] = [];
  for (let i = -lead; cells.length % 7 !== 0 || i < length; i++) {
    const d = new Date(Date.UTC(year, month, 1 + i));
    cells.push({ date: isoDay(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()), day: d.getUTCDate(), inMonth: i >= 0 && i < length });
  }
  const weeks: DayCell[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/** The month before or after (delta of -1 or 1), rolling over the year. */
export function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const index = year * 12 + month + delta;
  return { year: Math.floor(index / 12), month: ((index % 12) + 12) % 12 };
}

export function groupByDate<T extends { pay_date: string }>(rows: T[]): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const r of rows) out.set(r.pay_date, [...(out.get(r.pay_date) ?? []), r]);
  return out;
}
