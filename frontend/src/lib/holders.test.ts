import { describe, expect, it } from "vitest";
import { DEFAULT_VISIBLE, formatHolderPct, groupLabel, summariseHolders, summaryText, visibleHolders } from "./holders";
import type { ShareholderRow } from "./connectionsTypes";

const row = (name: string, group: ShareholderRow["holder_group"], pct: number | null): ShareholderRow => (
  { symbol: "TCS", period: "2026-09-30", holder_name: name, holder_group: group, category: "x", shares: 1, pct });

describe("summariseHolders", () => {
  it("adds the percentages and counts per group", () => {
    const s = summariseHolders([row("A", "promoter", 71.7), row("B", "promoter", 0.1), row("C", "public", 5.6), row("D", "public", 1.3)]);
    expect(s.promoterPct).toBeCloseTo(71.8, 5);
    expect(s.publicPct).toBeCloseTo(6.9, 5);
    expect(s).toMatchObject({ promoterCount: 2, publicCount: 2 });
  });
  it("counts a holder without a percentage but adds nothing for it", () => {
    const s = summariseHolders([row("DR bank", "public", null), row("B", "public", 2)]);
    expect(s).toMatchObject({ publicPct: 2, publicCount: 2, promoterCount: 0 });
  });
  it("is all zero for no rows", () => {
    expect(summariseHolders([])).toEqual({ promoterPct: 0, publicPct: 0, promoterCount: 0, publicCount: 0 });
  });
});

describe("visibleHolders and labels", () => {
  const many = Array.from({ length: 25 }, (_, i) => row(`H${i}`, "public", 25 - i));
  it("shows the first rows until expanded", () => {
    expect(visibleHolders(many, false)).toHaveLength(DEFAULT_VISIBLE);
    expect(visibleHolders(many, false)[0].holder_name).toBe("H0");
    expect(visibleHolders(many, true)).toHaveLength(25);
    expect(visibleHolders(many.slice(0, 3), false)).toHaveLength(3);
  });
  it("labels the groups", () => {
    expect(groupLabel("promoter")).toBe("Promoter");
    expect(groupLabel("public")).toBe("Public");
  });
});

describe("formatHolderPct", () => {
  it("shows two decimals and a dash when unknown", () => {
    expect(formatHolderPct(71.74)).toBe("71.74%");
    expect(formatHolderPct(0.01)).toBe("0.01%");
    expect(formatHolderPct(null)).toBe("—");
  });
  it("reads '<0.01%' for a holding the filing rounded to nothing", () => {
    expect(formatHolderPct(0.0002)).toBe("<0.01%");
    expect(formatHolderPct(0, 7220)).toBe("<0.01%");
  });
  it("keeps 0.00% only when there are no shares either", () => {
    expect(formatHolderPct(0)).toBe("0.00%");
    expect(formatHolderPct(0, 0)).toBe("0.00%");
    expect(formatHolderPct(0, null)).toBe("0.00%");
  });
});

describe("summaryText", () => {
  it("names both groups when both exist", () => {
    expect(summaryText({ promoterPct: 71.77, publicPct: 6.94, promoterCount: 305, publicCount: 4 }))
      .toBe("Promoters 71.77% (305) · named public holders 6.94% (4)");
  });
  it("says so when there are no promoters, and leaves out an empty public group", () => {
    expect(summaryText({ promoterPct: 0, publicPct: 39.25, promoterCount: 0, publicCount: 17 }))
      .toBe("No promoter holders named · named public holders 39.25% (17)");
    expect(summaryText({ promoterPct: 50, publicPct: 0, promoterCount: 3, publicCount: 0 })).toBe("Promoters 50.00% (3)");
  });
});
