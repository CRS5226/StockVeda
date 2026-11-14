import { describe, expect, it } from "vitest";
import type { SignalRow } from "./api";
import { matchesFilter, ZONE_RANK } from "./signalLabels";

const row = (over: Partial<SignalRow>) => ({ zone: "hold", alignment: null, ...over }) as SignalRow;

describe("matchesFilter", () => {
  it("filters by zone and by agreement across timeframes", () => {
    expect(matchesFilter(row({ zone: "profit" }), "profit")).toBe(true);
    expect(matchesFilter(row({ zone: "profit" }), "recovery")).toBe(false);
    expect(matchesFilter(row({ alignment: "bullish" }), "bullish")).toBe(true);
    expect(matchesFilter(row({ alignment: "mixed" }), "bearish")).toBe(false);
    expect(matchesFilter(row({}), "all")).toBe(true);
  });
  it("ranks the zones that are met ahead of hold", () => {
    expect(ZONE_RANK.profit).toBeLessThan(ZONE_RANK.hold);
    expect(ZONE_RANK.recovery).toBeLessThan(ZONE_RANK.hold);
  });
});
