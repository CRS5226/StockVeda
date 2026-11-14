import { describe, expect, it } from "vitest";
import { nextSort, sortRows } from "./sortRows";

interface Row { name: string; qty: number | null; date: string | null }
const rows: Row[] = [
  { name: "tcs", qty: 5, date: "2026-02-01" },
  { name: "ABB", qty: null, date: null },
  { name: "ITC", qty: 20, date: "2025-06-10" },
];

describe("sortRows", () => {
  it("sorts numbers both ways and always puts empty values last", () => {
    expect(sortRows(rows, "qty", "asc").map((r) => r.name)).toEqual(["tcs", "ITC", "ABB"]);
    expect(sortRows(rows, "qty", "desc").map((r) => r.name)).toEqual(["ITC", "tcs", "ABB"]);
  });
  it("sorts text without regard to case, and dates as text", () => {
    expect(sortRows(rows, "name", "asc").map((r) => r.name)).toEqual(["ABB", "ITC", "tcs"]);
    expect(sortRows(rows, "date", "desc").map((r) => r.name)).toEqual(["tcs", "ITC", "ABB"]);
  });
  it("leaves the input untouched", () => {
    const copy = [...rows];
    sortRows(rows, "qty", "asc");
    expect(rows).toEqual(copy);
  });
});

describe("nextSort", () => {
  it("goes ascending, then descending, then off, and restarts on another column", () => {
    const a = nextSort<"qty" | "name">(null, "qty");
    expect(a).toEqual({ key: "qty", dir: "asc" });
    const d = nextSort(a, "qty");
    expect(d).toEqual({ key: "qty", dir: "desc" });
    expect(nextSort(d, "qty")).toBeNull();
    expect(nextSort(d, "name")).toEqual({ key: "name", dir: "asc" });
  });
});
