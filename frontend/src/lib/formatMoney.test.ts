import { describe, expect, it } from "vitest";
import { resultColor, rupees, signedPercent, signedRupees } from "./formatMoney";

describe("rupees", () => {
  it("formats positive numbers in Indian numbering system with 2 decimals", () => {
    expect(rupees(123456.5)).toBe("₹1,23,456.50");
    expect(rupees(1000)).toBe("₹1,000.00");
  });

  it("formats zero with 2 decimals", () => {
    expect(rupees(0)).toBe("₹0.00");
  });

  it("formats negative numbers", () => {
    expect(rupees(-1234.5)).toBe("₹-1,234.50");
  });
});

describe("signedRupees", () => {
  it("prefixes positive numbers with +", () => {
    expect(signedRupees(1200)).toBe("+₹1,200.00");
  });

  it("prefixes negative numbers with -", () => {
    expect(signedRupees(-300)).toBe("-₹300.00");
  });

  it("formats zero without sign", () => {
    expect(signedRupees(0)).toBe("₹0.00");
  });
});

describe("signedPercent", () => {
  it("prefixes positive percentage with +", () => {
    expect(signedPercent(5.25)).toBe("+5.25%");
    expect(signedPercent(10)).toBe("+10.00%");
  });

  it("prefixes negative percentage with -", () => {
    expect(signedPercent(-2.5)).toBe("-2.50%");
  });

  it("formats zero percentage without sign", () => {
    expect(signedPercent(0)).toBe("0.00%");
  });
});

describe("resultColor", () => {
  it("returns emerald for positive numbers", () => {
    expect(resultColor(15)).toBe("text-emerald-600");
    expect(resultColor(0.01)).toBe("text-emerald-600");
  });

  it("returns red for negative numbers", () => {
    expect(resultColor(-5)).toBe("text-red-600");
    expect(resultColor(-0.01)).toBe("text-red-600");
  });

  it("returns slate grey for zero and null", () => {
    expect(resultColor(0)).toBe("text-slate-500");
    expect(resultColor(null)).toBe("text-slate-500");
  });
});
