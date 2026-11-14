import { describe, expect, it } from "vitest";
import { groupByDate, isoDay, monthGrid, shiftMonth } from "./calendar";

describe("monthGrid", () => {
  it("starts on the Sunday before the 1st and fills whole weeks", () => {
    const weeks = monthGrid(2026, 10);                       // November 2026: the 1st is a Sunday
    expect(weeks[0][0]).toEqual({ date: "2026-11-01", day: 1, inMonth: true });
    expect(weeks.length).toBe(5);
    expect(weeks[4][1]).toEqual({ date: "2026-11-30", day: 30, inMonth: true });
    expect(weeks[4][2]).toEqual({ date: "2026-12-01", day: 1, inMonth: false });
    expect(weeks.every((w) => w.length === 7)).toBe(true);
  });
  it("shows the end of the previous month before a mid-week 1st, across a year boundary", () => {
    const weeks = monthGrid(2026, 0);                        // January 2026: the 1st is a Thursday
    expect(weeks[0].map((c) => c.date)).toEqual(["2025-12-28", "2025-12-29", "2025-12-30", "2025-12-31", "2026-01-01", "2026-01-02", "2026-01-03"]);
    expect(weeks[0][3].inMonth).toBe(false);
  });
  it("handles a February in a leap year", () => {
    const days = monthGrid(2028, 1).flat().filter((c) => c.inMonth);
    expect(days.length).toBe(29);
  });
});

describe("shiftMonth and isoDay", () => {
  it("rolls over the year in both directions", () => {
    expect(shiftMonth(2026, 11, 1)).toEqual({ year: 2027, month: 0 });
    expect(shiftMonth(2026, 0, -1)).toEqual({ year: 2025, month: 11 });
    expect(shiftMonth(2026, 5, 0)).toEqual({ year: 2026, month: 5 });
  });
  it("pads months and days", () => expect(isoDay(2026, 2, 5)).toBe("2026-03-05"));
});

describe("groupByDate", () => {
  it("groups rows paid on the same day", () => {
    const g = groupByDate([{ pay_date: "2026-06-20", s: "HAL" }, { pay_date: "2026-06-20", s: "BEL" }, { pay_date: "2026-07-01", s: "ITC" }]);
    expect(g.get("2026-06-20")?.length).toBe(2);
    expect(g.get("2026-07-01")?.[0].s).toBe("ITC");
    expect(g.get("2026-08-01")).toBeUndefined();
  });
});
