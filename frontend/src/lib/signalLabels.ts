import type { SignalRow, SignalState } from "./api";

export const STATE_LABEL: Record<SignalState, string> = { bullish: "Bullish", neutral: "Neutral", bearish: "Bearish" };
export const STATE_ARROW: Record<SignalState, string> = { bullish: "▲", neutral: "•", bearish: "▼" };
export const STATE_STYLE: Record<SignalState, string> = {
  bullish: "bg-emerald-50 text-emerald-700", neutral: "bg-slate-100 text-slate-500", bearish: "bg-red-50 text-red-700",
};

export const ZONE_LABEL: Record<SignalRow["zone"], string> = { profit: "Profit-booking zone", recovery: "Recovery zone", hold: "Hold zone" };
export const ZONE_STYLE: Record<SignalRow["zone"], string> = {
  profit: "bg-amber-50 text-amber-700", recovery: "bg-blue-50 text-blue-700", hold: "bg-slate-100 text-slate-500",
};
/** Order for sorting by zone: the zones that are met first. */
export const ZONE_RANK: Record<SignalRow["zone"], number> = { profit: 0, recovery: 1, hold: 2 };

export const REGIME_LABEL = { trending: "Trending", ranging: "Ranging", mixed: "Mixed" } as const;

/** Rows matching one of the filter chips. */
export type SignalFilter = "all" | "profit" | "recovery" | "bullish" | "bearish";

export function matchesFilter(r: SignalRow, f: SignalFilter): boolean {
  if (f === "all") return true;
  if (f === "profit" || f === "recovery") return r.zone === f;
  return r.alignment === f;
}
