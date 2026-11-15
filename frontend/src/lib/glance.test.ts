import { describe, expect, it } from "vitest";
import { buildGlance } from "./glance";
import { connectionsSectionPath, sectionElementId } from "./connections";
import type { CompanyProfile, CorrelatedResponse, EventsResponse, OwnershipResponse } from "./connectionsTypes";

const TODAY = new Date("2026-11-15T12:00:00");
const profile = { symbol: "TCS", city: "Mumbai", state: "Maharashtra", sector: "Technology", industry: "Information Technology Services" } as CompanyProfile;
const correlated = { window: 120, beta_vs_nifty: 0.936 } as CorrelatedResponse;
const events = (over: Partial<EventsResponse> = {}): EventsResponse => ({
  symbol: "TCS", order_wins_12m: 3, history_from: "2026-08-17", next_meeting: { meeting_date: "2026-12-01", purpose: "Financial Results", description: "" },
  upcoming_meetings: [], events: [], ...over,
});
const ownership = (companies: number[]): OwnershipResponse => ({
  symbol: "TCS", depth: 1, as_of: null, nodes: [], edges: [], note: "",
  group: companies.map((n, i) => ({ holder: `Holder ${i}`, companies: Array.from({ length: n }, (_, k) => ({ symbol: `S${k}`, pct: 10, name: null })) })),
});

describe("buildGlance", () => {
  it("builds every item in order when all data is present", () => {
    const items = buildGlance({ profile, correlated, events: events(), ownership: ownership([14]) }, TODAY);
    expect(items.map((i) => i.key)).toEqual(["industry", "city", "beta", "orders", "meeting", "group"]);
    expect(items[0]).toMatchObject({ value: "Information Technology Services", detail: "Technology", section: "chain" });
    expect(items[1]).toMatchObject({ value: "Mumbai", detail: "Maharashtra", section: "location" });
    expect(items[2]).toMatchObject({ value: "0.94", detail: "120 trading days", section: "correlated" });
    expect(items[3]).toMatchObject({ value: "3", section: "events" });
    expect(items[5]).toMatchObject({ value: "14 other companies", detail: "Holder 0", section: "owners" });
  });

  it("leaves out an item whose data is missing and returns nothing when nothing is known", () => {
    expect(buildGlance({ profile: null, correlated: null, events: null, ownership: null }, TODAY)).toEqual([]);
    const keys = buildGlance({ profile, correlated: null, events: null, ownership: null }, TODAY).map((i) => i.key);
    expect(keys).toEqual(["industry", "city"]);
  });

  it("uses the sector when there is no industry, and skips a missing city", () => {
    const items = buildGlance({ profile: { ...profile, industry: null, city: null } as CompanyProfile, correlated: null, events: null, ownership: null }, TODAY);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ value: "Technology", detail: undefined });
  });

  it("hides orders when there are none and a beta that is null", () => {
    const items = buildGlance({ profile: null, correlated: { ...correlated, beta_vs_nifty: null }, events: events({ order_wins_12m: 0, next_meeting: null }), ownership: null }, TODAY);
    expect(items).toEqual([]);
  });

  it("says how far back the order count goes when the history is under a year", () => {
    const short = buildGlance({ profile: null, correlated: null, events: events({ history_from: "2026-08-17" }), ownership: null }, TODAY)[0];
    expect(short.detail).toMatch(/^since .*Aug 2026$/);
    const long = buildGlance({ profile: null, correlated: null, events: events({ history_from: "2025-06-01" }), ownership: null }, TODAY)[0];
    expect(long.detail).toBe("last 12 months");
    const unknown = buildGlance({ profile: null, correlated: null, events: events({ history_from: null }), ownership: null }, TODAY)[0];
    expect(unknown.detail).toBe("last 12 months");
  });

  it("uses the biggest group, says 'company' for one, and ignores empty groups", () => {
    expect(buildGlance({ profile: null, correlated: null, events: null, ownership: ownership([2, 9, 4]) }, TODAY)[0].detail).toBe("Holder 1");
    expect(buildGlance({ profile: null, correlated: null, events: null, ownership: ownership([1]) }, TODAY)[0].value).toBe("1 other company");
    expect(buildGlance({ profile: null, correlated: null, events: null, ownership: ownership([]) }, TODAY)).toEqual([]);
    expect(buildGlance({ profile: null, correlated: null, events: null, ownership: ownership([0]) }, TODAY)).toEqual([]);
  });

  it("clips a long meeting purpose and holder name", () => {
    const long = "A very long purpose for a board meeting indeed";
    const item = buildGlance({ profile: null, correlated: null, events: events({ next_meeting: { meeting_date: "2026-12-01", purpose: long, description: "" } }), ownership: null }, TODAY)
      .find((i) => i.key === "meeting")!;
    expect(item.detail!.length).toBeLessThanOrEqual(28);
    expect(item.detail!.endsWith("…")).toBe(true);
  });
});

describe("section links", () => {
  it("builds anchors and paths", () => {
    expect(sectionElementId("owners")).toBe("connections-owners");
    expect(connectionsSectionPath("TCS", "events")).toBe("/stock/TCS?tab=connections#connections-events");
  });
});
