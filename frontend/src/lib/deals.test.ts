import { describe, expect, it } from "vitest";
import { dealsCoverage, DEALS_DAYS, formatQty } from "./deals";

const TODAY = new Date("2026-11-15T12:00:00");

describe("formatQty", () => {
  it("uses crore and lakh for big quantities", () => {
    expect(formatQty(20_402_120)).toBe("2.04Cr");
    expect(formatQty(150_000)).toBe("1.5L");
    expect(formatQty(99_999)).toBe((99_999).toLocaleString());
    expect(formatQty(0)).toBe("0");
  });
});

describe("dealsCoverage", () => {
  it("says what is stored and adds no note when it covers the window and is current", () => {
    const c = dealsCoverage({ from: "2026-08-17", to: "2026-11-13" }, TODAY);
    expect(c.stored).toMatch(/^Stored deals run from 17 Aug 2026 to 13 Nov 2026\.$/);
    expect(c.notes).toEqual([]);
  });
  it("warns when the history starts after the window does", () => {
    const c = dealsCoverage({ from: "2026-10-01", to: "2026-11-13" }, TODAY);
    expect(c.notes).toHaveLength(1);
    expect(c.notes[0]).toMatch(/History starts on 1 Oct 2026/);
  });
  it("tolerates a start a day or two inside the window", () => {
    expect(dealsCoverage({ from: "2026-08-19", to: "2026-11-14" }, TODAY).notes).toEqual([]);
  });
  it("hints to sync when the newest stored day is old", () => {
    const c = dealsCoverage({ from: "2026-08-17", to: "2026-11-05" }, TODAY);
    expect(c.notes).toHaveLength(1);
    expect(c.notes[0]).toMatch(/newest stored day is 5 Nov 2026/);
  });
  it("can give both notes at once", () => {
    expect(dealsCoverage({ from: "2026-10-20", to: "2026-11-01" }, TODAY).notes).toHaveLength(2);
  });
  it("says nothing is stored when there is no range", () => {
    const c = dealsCoverage(null, TODAY);
    expect(c.stored).toBe("No deals have been fetched yet.");
    expect(c.notes).toEqual(["Press Sync to fetch them."]);
  });
  it("asks for 90 days", () => {
    expect(DEALS_DAYS).toBe(90);
  });
});
