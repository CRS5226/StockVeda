import { useNavigate } from "react-router-dom";
import { useScreenerStore } from "../store/useScreenerStore";
import ScreenerFilters from "../components/ScreenerFilters";

export default function Screener() {
  const navigate = useNavigate();
  const { results, loading } = useScreenerStore();

  return (
    <div className="flex gap-4">
      <aside className="w-60 shrink-0 bg-white border border-slate-200 rounded-xl shadow-sm p-3 self-start">
        <ScreenerFilters />
      </aside>

      <div className="flex-1 bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-6 text-slate-400 text-sm flex items-center gap-2">
            <div className="w-4 h-4 border-2 border-slate-200 border-t-blue-500 rounded-full animate-spin" />
            Screening…
          </div>
        ) : results.length === 0 ? (
          <div className="p-8 text-slate-400 text-sm text-center">
            Set conditions on the left and click <strong className="text-slate-600">Run Screen</strong> to find matching stocks.
          </div>
        ) : (
          <>
            <div className="px-3 py-2 border-b border-slate-100 text-xs text-slate-400 font-medium">
              {results.length} result{results.length !== 1 ? "s" : ""}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-slate-400 border-b border-slate-100 bg-slate-50">
                    {["Symbol", "Close", "Volume", "P/E", "D/E", "Promoter%", "FII%", "Delivery%"].map((h) => (
                      <th key={h} className={`py-2 px-3 font-semibold ${h === "Symbol" ? "text-left" : "text-right"}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {results.map((r) => (
                    <tr key={r.symbol} onClick={() => navigate(`/stock/${r.symbol}`)}
                      className="border-b border-slate-50 hover:bg-blue-50/50 cursor-pointer transition-colors">
                      <td className="py-2 px-3 text-blue-600 font-semibold">{r.symbol}</td>
                      <td className="py-2 px-3 text-right text-slate-700">{r.close != null ? `₹${r.close.toLocaleString("en-IN", { maximumFractionDigits: 2 })}` : "—"}</td>
                      <td className="py-2 px-3 text-right text-slate-600">{r.volume?.toLocaleString("en-IN") ?? "—"}</td>
                      <td className="py-2 px-3 text-right text-slate-700">{r.pe_ratio != null ? r.pe_ratio.toFixed(1) : "—"}</td>
                      <td className="py-2 px-3 text-right text-slate-700">{r.debt_to_equity != null ? r.debt_to_equity.toFixed(2) : "—"}</td>
                      <td className="py-2 px-3 text-right text-slate-700">{r.promoter_pct != null ? `${r.promoter_pct.toFixed(1)}%` : "—"}</td>
                      <td className="py-2 px-3 text-right text-slate-700">{r.fii_pct != null ? `${r.fii_pct.toFixed(1)}%` : "—"}</td>
                      <td className="py-2 px-3 text-right text-slate-700">{r.delivery_pct != null ? `${r.delivery_pct.toFixed(1)}%` : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
