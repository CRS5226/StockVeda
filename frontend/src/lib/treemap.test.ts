import { describe, expect, it } from "vitest";
import { treemap } from "./treemap";

describe("treemap", () => {
  const items = [{ id: "a", value: 50 }, { id: "b", value: 25 }, { id: "c", value: 15 }, { id: "d", value: 10 }, { id: "zero", value: 0 }];
  const rects = treemap(items, 200, 100);

  it("gives every item with a value a rectangle and leaves out the rest", () => {
    expect(rects.map((r) => r.id).sort()).toEqual(["a", "b", "c", "d"]);
  });
  it("gives each rectangle an area in proportion to its value, and fills the box", () => {
    const area = (id: string) => { const r = rects.find((x) => x.id === id)!; return r.w * r.h; };
    expect(area("a")).toBeCloseTo(200 * 100 * 0.5, 5);
    expect(area("d")).toBeCloseTo(200 * 100 * 0.1, 5);
    expect(rects.reduce((s, r) => s + r.w * r.h, 0)).toBeCloseTo(200 * 100, 5);
  });
  it("keeps every rectangle inside the box and none overlapping", () => {
    for (const r of rects) { expect(r.x).toBeGreaterThanOrEqual(-1e-9); expect(r.y).toBeGreaterThanOrEqual(-1e-9); expect(r.x + r.w).toBeLessThanOrEqual(200 + 1e-9); expect(r.y + r.h).toBeLessThanOrEqual(100 + 1e-9); }
    for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i], b = rects[j];
      const overlap = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 1e-6 && Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > 1e-6;
      expect(overlap).toBe(false);
    }
  });
  it("handles nothing to draw", () => expect(treemap([], 100, 100)).toEqual([]));
});
