import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { api, type PortfolioDetail, type PortfolioTotal as Total } from "../../lib/api";
import { resultColor, rupees, signedPercent, signedRupees } from "../../lib/formatMoney";
import { errorText } from "../../lib/useTradePlots";
import { usePriceSync } from "../../lib/usePriceSync";

const COLORS: Record<string, string> = {
  stocks: "#3b82f6", fixed_deposits: "#14b8a6", crypto: "#f59e0b", us_stock: "#8b5cf6", mutual_fund: "#ec4899", bond: "#64748b", gold: "#eab308", other: "#94a3b8",
};

/** Ring chart of each part's share of the current value. */
function Donut({ parts }: { parts: Total["parts"] }) {
  let offset = 0;
  return (
    <svg viewBox="0 0 40 40" className="w-40 h-40 -rotate-90 shrink-0 overflow-visible" role="img" aria-label="Allocation by type">
      <circle cx="20" cy="20" r="15.9155" fill="none" stroke="#e2e8f0" strokeWidth="5" />
      {parts.map((p) => {
        const share = Math.max(p.share_pct, 0);
        const slice = (
          <circle key={p.key} cx="20" cy="20" r="15.9155" fill="none" stroke={COLORS[p.key] ?? "#94a3b8"} strokeWidth="5"
            strokeDasharray={`${share} ${100 - share}`} strokeDashoffset={-offset} />
        );
        offset += share;
        return slice;
      })}
    </svg>
  );
}

const darkTone = (n: number | null) => (n === null || n === 0 ? "text-slate-300" : n > 0 ? "text-emerald-400" : "text-red-400");

/**
 * Everything in the portfolio added up in rupees: stocks, fixed deposits and the other investments, split by type.
 * `stocks` and `refreshKey` change whenever something in the portfolio does, which reloads the total.
 */
export default function PortfolioTotal({ portfolioId, stocks, refreshKey, onPricesUpdated }: { portfolioId: number; stocks: PortfolioDetail; refreshKey: number; onPricesUpdated: () => void }) {
  const sync = usePriceSync(portfolioId, onPricesUpdated);
  const [total, setTotal] = useState<Total | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    api.getPortfolioTotal(portfolioId).then((t) => { if (!cancelled) { setTotal(t); setError(""); } }).catch((e) => { if (!cancelled) setError(errorText(e)); });
    return () => { cancelled = true; };
  }, [portfolioId, stocks, refreshKey]);

  if (error) return <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>;
  if (!total) return null;

  const leftOut = [
    total.left_out.stocks > 0 && `${total.left_out.stocks} ${total.left_out.stocks === 1 ? "stock" : "stocks"} without a quantity and buy price`,
    total.left_out.assets > 0 && `${total.left_out.assets} dollar ${total.left_out.assets === 1 ? "asset" : "assets"} without a USD to INR rate`,
  ].filter(Boolean);

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5">
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <h2 className="font-semibold">Portfolio total</h2>
        <div className="ml-auto flex items-center gap-3">
          {sync.message && (
            <span className={`text-xs ${sync.phase === "error" ? "text-red-600" : sync.phase === "done" ? "text-emerald-600" : "text-slate-500"}`} role="status">{sync.message}</span>
          )}
          {sync.phase === "running" && <span className="text-xs text-slate-500 tabular-nums" role="status">Updating {sync.progress.done} of {sync.progress.total}…</span>}
          <button onClick={() => void sync.sync()} disabled={sync.busy} title="Fetch the latest closing prices and fund NAVs"
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-60">
            <RefreshCw size={13} className={sync.busy ? "animate-spin" : ""} /> {sync.busy ? "Syncing…" : "Sync prices"}
          </button>
        </div>
      </div>
      <div className="flex flex-wrap gap-8 items-stretch">
        <div className="min-w-[260px] rounded-xl bg-gradient-to-br from-slate-700 to-slate-900 text-white p-5 flex flex-col gap-4">
          <div>
            <div className="text-xs text-slate-300">Current value</div>
            <div className="text-3xl font-bold tabular-nums">{rupees(total.value)}</div>
            <div className={`mt-1 text-sm tabular-nums ${darkTone(total.pnl)}`}>
              Total returns {signedRupees(total.pnl)}{total.pnl_pct !== null && ` (${signedPercent(total.pnl_pct)})`}
            </div>
            {total.dividends > 0 && <div className="text-[11px] text-slate-400">includes {rupees(total.dividends)} of dividends</div>}
          </div>
          <div className="flex justify-between gap-6 text-sm">
            <div><div className="text-xs text-slate-300">Invested value</div><div className="font-semibold tabular-nums">{rupees(total.invested)}</div></div>
            <div className="text-right" title="Annual return worked out from the dated purchases">
              <div className="text-xs text-slate-300">XIRR</div>
              <div className={`font-semibold tabular-nums ${darkTone(total.xirr_pct)}`}>{total.xirr_pct === null ? "—" : signedPercent(total.xirr_pct)}</div>
            </div>
          </div>
          {total.xirr_items.total > total.xirr_items.dated && (
            <div className="text-[11px] text-slate-400">XIRR uses {total.xirr_items.dated} of {total.xirr_items.total} items; the rest have no buy date.</div>
          )}
        </div>
        {total.parts.length > 0 ? (
          <div className="flex flex-wrap gap-6 items-center flex-1 min-w-[300px]">
            <Donut parts={total.parts} />
            <table className="text-sm flex-1 min-w-[260px]">
              <thead>
                <tr className="text-xs text-slate-500 text-left">
                  <th className="py-1 font-medium">Type</th><th className="py-1 font-medium text-right">Value</th><th className="py-1 font-medium text-right">Share</th><th className="py-1 font-medium text-right">P&L</th>
                </tr>
              </thead>
              <tbody>
                {total.parts.map((p) => (
                  <tr key={p.key} className="border-t border-slate-100">
                    <td className="py-1.5"><span className="inline-block w-2.5 h-2.5 rounded-full mr-2 align-middle" style={{ background: COLORS[p.key] ?? "#94a3b8" }} />{p.label}</td>
                    <td className="py-1.5 text-right tabular-nums">{rupees(p.value)}</td>
                    <td className="py-1.5 text-right tabular-nums text-slate-500">{p.share_pct.toFixed(1)}%</td>
                    <td className={`py-1.5 text-right tabular-nums ${resultColor(p.pnl)}`}>{p.pnl_pct === null ? "—" : signedPercent(p.pnl_pct)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-slate-400 flex-1">Add stocks, fixed deposits or other investments below and they are added up here.</p>
        )}
      </div>
      {leftOut.length > 0 && <p className="mt-4 text-xs text-amber-700">Not in the total yet: {leftOut.join(" and ")}.</p>}
    </div>
  );
}
