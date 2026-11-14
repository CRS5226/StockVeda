import type { HoldingKind, PortfolioHolding } from "./api";

export const KIND_LABELS: Record<HoldingKind, string> = { stock: "Stock", etf: "ETF", reit: "REIT", invit: "InvIT" };
export const KIND_ORDER: HoldingKind[] = ["stock", "etf", "reit", "invit"];

/** Badge colours per type, as Tailwind classes. */
export const KIND_STYLE: Record<HoldingKind, string> = {
  stock: "bg-slate-100 text-slate-700", etf: "bg-amber-50 text-amber-700", reit: "bg-violet-50 text-violet-700", invit: "bg-teal-50 text-teal-700",
};

/** How many holdings of each type. */
export function countByKind(holdings: Pick<PortfolioHolding, "kind">[]): Record<HoldingKind, number> {
  const out: Record<HoldingKind, number> = { stock: 0, etf: 0, reit: 0, invit: 0 };
  for (const h of holdings) out[h.kind] += 1;
  return out;
}

/** Invested, value and profit of the holdings shown. Only holdings with every figure count, the same rule the server uses. */
export function holdingTotals(holdings: Pick<PortfolioHolding, "invested" | "value" | "pnl">[]) {
  let invested = 0, value = 0, incomplete = 0;
  for (const h of holdings) {
    if (h.pnl === null || h.invested === null || h.value === null) incomplete += 1;
    else { invested += h.invested; value += h.value; }
  }
  const pnl = value - invested;
  return { invested, value, pnl, pnl_pct: invested ? (pnl / invested) * 100 : null, incomplete };
}
