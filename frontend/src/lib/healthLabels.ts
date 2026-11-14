/** The types a target can be set for, in the order they are shown. The keys match the portfolio total's slices. */
export const TARGET_TYPES: { key: string; label: string }[] = [
  { key: "stocks", label: "Stocks" }, { key: "mutual_funds", label: "Mutual funds" }, { key: "fixed_deposits", label: "Fixed deposits" },
  { key: "crypto", label: "Crypto" }, { key: "us_stock", label: "US stocks" }, { key: "gold", label: "Gold" },
  { key: "bond", label: "Bonds" }, { key: "mutual_fund", label: "Other funds" }, { key: "other", label: "Other" },
];

export const pct = (n: number | null | undefined, digits = 1) => (n === null || n === undefined ? "—" : `${n.toFixed(digits)}%`);
export const signedPct = (n: number | null | undefined, digits = 1) => (n === null || n === undefined ? "—" : `${n > 0 ? "+" : ""}${n.toFixed(digits)}%`);
