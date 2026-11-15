/** Helpers for the Bulk/Block Deals tab on the stock page. */

import { shortDate } from "./connections";

/** How many days of deals the tab asks for. */
export const DEALS_DAYS = 90;

const DAY_MS = 86_400_000;
const START_TOLERANCE_DAYS = 3;   // stored history starting within this many days of the window counts as covering it
const STALE_AFTER_DAYS = 4;       // newest stored day older than this (a weekend and a holiday, say) is worth a hint

/** A share quantity in the units NSE traders use: 2.04Cr, 1.5L, or a plain number. */
export function formatQty(n: number): string {
  return n >= 1e7 ? `${(n / 1e7).toFixed(2)}Cr` : n >= 1e5 ? `${(n / 1e5).toFixed(1)}L` : n.toLocaleString();
}

export interface DealsCoverage {
  /** What is stored: "Stored deals run from 17 Aug 2026 to 13 Nov 2026." */
  stored: string;
  /** Short caveats a reader should know, empty when none apply. */
  notes: string[];
}

const dayOf = (iso: string): number => new Date(iso.slice(0, 10) + "T00:00:00").getTime();

/**
 * How far back the stored deals go, and whether that covers the requested window and is current.
 * `range` is the oldest and newest stored day across all stocks (null when nothing is stored).
 */
export function dealsCoverage(range: { from: string; to: string } | null, today: Date, days: number = DEALS_DAYS): DealsCoverage {
  if (!range) return { stored: "No deals have been fetched yet.", notes: ["Press Sync to fetch them."] };
  const notes: string[] = [];
  const windowStart = today.getTime() - days * DAY_MS;
  if (dayOf(range.from) > windowStart + START_TOLERANCE_DAYS * DAY_MS) {
    notes.push(`History starts on ${shortDate(range.from)}, so earlier deals in this window are not stored.`);
  }
  if (today.getTime() - dayOf(range.to) > STALE_AFTER_DAYS * DAY_MS) {
    notes.push(`The newest stored day is ${shortDate(range.to)}. Press Sync for the latest.`);
  }
  return { stored: `Stored deals run from ${shortDate(range.from)} to ${shortDate(range.to)}.`, notes };
}
