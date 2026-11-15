import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fmt, fmtCr, fmtNewsDate, fromDate, newsTime, RANGES, SECTOR_RANGES } from "./stockFormat";
import { TABS } from "../components/stock/stockTabs";

describe("fmt and fmtCr", () => {
  it("formats numbers the Indian way and shows a dash for missing values", () => {
    expect(fmt(1234567.891)).toBe("12,34,567.89");
    expect(fmt(1.5, 0)).toBe("2");
    expect(fmt(null)).toBe("—");
    expect(fmt(undefined)).toBe("—");
    expect(fmt(0)).toBe("0");
  });
  it("turns rupees into crore", () => {
    expect(fmtCr(12.5e7)).toBe("₹13 Cr");
    expect(fmtCr(-3e7)).toBe("₹-3 Cr");
    expect(fmtCr(null)).toBe("—");
  });
});

describe("fromDate", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-15T10:00:00Z")); });
  afterEach(() => vi.useRealTimers());
  it("goes back by the chosen number of months, and MAX has no start", () => {
    expect(fromDate("1M")).toBe("2026-10-15");
    expect(fromDate("1Y")).toBe("2025-11-15");
    expect(fromDate("3Y")).toBe("2023-11-15");
    expect(fromDate("MAX")).toBeUndefined();
  });
});

describe("news dates", () => {
  it("reads an RFC-822 date and returns 0 for rubbish", () => {
    expect(newsTime("Wed, 18 Jun 2026 10:30:00 GMT")).toBe(Date.UTC(2026, 5, 18, 10, 30));
    expect(newsTime("not a date")).toBe(0);
    expect(newsTime(undefined)).toBe(0);
  });
  it("falls back to the first 16 characters when the date cannot be read", () => {
    expect(fmtNewsDate("garbage garbage garbage garbage")).toBe("garbage garbage ");
    expect(fmtNewsDate("Wed, 18 Jun 2026 10:30:00 GMT")).toMatch(/Jun 2026/);
  });
});

describe("page constants", () => {
  it("lists the ranges and the tabs without duplicates", () => {
    expect(RANGES).toEqual(["1M", "3M", "6M", "1Y", "3Y", "MAX"]);
    expect(SECTOR_RANGES).toEqual(["1M", "3M", "6M", "1Y"]);
    const ids = TABS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(["fundamentals", "delivery", "shareholding", "corp", "deals", "news"]);
  });
});
