import { describe, expect, it } from "vitest";
import { buyInfo } from "./dividendRules";

describe("buyInfo", () => {
  it("gives the earliest buy date of a stock held in several lots", () => {
    const info = buyInfo([{ symbol: "ITC", buy_date: "2026-03-01" }, { symbol: "ITC", buy_date: "2025-06-10" }, { symbol: "TCS", buy_date: "2026-01-05" }]);
    expect(info.get("ITC")).toBe("2025-06-10");
    expect(info.get("TCS")).toBe("2026-01-05");
  });
  it("is null when any lot has no date, and absent when the stock is not held", () => {
    const info = buyInfo([{ symbol: "ITC", buy_date: "2026-03-01" }, { symbol: "ITC", buy_date: null }, { symbol: "ABB", buy_date: null }]);
    expect(info.get("ITC")).toBeNull();
    expect(info.get("ABB")).toBeNull();
    expect(info.has("WIPRO")).toBe(false);
  });
});
