import { describe, expect, it } from "vitest";
import { describeSync } from "./usePriceSync";

const job = (over: Partial<Parameters<typeof describeSync>[0]>) =>
  ({ status: "done", total: 3, done: 3, prices: 0, updated_symbols: 0, navs: 0, no_data: [], as_of: "2026-11-13", ...over }) as Parameters<typeof describeSync>[0];

describe("describeSync", () => {
  it("counts what was updated", () => {
    expect(describeSync(job({ updated_symbols: 63, navs: 4 }))).toBe("63 stocks updated, 4 funds updated.");
    expect(describeSync(job({ updated_symbols: 1 }))).toBe("1 stock updated.");
  });
  it("says it is up to date when nothing new came in", () => {
    expect(describeSync(job({}))).toMatch(/Already up to date/);
  });
  it("names the symbols that had no price, shortening a long list", () => {
    expect(describeSync(job({ updated_symbols: 2, no_data: ["KRT"] }))).toBe("2 stocks updated. No price found for KRT.");
    expect(describeSync(job({ no_data: ["A", "B", "C", "D", "E", "F"] }))).toContain("A, B, C, D and 2 more");
  });
});
