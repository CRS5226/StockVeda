export const pct = (n: number | null | undefined, digits = 1) => (n === null || n === undefined ? "—" : `${n.toFixed(digits)}%`);
export const signedPct = (n: number | null | undefined, digits = 1) => (n === null || n === undefined ? "—" : `${n > 0 ? "+" : ""}${n.toFixed(digits)}%`);
