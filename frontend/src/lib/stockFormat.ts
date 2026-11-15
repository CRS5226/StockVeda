/** Formatting and date helpers for the stock page. */

export type Range = "1M" | "3M" | "6M" | "1Y" | "3Y" | "MAX";
export type SectorRange = "1M" | "3M" | "6M" | "1Y";
export const RANGES: Range[] = ["1M", "3M", "6M", "1Y", "3Y", "MAX"];
export const SECTOR_RANGES: SectorRange[] = ["1M", "3M", "6M", "1Y"];

export function fromDate(r: Range) {
  if (r === "MAX") return undefined;
  const d = new Date();
  const months = { "1M": 1, "3M": 3, "6M": 6, "1Y": 12, "3Y": 36 }[r];
  d.setMonth(d.getMonth() - months);
  return d.toISOString().slice(0, 10);
}
export function fmt(n?: number | null, dec = 2) {
  if (n == null) return "—";
  return n.toLocaleString("en-IN", { maximumFractionDigits: dec });
}
export function fmtCr(n?: number | null) {
  if (n == null) return "—";
  return `₹${(n / 1e7).toLocaleString("en-IN", { maximumFractionDigits: 0 })} Cr`;
}
// Google News RSS pubDate is RFC-822 (e.g. "Wed, 18 Jun 2026 10:30:00 GMT").
export function newsTime(pub?: string) {
  const t = pub ? new Date(pub).getTime() : NaN;
  return Number.isNaN(t) ? 0 : t;
}
export function fmtNewsDate(pub: string) {
  const t = newsTime(pub);
  if (!t) return pub.slice(0, 16); // fallback if unparseable
  return new Date(t).toLocaleString("en-IN", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}
