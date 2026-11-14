/** Rupee amount such as ₹1,23,456.78, no sign. */
export const rupees = (n: number) => `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Signed rupee amount for profit / loss: +₹1,200.00 or -₹300.00. */
export const signedRupees = (n: number) => `${n > 0 ? "+" : n < 0 ? "-" : ""}${rupees(Math.abs(n))}`;

export const signedPercent = (n: number) => `${n > 0 ? "+" : n < 0 ? "-" : ""}${Math.abs(n).toFixed(2)}%`;

/** Tailwind text colour for a result: green above zero, red below, grey at zero or unknown. */
export const resultColor = (n: number | null) => (n === null || n === 0 ? "text-slate-500" : n > 0 ? "text-emerald-600" : "text-red-600");
