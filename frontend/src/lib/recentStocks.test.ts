import { describe, expect, it } from "vitest";
import { addRecent, MAX_RECENT, parseRecent } from "./recentStocks";

describe("parseRecent", () => {
  it("reads a stored list and drops anything that is not a symbol", () => {
    expect(parseRecent('["TCS","RELIANCE"]')).toEqual(["TCS", "RELIANCE"]);
    expect(parseRecent('["TCS", 5, null, "bad symbol", "tcs", "M&M"]')).toEqual(["TCS", "M&M"]);
  });
  it("returns an empty list for missing or broken data", () => {
    expect(parseRecent(null)).toEqual([]);
    expect(parseRecent("")).toEqual([]);
    expect(parseRecent("{not json")).toEqual([]);
    expect(parseRecent('{"a":1}')).toEqual([]);
  });
  it("removes duplicates and caps the length", () => {
    expect(parseRecent('["TCS","TCS","INFY"]')).toEqual(["TCS", "INFY"]);
    const many = JSON.stringify(Array.from({ length: 20 }, (_, i) => `S${i}`));
    expect(parseRecent(many)).toHaveLength(MAX_RECENT);
  });
});

describe("addRecent", () => {
  it("puts the newest first and moves an old copy to the front", () => {
    expect(addRecent(["TCS", "INFY"], "reliance")).toEqual(["RELIANCE", "TCS", "INFY"]);
    expect(addRecent(["TCS", "INFY", "WIPRO"], "infy")).toEqual(["INFY", "TCS", "WIPRO"]);
  });
  it("keeps at most the allowed number", () => {
    const full = Array.from({ length: MAX_RECENT }, (_, i) => `S${i}`);
    const next = addRecent(full, "NEW");
    expect(next).toHaveLength(MAX_RECENT);
    expect(next[0]).toBe("NEW");
    expect(next).not.toContain(`S${MAX_RECENT - 1}`);
  });
  it("ignores something that is not a symbol", () => {
    expect(addRecent(["TCS"], "  ")).toEqual(["TCS"]);
    expect(addRecent(["TCS"], "has space")).toEqual(["TCS"]);
  });
});
