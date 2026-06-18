import { useNavigate } from "react-router-dom";
import { useScreenerStore } from "../store/useScreenerStore";
import ScreenerFilters from "../components/ScreenerFilters";

export default function Screener() {
  const navigate = useNavigate();
  const { results, loading } = useScreenerStore();

  return (
    <div className="flex gap-4">
      {/* Sidebar */}
      <aside className="w-60 shrink-0 bg-gray-900 border border-gray-800 rounded p-3 self-start">
        <ScreenerFilters />
      </aside>

      {/* Results */}
      <div className="flex-1 bg-gray-900 border border-gray-800 rounded overflow-hidden">
        {loading ? (
          <div className="p-6 text-gray-500 text-sm">Screening…</div>
        ) : results.length === 0 ? (
          <div className="p-6 text-gray-500 text-sm">
            Set conditions on the left and click{" "}
            <strong className="text-gray-300">Run Screen</strong> to find matching stocks.
          </div>
        ) : (
          <>
            <div className="px-3 py-2 border-b border-gray-800 text-xs text-gray-500">
              {results.length} result{results.length !== 1 ? "s" : ""}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-gray-300">
                <thead>
                  <tr className="text-gray-500 border-b border-gray-800 bg-gray-900/80">
                    {["Symbol", "Close", "Volume", "P/E", "D/E", "Promoter%", "FII%", "Delivery%"].map((h) => (
                      <th key={h} className={`py-2 px-3 font-medium ${h === "Symbol" ? "text-left" : "text-right"}`}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {results.map((r) => (
                    <tr
                      key={r.symbol}
                      onClick={() => navigate(`/stock/${r.symbol}`)}
                      className="border-b border-gray-800/40 hover:bg-gray-800/30 cursor-pointer"
                    >
                      <td className="py-2 px-3 text-blue-400 font-medium">{r.symbol}</td>
                      <td className="py-2 px-3 text-right">
                        {r.close != null ? `₹${r.close.toLocaleString("en-IN", { maximumFractionDigits: 2 })}` : "—"}
                      </td>
                      <td className="py-2 px-3 text-right">{r.volume?.toLocaleString("en-IN") ?? "—"}</td>
                      <td className="py-2 px-3 text-right">{r.pe_ratio != null ? r.pe_ratio.toFixed(1) : "—"}</td>
                      <td className="py-2 px-3 text-right">{r.debt_to_equity != null ? r.debt_to_equity.toFixed(2) : "—"}</td>
                      <td className="py-2 px-3 text-right">{r.promoter_pct != null ? `${r.promoter_pct.toFixed(1)}%` : "—"}</td>
                      <td className="py-2 px-3 text-right">{r.fii_pct != null ? `${r.fii_pct.toFixed(1)}%` : "—"}</td>
                      <td className="py-2 px-3 text-right">{r.delivery_pct != null ? `${r.delivery_pct.toFixed(1)}%` : "—"}</td>
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
