import { describe, expect, it } from "vitest";
import { barAtOrBefore, chartTimeToEpoch } from "./crosshairSync";
import type { Time } from "lightweight-charts";

describe("chartTimeToEpoch", () => {
  it("keeps intraday timestamps and turns a daily date into midnight UTC", () => {
    expect(chartTimeToEpoch(1_700_000_000 as Time)).toBe(1_700_000_000);
    expect(chartTimeToEpoch("2026-01-02" as Time)).toBe(Date.UTC(2026, 0, 2) / 1000);
  });
});

describe("barAtOrBefore", () => {
  const epochs = [10, 20, 30, 40];
  it("finds the bar a time falls in", () => {
    expect(barAtOrBefore(epochs, 20)).toBe(1);
    expect(barAtOrBefore(epochs, 25)).toBe(1);
    expect(barAtOrBefore(epochs, 99)).toBe(3);
  });
  it("returns -1 before the first bar and for no bars", () => {
    expect(barAtOrBefore(epochs, 5)).toBe(-1);
    expect(barAtOrBefore([], 5)).toBe(-1);
  });
});
