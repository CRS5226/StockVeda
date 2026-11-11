const num = (n: number) => Math.abs(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const sign = (n: number) => (n > 0 ? "+" : n < 0 ? "-" : "");

export const price = (n: number) => n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** A signed number without a unit, for table cells whose column header names the unit. */
export const signed = (n: number) => `${sign(n)}${num(n)}`;
export const points = (n: number) => `${sign(n)}${num(n)} pts`;
export const percent = (n: number) => `${sign(n)}${num(n)}%`;
export const money = (n: number) => `${sign(n)}₹${num(n)}`;
/** Text colour for a result: green above zero, red below, muted at zero. */
export const tone = (n: number, dark: boolean) =>
  n > 0 ? (dark ? "text-emerald-400" : "text-emerald-600") : n < 0 ? (dark ? "text-red-400" : "text-red-600") : (dark ? "text-slate-400" : "text-slate-500");
