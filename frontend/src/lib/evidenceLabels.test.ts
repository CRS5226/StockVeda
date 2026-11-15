import { describe, expect, it } from "vitest";
import type { RuleResult } from "./api";
import { heldUpCount, summaryLine } from "./evidenceLabels";

const res = (verdict: RuleResult["verdict"]) => ({ verdict }) as RuleResult;

describe("evidence helpers", () => {
  it("counts the rules that held up", () => {
    expect(heldUpCount({ a: res("held_up"), b: res("did_not"), c: res("held_up"), d: null })).toBe(2);
    expect(heldUpCount({})).toBe(0);
  });
  it("words the summary of a rule", () => {
    expect(summaryLine({ key: "macd", tested: 77, held_up: 16, mixed: 32, did_not: 29, few_trades: 0, median_later_pct: -3.9, beat_buy_hold_later: 37 })).toBe("Held up on 16 of 77 stocks");
  });
});
