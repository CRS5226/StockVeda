/** The "at a glance" facts under a stock's price header, built from the Connections data. */

import { shortDate, type SectionId } from "./connections";
import type { CompanyProfile, CorrelatedResponse, EventsResponse, OwnershipResponse } from "./connectionsTypes";

export interface GlanceItem {
  key: string;
  label: string;
  value: string;
  detail?: string;
  /** The Connections section that has the detail. */
  section: SectionId;
}

export interface GlanceInput {
  profile: CompanyProfile | null;
  correlated: CorrelatedResponse | null;
  events: EventsResponse | null;
  ownership: OwnershipResponse | null;
}

const DAY_MS = 86_400_000;

/** A short form of a long name, ending in an ellipsis when it is cut. */
const clip = (text: string, n = 28): string => (text.length > n ? `${text.slice(0, n - 1)}…` : text);

/**
 * The items that have data, in display order. A missing source simply leaves its items out, so
 * the strip never shows an empty box. Wording is neutral: facts, not signals.
 */
export function buildGlance({ profile, correlated, events, ownership }: GlanceInput, today: Date = new Date()): GlanceItem[] {
  const items: GlanceItem[] = [];

  const industry = profile?.industry ?? profile?.sector;
  if (industry) {
    items.push({ key: "industry", label: "Industry", value: industry, detail: profile?.industry ? profile.sector ?? undefined : undefined, section: "chain" });
  }
  if (profile?.city) {
    items.push({ key: "city", label: "Headquarters", value: profile.city, detail: profile.state ?? undefined, section: "location" });
  }
  if (correlated?.beta_vs_nifty != null) {
    items.push({ key: "beta", label: "Beta vs NIFTY", value: correlated.beta_vs_nifty.toFixed(2), detail: `${correlated.window} trading days`, section: "correlated" });
  }
  if (events && events.order_wins_12m > 0) {
    const since = events.history_from ? new Date(events.history_from + "T00:00:00") : null;
    const shortHistory = since !== null && !Number.isNaN(since.getTime()) && today.getTime() - since.getTime() < 365 * DAY_MS;
    items.push({
      key: "orders", label: "Order announcements", value: String(events.order_wins_12m),
      detail: shortHistory && events.history_from ? `since ${shortDate(events.history_from)}` : "last 12 months", section: "events",
    });
  }
  if (events?.next_meeting) {
    items.push({ key: "meeting", label: "Next board meeting", value: shortDate(events.next_meeting.meeting_date), detail: clip(events.next_meeting.purpose), section: "events" });
  }
  const biggest = ownership?.group.reduce<OwnershipResponse["group"][number] | null>(
    (best, g) => (best === null || g.companies.length > best.companies.length ? g : best), null);
  if (biggest && biggest.companies.length > 0) {
    const n = biggest.companies.length;
    items.push({ key: "group", label: "Same promoter holder", value: `${n} other ${n === 1 ? "company" : "companies"}`, detail: clip(biggest.holder), section: "owners" });
  }
  return items;
}
