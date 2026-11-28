import { describe, expect, it } from "vitest";
import { money, percent, points, price, signed, tone } from "./formatTrade";

describe("formatTrade", () => {
  it("groups prices in the Indian numbering system and keeps two decimals", () => {
    expect(price(123456.5)).toBe("1,23,456.50");
    expect(price(-123456.5)).toBe("-1,23,456.50");
  });

  it("prints a sign for positive and negative results", () => {
    expect(signed(12.5)).toBe("+12.50");
    expect(signed(-3)).toBe("-3.00");
    expect(signed(0)).toBe("0.00");
  });

  it("formats points and rupees with their respective units", () => {
    expect(points(12.5)).toBe("+12.50 pts");
    expect(money(-1500)).toBe("-₹1,500.00");
  });

  it("rounds percentages to two decimals and keeps the sign", () => {
    expect(percent(-1.234)).toBe("-1.23%");
    expect(percent(1.236)).toBe("+1.24%");
    expect(percent(0)).toBe("0.00%");
  });

  it.each([
    [1, "text-emerald-600", "text-emerald-400"],
    [-1, "text-red-600", "text-red-400"],
    [0, "text-slate-500", "text-slate-400"],
  ] as const)("uses the correct light and dark text colors for %s", (value, light, dark) => {
    expect(tone(value, false)).toBe(light);
    expect(tone(value, true)).toBe(dark);
  });
});
