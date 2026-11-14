import { describe, expect, it } from "vitest";
import { countByKind, holdingTotals } from "./holdingKinds";

describe("countByKind", () => {
  it("counts each type", () => {
    expect(countByKind([{ kind: "stock" }, { kind: "etf" }, { kind: "stock" }, { kind: "reit" }])).toEqual({ stock: 2, etf: 1, reit: 1, invit: 0 });
  });
});

describe("holdingTotals", () => {
  it("adds up complete holdings and counts the rest as incomplete", () => {
    const t = holdingTotals([
      { invested: 1000, value: 1200, pnl: 200 },
      { invested: 500, value: 450, pnl: -50 },
      { invested: null, value: null, pnl: null },
    ]);
    expect(t).toMatchObject({ invested: 1500, value: 1650, pnl: 150, incomplete: 1 });
    expect(t.pnl_pct).toBeCloseTo(10);
  });
  it("has no percent when nothing is invested", () => expect(holdingTotals([]).pnl_pct).toBeNull());
});
