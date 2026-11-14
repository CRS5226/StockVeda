import type { PortfolioHolding } from "./api";

/** What the form needs to know about a stock: held or not, and the date it was first bought (null when it is not known). */
export type BuyInfo = Map<string, string | null>;

/**
 * Per stock, the date it was first bought. A stock held in several lots is only dated when every lot has a buy date,
 * otherwise the first purchase cannot be known and the value is null. Stocks not held are absent from the map.
 */
export function buyInfo(holdings: Pick<PortfolioHolding, "symbol" | "buy_date">[]): BuyInfo {
  const lots = new Map<string, (string | null)[]>();
  for (const h of holdings) lots.set(h.symbol, [...(lots.get(h.symbol) ?? []), h.buy_date]);
  const out: BuyInfo = new Map();
  for (const [symbol, dates] of lots) out.set(symbol, dates.some((d) => d === null) ? null : [...dates as string[]].sort()[0]);
  return out;
}
