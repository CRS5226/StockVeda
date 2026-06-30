import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { GitBranch, Search, RefreshCw } from "lucide-react";
import { api } from "../lib/api";

type BulkDeal = { date: string; symbol: string; scrip_name: string; client_name: string; client_symbol: string | null; buy_sell: string; quantity: number; price: number };
type DateRange = { from: string; to: string } | null;

export default function Graph() {
  const navigate = useNavigate();
  const [deals, setDeals] = useState<BulkDeal[]>([]);
  const [dateRange, setDateRange] = useState<DateRange>(null);
  const [dealsLoading, setDealsLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [filter, setFilter] = useState("");

  const fmtQty = (n: number) => n >= 1e7 ? `${(n / 1e7).toFixed(2)}Cr` : n >= 1e5 ? `${(n / 1e5).toFixed(1)}L` : n.toLocaleString();

  const loadDeals = () => {
    setDealsLoading(true);
    api.getBulkDeals([], 30)
      .then(r => { setDeals(r.data); setDateRange(r.date_range); })
      .catch(() => { setDeals([]); setDateRange(null); })
      .finally(() => setDealsLoading(false));
  };

  useEffect(() => { loadDeals(); }, []);

  const handleSync = async () => {
    setSyncing(true);
    try { await api.syncBulkDeals(30); loadDeals(); }
    catch { /* ignore */ }
    finally { setSyncing(false); }
  };

  const filtered = useMemo(() => {
    if (!filter.trim()) return deals;
    const q = filter.trim().toUpperCase();
    return deals.filter(d => d.symbol.includes(q) || d.client_name.toUpperCase().includes(q));
  }, [deals, filter]);

  return (
    <div className="min-h-screen bg-slate-50 p-4 md:p-6">
      <div className="max-w-5xl mx-auto space-y-4">

        {/* Header */}
        <div className="flex items-center gap-3">
          <GitBranch size={20} className="text-blue-500" />
          <div>
            <h1 className="text-lg font-bold text-slate-800">Market Activity</h1>
            <p className="text-xs text-slate-500">NSE bulk deals — large institutional trades (&gt;0.5% of company equity)</p>
          </div>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 max-w-xs">
            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <input value={filter} onChange={e => setFilter(e.target.value.toUpperCase())}
              placeholder="Filter by symbol or institution…"
              className="w-full pl-7 pr-3 py-1.5 text-xs bg-white border border-slate-200 rounded-lg outline-none focus:ring-1 focus:ring-blue-400" />
          </div>
          <span className="text-[10px] text-slate-400">{filtered.length} of {deals.length} deals</span>
          {dateRange && (
            <span className="text-[10px] bg-slate-100 text-slate-500 px-2.5 py-1 rounded-full">
              {dateRange.from} → {dateRange.to}
            </span>
          )}
          <button onClick={handleSync} disabled={syncing}
            className={`ml-auto flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border transition-colors
              ${syncing ? "text-blue-400 border-blue-200 bg-blue-50 cursor-not-allowed"
                        : "text-slate-500 border-slate-200 bg-white hover:border-blue-300 hover:text-blue-600"}`}>
            <RefreshCw size={11} className={syncing ? "animate-spin" : ""} />
            {syncing ? "Syncing…" : "Sync from NSE"}
          </button>
        </div>

        {/* Table */}
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm">
          {dealsLoading ? (
            <div className="flex items-center justify-center py-20 text-xs text-slate-400 animate-pulse">Loading bulk deals…</div>
          ) : deals.length === 0 ? (
            <div className="py-16 text-center text-xs text-slate-400">
              No bulk deal data yet.{" "}
              <button onClick={handleSync} disabled={syncing} className="text-blue-500 underline">Sync from NSE</button>
              {" "}to fetch the last 30 days.
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-12 text-center text-xs text-slate-400">No deals match "{filter}"</div>
          ) : (
            <div className="max-h-[560px] overflow-y-auto rounded-xl">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-white z-10 border-b border-slate-100">
                  <tr className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">
                    <th className="text-left py-2.5 px-4">Date</th>
                    <th className="text-left py-2.5 px-4">Symbol</th>
                    <th className="text-left py-2.5 px-4">Institution / Client</th>
                    <th className="text-center py-2.5 px-4">Action</th>
                    <th className="text-right py-2.5 px-4">Qty</th>
                    <th className="text-right py-2.5 px-4">Avg Price</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((d, i) => (
                    <tr key={i} className="border-b border-slate-50 hover:bg-slate-50 transition-colors">
                      <td className="py-2.5 px-4 text-slate-500 whitespace-nowrap">{d.date}</td>
                      <td className="py-2.5 px-4">
                        <button onClick={() => navigate(`/stock/${d.symbol}`)}
                          className="text-blue-600 hover:underline font-semibold block leading-tight">{d.symbol}</button>
                        {d.scrip_name && (
                          <span className="text-[9px] text-slate-400 block truncate max-w-[130px]" title={d.scrip_name}>
                            {d.scrip_name}
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 px-4 max-w-[240px]">
                        <div className="text-slate-600 truncate" title={d.client_name}>{d.client_name}</div>
                        {d.client_symbol && (
                          <button onClick={() => navigate(`/stock/${d.client_symbol}`)}
                            className="text-[9px] text-blue-500 hover:underline font-semibold">
                            {d.client_symbol} ↗
                          </button>
                        )}
                      </td>
                      <td className="py-2.5 px-4 text-center">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold
                          ${d.buy_sell === "BUY" ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-600"}`}>
                          {d.buy_sell}
                        </span>
                      </td>
                      <td className="py-2.5 px-4 text-right text-slate-600">{fmtQty(d.quantity)}</td>
                      <td className="py-2.5 px-4 text-right text-slate-700 font-medium">₹{d.price.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <p className="text-[10px] text-slate-400">
          Bulk deals are single-session trades exceeding 0.5% of a company's total equity.
          They reveal when large institutions, FIIs, promoters, or funds accumulate or exit positions.
          Sync regularly to stay current — NSE publishes data with a 1-day lag.
        </p>

      </div>
    </div>
  );
}
