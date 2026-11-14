import { describe, expect, it } from "vitest";
import type { DataSyncJob, DataSyncStep } from "./api";
import { describeDataSync } from "./usePortfolioDataSync";

const step = (over: Partial<DataSyncStep>): DataSyncStep => ({ key: "hourly", label: "1-hour candles", total: 3, done: 3, updated: 3, rows: 100, status: "done", no_data: [], failed: [], ...over });
const job = (steps: DataSyncStep[]): DataSyncJob => ({ status: "done", current: null, error: null, steps });

describe("describeDataSync", () => {
  it("lists each step that ran with what it updated", () => {
    expect(describeDataSync(job([step({}), step({ key: "ratios", label: "Valuation ratios", updated: 70 }), step({ key: "fundamentals", status: "skipped" })])))
      .toBe("1-hour candles: 3 updated · Valuation ratios: 70 updated.");
  });
  it("counts symbols Yahoo had nothing for and failures", () => {
    expect(describeDataSync(job([step({ no_data: ["KRT"], failed: ["A", "B"] })]))).toBe("1-hour candles: 3 updated · 1 with no data from Yahoo · 2 failed.");
  });
  it("says so when no step ran", () => {
    expect(describeDataSync(job([step({ status: "skipped" })]))).toBe("Everything was already up to date.");
  });
});
