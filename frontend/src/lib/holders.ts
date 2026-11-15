/** Helpers for the named-holders table on the Shareholding tab. */

import type { ShareholderRow } from "./connectionsTypes";

export const DEFAULT_VISIBLE = 10;

export interface HolderSummary { promoterPct: number; publicPct: number; promoterCount: number; publicCount: number }

/** Totals of the percentages the filing gives for each named group. Rows without a percentage add nothing. */
export function summariseHolders(rows: ShareholderRow[]): HolderSummary {
  const out: HolderSummary = { promoterPct: 0, publicPct: 0, promoterCount: 0, publicCount: 0 };
  for (const r of rows) {
    const pct = r.pct ?? 0;
    if (r.holder_group === "promoter") { out.promoterPct += pct; out.promoterCount += 1; }
    else { out.publicPct += pct; out.publicCount += 1; }
  }
  return out;
}

/** The rows to draw: the first `limit` unless the list is expanded. The server already sorts biggest first. */
export const visibleHolders = (rows: ShareholderRow[], expanded: boolean, limit = DEFAULT_VISIBLE): ShareholderRow[] =>
  expanded ? rows : rows.slice(0, limit);

export const groupLabel = (group: ShareholderRow["holder_group"]): string => (group === "promoter" ? "Promoter" : "Public");

/**
 * A filed percentage for display. The filing rounds tiny holdings to zero, so a holder with shares but a filed
 * percentage under 0.01 reads "<0.01%", not a misleading "0.00%".
 */
export function formatHolderPct(pct: number | null, shares: number | null = null): string {
  if (pct === null) return "—";
  if (pct < 0.01 && (pct > 0 || (shares ?? 0) > 0)) return "<0.01%";
  return `${pct.toFixed(2)}%`;
}

/** One line on who is named: promoters and named public holders, leaving out a group the filing does not name. */
export function summaryText(s: HolderSummary): string {
  const parts: string[] = [];
  parts.push(s.promoterCount > 0 ? `Promoters ${s.promoterPct.toFixed(2)}% (${s.promoterCount})` : "No promoter holders named");
  if (s.publicCount > 0) parts.push(`named public holders ${s.publicPct.toFixed(2)}% (${s.publicCount})`);
  return parts.join(" · ");
}
