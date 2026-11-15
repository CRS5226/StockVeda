import { fmt } from "../../lib/stockFormat";
import type { StockRatios } from "../../lib/api";

/** Actual vs estimated EPS for the last quarters. */
export default function EpsHistory({ ratios }: { ratios: StockRatios | null }) {
  return (
    <>
      {/* EPS Beat/Miss — last 4 quarters */}
      {ratios?.eps_history && ratios.eps_history.length > 0 && (
        <div className="mt-3 pt-3 border-t border-slate-100">
          <div className="text-xs text-slate-400 font-medium mb-2">EPS — Actual vs Estimate (last 4 quarters)</div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-slate-400 border-b border-slate-100">
                  <th className="text-left pb-1 font-medium">Quarter</th>
                  <th className="text-right pb-1 font-medium">Estimate</th>
                  <th className="text-right pb-1 font-medium">Actual</th>
                  <th className="text-right pb-1 font-medium">Surprise</th>
                </tr>
              </thead>
              <tbody>
                {[...ratios.eps_history].reverse().map((row) => {
                  const beat = row.surprise_pct != null && row.surprise_pct > 0;
                  const miss = row.surprise_pct != null && row.surprise_pct < 0;
                  return (
                    <tr key={row.quarter} className="border-b border-slate-50 last:border-0">
                      <td className="py-1 text-slate-500">
                        {new Date(row.quarter).toLocaleDateString("en-IN", { month: "short", year: "numeric" })}
                      </td>
                      <td className="py-1 text-right text-slate-500">
                        {row.eps_estimate != null ? `₹${row.eps_estimate}` : "—"}
                      </td>
                      <td className={`py-1 text-right font-medium ${beat ? "text-emerald-600" : miss ? "text-red-500" : "text-slate-700"}`}>
                        ₹{row.eps_actual}
                      </td>
                      <td className={`py-1 text-right font-semibold ${beat ? "text-emerald-600" : miss ? "text-red-500" : "text-slate-400"}`}>
                        {row.surprise_pct != null
                          ? `${beat ? "+" : ""}${fmt(row.surprise_pct)}%`
                          : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
