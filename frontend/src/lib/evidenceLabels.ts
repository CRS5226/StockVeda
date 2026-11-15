import type { EvidenceVerdict, RuleEvidenceReport, RuleResult } from "./api";

export const VERDICT_LABEL: Record<EvidenceVerdict, string> = { held_up: "Held up", mixed: "Mixed", did_not: "Did not", few_trades: "Few trades" };
export const VERDICT_STYLE: Record<EvidenceVerdict, string> = {
  held_up: "bg-emerald-50 text-emerald-700", mixed: "bg-amber-50 text-amber-700", did_not: "bg-red-50 text-red-700", few_trades: "bg-slate-100 text-slate-500",
};
export const VERDICT_HINT: Record<EvidenceVerdict, string> = {
  held_up: "Positive after costs in both the earlier and the later part of the tested history",
  mixed: "Positive in one part of the tested history and not the other",
  did_not: "Not positive after costs in either part",
  few_trades: "Fewer than 5 trades, too few to say anything",
};

/** How many of a stock's rules held up, for sorting. Stocks with no results count as zero. */
export function heldUpCount(results: Record<string, RuleResult | null>): number {
  return Object.values(results).filter((r) => r?.verdict === "held_up").length;
}

/** The summary line of one rule: on how many of the tested stocks it held up. */
export function summaryLine(s: RuleEvidenceReport["summary"][number]): string {
  return `Held up on ${s.held_up} of ${s.tested} stocks`;
}
