import { describe, expect, it } from "vitest";
import { barKey, toChartTime } from "./barTime";

describe("barKey", () => {
  it("uses the calendar date for daily bars", () => {
    expect(barKey("2026-11-13")).toBe("2026-11-13");
    expect(barKey("2026-11-13T00:00:00")).toBe("2026-11-13");
  });

  it("keeps separate keys for intraday bars on the same date", () => {
    expect(barKey("2026-11-13T09:15:00")).toBe("2026-11-13 09:15:00");
    expect(barKey("2026-11-13T09:20:00")).toBe("2026-11-13 09:20:00");
  });

  it("keeps the exchange wall-clock time when a UTC offset is present", () => {
    expect(barKey("2026-11-13 09:15:00+05:30")).toBe("2026-11-13 09:15:00");
  });
});

describe("toChartTime", () => {
  it("returns a daily key as a date string", () => {
    expect(toChartTime("2026-11-13")).toBe("2026-11-13");
  });

  it("encodes intraday wall-clock time as UTC seconds", () => {
    expect(toChartTime("2026-11-13 09:15:00")).toBe(Date.UTC(2026, 10, 13, 9, 15) / 1000);
  });
});
