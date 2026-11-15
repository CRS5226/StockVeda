/** Small pure helpers for the Stock Connections page. */

import type { FlowNode, OwnershipEdge, OwnershipNode } from "./connectionsTypes";

/** True when an api.ts error is a 404, which here means "no data for this stock yet", not a failure. */
export const isNotFound = (e: unknown): boolean => e instanceof Error && e.message.startsWith("404");

/** "+3.2%", "-1.0%", or a dash when the value is unknown. */
export const signedReturn = (n: number | null | undefined): string =>
  n === null || n === undefined ? "–" : `${n > 0 ? "+" : n < 0 ? "-" : ""}${Math.abs(n).toFixed(1)}%`;

/** A correlation in words, so a number such as 0.43 is readable at a glance. */
export function correlationLabel(c: number | null): string {
  if (c === null) return "–";
  const a = Math.abs(c);
  const strength = a >= 0.7 ? "strong" : a >= 0.4 ? "moderate" : a >= 0.2 ? "weak" : "very weak";
  return `${strength} ${c < 0 ? "inverse" : "positive"}`;
}

const KIND_LABELS: Record<string, string> = {
  order: "Order", rating: "Rating", deal: "Deal", capacity: "Capacity",
  dividend: "Dividend", management: "Management", insolvency: "Insolvency",
};
export const kindLabel = (kind: string): string => KIND_LABELS[kind] ?? kind;

const FLAG_LABELS: Record<string, string> = { heavy_rain: "Heavy rain", heat: "Heat", strong_wind: "Strong wind" };
export const flagLabel = (flag: string): string => FLAG_LABELS[flag] ?? flag;

/** "2026-11-13 10:37" -> "13 Nov 2026" (date only), or the input when it is not a date. */
export function shortDate(text: string): string {
  const d = new Date(text.slice(0, 10) + "T00:00:00");
  return Number.isNaN(d.getTime()) ? text : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export interface PlacedNode { node: OwnershipNode; x: number; y: number; pct: number | null; side: "left" | "right" | "center" }

/**
 * Positions for a one-step ownership graph: the company in the middle, its holders in a column on the
 * left and the companies it holds in a column on the right, biggest first. Nodes not linked to the
 * company are left out. `max` caps each side, since a long column cannot be read.
 */
export function layoutOwnership(
  nodes: OwnershipNode[], edges: OwnershipEdge[], centerId: string, width: number, height: number, max = 8,
): { placed: PlacedNode[]; hiddenHolders: number; hiddenHoldings: number } {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const center = byId.get(centerId);
  if (!center) return { placed: [], hiddenHolders: 0, hiddenHoldings: 0 };

  const holders = edges.filter((e) => e.target === centerId && byId.has(e.source)).sort((a, b) => b.pct - a.pct);
  const holdings = edges.filter((e) => e.source === centerId && byId.has(e.target)).sort((a, b) => b.pct - a.pct);
  const column = (list: OwnershipEdge[], side: "left" | "right", idOf: (e: OwnershipEdge) => string): PlacedNode[] => {
    const shown = list.slice(0, max);
    return shown.map((e, i) => ({
      node: byId.get(idOf(e))!,
      x: side === "left" ? width * 0.14 : width * 0.86,
      y: shown.length === 1 ? height / 2 : 44 + (i * (height - 88)) / (shown.length - 1),   // headroom for the column labels
      pct: e.pct, side,
    }));
  };
  return {
    placed: [
      { node: center, x: width / 2, y: height / 2, pct: null, side: "center" },
      ...column(holders, "left", (e) => e.source),
      ...column(holdings, "right", (e) => e.target),
    ],
    hiddenHolders: Math.max(0, holders.length - max),
    hiddenHoldings: Math.max(0, holdings.length - max),
  };
}

/** Line width in pixels for a holding of `pct` percent: 1 to 6. */
export const edgeWidth = (pct: number): number => Math.min(6, Math.max(1, Math.sqrt(pct) * 0.8));

/**
 * Group chain steps into columns from raw material to end use: a step sits one column right of the
 * furthest step that feeds it. Steps in a column keep the order they came in.
 */
export function flowColumns(nodes: FlowNode[], edges: { from: string; to: string }[]): FlowNode[][] {
  const depth = new Map(nodes.map((n) => [n.id, 0]));
  for (let pass = 0; pass < nodes.length; pass++) {
    for (const e of edges) depth.set(e.to, Math.max(depth.get(e.to) ?? 0, (depth.get(e.from) ?? 0) + 1));
  }
  const columns: FlowNode[][] = [];
  for (const n of nodes) (columns[depth.get(n.id) ?? 0] ??= []).push(n);
  return columns.filter(Boolean);
}

export type StockView = "overview" | "connections";

/** Which view of the stock page the `?tab=` value asks for; anything else is the overview. */
export const stockView = (tabParam: string | null): StockView => (tabParam === "connections" ? "connections" : "overview");

/** The stock page's Connections view for a symbol. */
export const connectionsPath = (symbol: string): string => `/stock/${encodeURIComponent(symbol)}?tab=connections`;

const NAMED_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** Turn the HTML entities NSE leaves in announcement text (&#8377;, &amp; ...) into plain characters. */
export function decodeEntities(text: string): string {
  return text.replace(/&(?:#(\d+)|#x([0-9a-fA-F]+)|([a-zA-Z]+));/g, (whole, dec, hex, name) => {
    if (dec || hex) {
      const code = dec ? parseInt(dec, 10) : parseInt(hex, 16);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return NAMED_ENTITIES[name.toLowerCase()] ?? whole;
  });
}

/** The anchors of the Connections sections, so a link can open the view at the right one. */
export type SectionId = "correlated" | "chain" | "owners" | "location" | "events";
export const sectionElementId = (section: SectionId): string => `connections-${section}`;

/** The Connections view of a stock, scrolled to one section. */
export const connectionsSectionPath = (symbol: string, section: SectionId): string =>
  `${connectionsPath(symbol)}#${sectionElementId(section)}`;
