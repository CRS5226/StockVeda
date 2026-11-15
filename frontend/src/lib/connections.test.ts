import { describe, expect, it } from "vitest";
import { connectionsPath, correlationLabel, decodeEntities, edgeWidth, flagLabel, flowColumns, isNotFound, kindLabel, layoutOwnership, shortDate, signedReturn, stockView } from "./connections";
import type { FlowNode, OwnershipEdge, OwnershipNode } from "./connectionsTypes";

describe("small formatters", () => {
  it("recognises a 404 as 'no data yet'", () => {
    expect(isNotFound(new Error("404: No weather"))).toBe(true);
    expect(isNotFound(new Error("500: boom"))).toBe(false);
    expect(isNotFound("404")).toBe(false);
  });
  it("formats returns with a sign and a dash for unknown", () => {
    expect(signedReturn(3.24)).toBe("+3.2%");
    expect(signedReturn(-1)).toBe("-1.0%");
    expect(signedReturn(0)).toBe("0.0%");
    expect(signedReturn(null)).toBe("–");
  });
  it("describes correlation strength and direction", () => {
    expect(correlationLabel(0.8)).toBe("strong positive");
    expect(correlationLabel(-0.45)).toBe("moderate inverse");
    expect(correlationLabel(0.05)).toBe("very weak positive");
    expect(correlationLabel(null)).toBe("–");
  });
  it("labels kinds and flags, and passes unknown ones through", () => {
    expect(kindLabel("order")).toBe("Order");
    expect(kindLabel("new-kind")).toBe("new-kind");
    expect(flagLabel("heavy_rain")).toBe("Heavy rain");
    expect(flagLabel("x")).toBe("x");
  });
  it("shortens a date and keeps text that is not a date", () => {
    expect(shortDate("2026-11-13 10:37")).toMatch(/13 Nov 2026/);
    expect(shortDate("soon")).toBe("soon");
  });
  it("keeps edge width between 1 and 6", () => {
    expect(edgeWidth(0.01)).toBe(1);
    expect(edgeWidth(100)).toBe(6);
    expect(edgeWidth(9)).toBeGreaterThan(edgeWidth(4));
  });
});

const node = (id: string): OwnershipNode => ({ id, symbol: id, listed: true, kind: "company", label: id });
const edge = (source: string, target: string, pct: number): OwnershipEdge => ({ source, target, pct, as_of: "2026-09-30" });

describe("layoutOwnership", () => {
  const nodes = ["TCS", "A", "B", "C", "HELD", "OTHER"].map(node);
  const edges = [edge("A", "TCS", 5), edge("B", "TCS", 30), edge("C", "TCS", 2), edge("TCS", "HELD", 6), edge("OTHER", "A", 9)];

  it("puts the company in the middle, holders left and holdings right, biggest first", () => {
    const { placed } = layoutOwnership(nodes, edges, "TCS", 800, 400);
    const at = (id: string) => placed.find((p) => p.node.id === id)!;
    expect(at("TCS")).toMatchObject({ x: 400, y: 200, side: "center" });
    expect(at("B").side).toBe("left");
    expect(at("HELD").side).toBe("right");
    expect(at("B").y).toBeLessThan(at("A").y);       // 30% above 5%
    expect(at("A").y).toBeLessThan(at("C").y);
    expect(placed.find((p) => p.node.id === "OTHER")).toBeUndefined();  // not linked to the company
  });

  it("caps each side and reports how many are hidden", () => {
    const many = Array.from({ length: 12 }, (_, i) => `H${i}`);
    const res = layoutOwnership([node("X"), ...many.map(node)], many.map((h, i) => edge(h, "X", i + 1)), "X", 800, 400, 5);
    expect(res.placed.filter((p) => p.side === "left")).toHaveLength(5);
    expect(res.hiddenHolders).toBe(7);
    expect(res.hiddenHoldings).toBe(0);
  });

  it("handles a missing centre and a single neighbour", () => {
    expect(layoutOwnership(nodes, edges, "NOPE", 800, 400).placed).toEqual([]);
    const one = layoutOwnership([node("X"), node("Y")], [edge("Y", "X", 3)], "X", 800, 400).placed.find((p) => p.node.id === "Y")!;
    expect(one.y).toBe(200);
  });
});

describe("flowColumns", () => {
  const step = (id: string): FlowNode => ({ id, label: id, role: "other", stocks: [] });
  it("puts each step one column right of the furthest step that feeds it", () => {
    const nodes = ["crude", "refining", "gas", "chem"].map(step);
    const edges = [{ from: "crude", to: "refining" }, { from: "crude", to: "gas" }, { from: "refining", to: "chem" }];
    const cols = flowColumns(nodes, edges).map((c) => c.map((n) => n.id));
    expect(cols).toEqual([["crude"], ["refining", "gas"], ["chem"]]);
  });
  it("uses the longest path when a step has two feeders", () => {
    const nodes = ["a", "b", "c"].map(step);
    const cols = flowColumns(nodes, [{ from: "a", to: "b" }, { from: "b", to: "c" }, { from: "a", to: "c" }]).map((c) => c.map((n) => n.id));
    expect(cols).toEqual([["a"], ["b"], ["c"]]);
  });
  it("returns one column for steps with no edges and nothing for no steps", () => {
    expect(flowColumns(["x", "y"].map(step), []).map((c) => c.length)).toEqual([2]);
    expect(flowColumns([], [])).toEqual([]);
  });
});

describe("stock page view", () => {
  it("opens the connections view only for ?tab=connections", () => {
    expect(stockView("connections")).toBe("connections");
    expect(stockView(null)).toBe("overview");
    expect(stockView("fundamentals")).toBe("overview");
    expect(stockView("")).toBe("overview");
  });
  it("builds the connections path with the symbol encoded", () => {
    expect(connectionsPath("TCS")).toBe("/stock/TCS?tab=connections");
    expect(connectionsPath("M&M")).toBe("/stock/M%26M?tab=connections");
  });
});

describe("decodeEntities", () => {
  it("decodes numeric, hex and common named entities", () => {
    expect(decodeEntities("face value &#8377;10/- each")).toBe("face value ₹10/- each");
    expect(decodeEntities("&#x20B9;5 &amp; &lt;b&gt; &quot;x&quot;")).toBe('₹5 & <b> "x"');
  });
  it("leaves unknown entities, bad code points and plain text alone", () => {
    expect(decodeEntities("&unknown; &#0; &#99999999;")).toBe("&unknown; &#0; &#99999999;");
    expect(decodeEntities("no entities here")).toBe("no entities here");
  });
});
