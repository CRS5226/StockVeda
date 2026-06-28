import { useState, useEffect, useRef, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { GitBranch, X, Plus, Search, RefreshCw } from "lucide-react";
import { api, type CorrelationMatrix, type CommonHolderPair } from "../lib/api";

type BulkDeal = { date: string; symbol: string; scrip_name: string; client_name: string; buy_sell: string; quantity: number; price: number };

const DEFAULT_SYMBOLS = ["RELIANCE", "HDFCBANK", "INFY", "TCS", "ICICIBANK", "SBIN"];
const PERIOD_DAYS: Record<string, number> = { "1M": 30, "3M": 90, "6M": 182, "1Y": 365 };

// ── Color helpers ────────────────────────────────────────────────────────────
function corrColor(val: number | null): string {
  if (val === null) return "#f1f5f9";
  const v = Math.max(-1, Math.min(1, val));
  if (v >= 0) {
    const t = v;
    return `rgb(${Math.round(241 + t * (5 - 241))},${Math.round(245 + t * (150 - 245))},${Math.round(249 + t * (105 - 249))})`;
  }
  const t = 1 + v;
  return `rgb(${Math.round(220 + t * (241 - 220))},${Math.round(38 + t * (245 - 38))},${Math.round(38 + t * (249 - 38))})`;
}

function corrLabel(val: number | null): string {
  if (val === null) return "—";
  if (Math.abs(val) >= 0.7) return "Strong";
  if (Math.abs(val) >= 0.4) return "Moderate";
  return "Weak";
}

// ── Symbol picker ────────────────────────────────────────────────────────────
function SymbolPicker({ onAdd, existing }: { onAdd: (sym: string) => void; existing: string[] }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<{ symbol: string; name: string }[]>([]);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (q.length < 1) { setResults([]); return; }
    const t = setTimeout(() => {
      api.searchSymbols(q).then(r => setResults(r.filter(s => !existing.includes(s.symbol)).slice(0, 8))).catch(() => {});
    }, 200);
    return () => clearTimeout(t);
  }, [q, existing]);

  useEffect(() => {
    const fn = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", fn);
    return () => document.removeEventListener("mousedown", fn);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <div className="flex items-center gap-1 border border-dashed border-slate-300 rounded-lg px-2 py-1 text-xs text-slate-400 hover:border-blue-400 hover:text-blue-500 cursor-text"
        onClick={() => { setOpen(true); }}>
        <Plus size={11} />
        <input autoFocus={open} value={q} onChange={e => { setQ(e.target.value); setOpen(true); }}
          placeholder="Add symbol…" className="outline-none bg-transparent w-24 placeholder:text-slate-400" />
        <Search size={10} />
      </div>
      {open && results.length > 0 && (
        <div className="absolute top-full left-0 mt-1 z-50 bg-white border border-slate-200 rounded-lg shadow-lg min-w-[180px] overflow-hidden">
          {results.map(r => (
            <button key={r.symbol} onMouseDown={() => { onAdd(r.symbol); setQ(""); setResults([]); setOpen(false); }}
              className="w-full text-left px-3 py-1.5 hover:bg-blue-50 text-xs">
              <span className="font-semibold text-slate-700">{r.symbol}</span>
              <span className="text-slate-400 ml-1 truncate">{r.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Heatmap ──────────────────────────────────────────────────────────────────
function Heatmap({ matrix }: { matrix: CorrelationMatrix }) {
  const { symbols, matrix: m } = matrix;
  if (!symbols.length) return null;

  return (
    <div className="overflow-x-auto">
      <div className="inline-grid gap-px bg-slate-100 rounded-lg overflow-hidden"
        style={{ gridTemplateColumns: `80px repeat(${symbols.length}, minmax(60px, 1fr))` }}>
        {/* Header row */}
        <div className="bg-white" />
        {symbols.map(s => (
          <div key={s} className="bg-white px-1 py-2 text-center text-[10px] font-bold text-slate-600 truncate">{s}</div>
        ))}
        {/* Data rows */}
        {symbols.map((rowSym, ri) => (
          <div key={rowSym} className="contents">
            <div className="bg-white flex items-center px-2 py-3 text-[10px] font-bold text-slate-600">{rowSym}</div>
            {symbols.map((colSym, ci) => {
              const val = m[ri]?.[ci] ?? null;
              const isDiag = ri === ci;
              const bg = isDiag ? "#059669" : corrColor(val);
              const textColor = (isDiag || (val !== null && Math.abs(val) > 0.5)) ? "white" : "#334155";
              return (
                <div key={colSym} title={`${rowSym} × ${colSym}: ${val?.toFixed(4) ?? "—"}`}
                  className="flex flex-col items-center justify-center py-3 px-1 transition-opacity hover:opacity-90"
                  style={{ background: bg, color: textColor }}>
                  <span className="text-[11px] font-bold">{val != null ? val.toFixed(2) : "—"}</span>
                  {!isDiag && val != null && (
                    <span className="text-[8px] opacity-75">{corrLabel(val)}</span>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
      {/* Legend */}
      <div className="flex items-center gap-3 mt-3 text-[9px] text-slate-500">
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded" style={{ background: corrColor(1) }} />
          <span>+1.0 (move together)</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded" style={{ background: corrColor(0) }} />
          <span>0.0 (unrelated)</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded" style={{ background: corrColor(-1) }} />
          <span>–1.0 (move opposite)</span>
        </div>
      </div>
    </div>
  );
}

// ── Pairs table for correlation ───────────────────────────────────────────────
function PairsTable({ matrix }: { matrix: CorrelationMatrix }) {
  const navigate = useNavigate();
  const pairs = useMemo(() => {
    const { symbols: syms, matrix: m } = matrix;
    const result: { s1: string; s2: string; val: number }[] = [];
    for (let i = 0; i < syms.length; i++) {
      for (let j = i + 1; j < syms.length; j++) {
        const v = m[i]?.[j];
        if (v != null) result.push({ s1: syms[i], s2: syms[j], val: v });
      }
    }
    return result.sort((a, b) => Math.abs(b.val) - Math.abs(a.val));
  }, [matrix]);

  if (!pairs.length) return <div className="text-xs text-slate-400 py-8 text-center">No data</div>;

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-[10px] font-bold text-slate-400 uppercase tracking-wide border-b border-slate-100">
          <th className="text-left py-2 px-3">Stock A</th>
          <th className="text-left py-2 px-3">Stock B</th>
          <th className="text-right py-2 px-3">Correlation</th>
          <th className="py-2 px-3 w-32">Strength</th>
        </tr>
      </thead>
      <tbody>
        {pairs.map(({ s1, s2, val }) => (
          <tr key={`${s1}-${s2}`} className="border-b border-slate-50 hover:bg-slate-50">
            <td className="py-2 px-3">
              <button onClick={() => navigate(`/stock/${s1}`)} className="text-blue-600 hover:underline font-medium text-xs">{s1}</button>
            </td>
            <td className="py-2 px-3">
              <button onClick={() => navigate(`/stock/${s2}`)} className="text-blue-600 hover:underline font-medium text-xs">{s2}</button>
            </td>
            <td className={`py-2 px-3 text-right font-bold text-xs ${val >= 0 ? "text-emerald-600" : "text-red-500"}`}>
              {val >= 0 ? "+" : ""}{val.toFixed(4)}
            </td>
            <td className="py-2 px-3">
              <div className="relative h-1.5 rounded-full bg-slate-100 overflow-hidden">
                <div className="absolute inset-y-0 rounded-full transition-all"
                  style={{ width: `${Math.abs(val) * 100}%`, background: val >= 0 ? "#10b981" : "#ef4444", left: val >= 0 ? 0 : undefined, right: val < 0 ? 0 : undefined }} />
              </div>
              <div className="text-[8px] text-slate-400 mt-0.5 text-center">{corrLabel(val)}</div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ── Ownership pairs table ────────────────────────────────────────────────────
function OwnershipTable({ pairs }: { pairs: CommonHolderPair[] }) {
  const navigate = useNavigate();
  if (!pairs.length) return (
    <div className="text-xs text-slate-400 py-8 text-center">
      No shareholding data available for these stocks.<br />Sync shareholding data first.
    </div>
  );
  return (
    <div className="space-y-3">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-[10px] font-bold text-slate-400 uppercase tracking-wide border-b border-slate-100">
            <th className="text-left py-2 px-3">Stock A</th>
            <th className="text-left py-2 px-3">Stock B</th>
            <th className="text-right py-2 px-3">FII overlap</th>
            <th className="text-right py-2 px-3">MF overlap</th>
            <th className="py-2 px-3 w-28">Shared interest</th>
          </tr>
        </thead>
        <tbody>
          {pairs.map(p => (
            <tr key={`${p.symbol1}-${p.symbol2}`} className="border-b border-slate-50 hover:bg-slate-50">
              <td className="py-2 px-3">
                <button onClick={() => navigate(`/stock/${p.symbol1}`)} className="text-blue-600 hover:underline font-medium text-xs">{p.symbol1}</button>
              </td>
              <td className="py-2 px-3">
                <button onClick={() => navigate(`/stock/${p.symbol2}`)} className="text-blue-600 hover:underline font-medium text-xs">{p.symbol2}</button>
              </td>
              <td className="py-2 px-3 text-right text-xs text-slate-600">{p.fii_overlap.toFixed(1)}%</td>
              <td className="py-2 px-3 text-right text-xs text-slate-600">{p.mf_overlap.toFixed(1)}%</td>
              <td className="py-2 px-3">
                <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
                  <div className="h-full rounded-full bg-blue-400"
                    style={{ width: `${Math.min(100, p.overlap_score * 2)}%` }} />
                </div>
                <div className="text-[8px] text-slate-400 mt-0.5 text-center">{p.overlap_score.toFixed(1)}</div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 text-[10px] text-blue-700">
        <strong>Overlap score</strong> = average of common FII % + common MF % held in both stocks.
        High score means institutions tend to buy or sell these stocks together — a real behavioural link.
      </div>
    </div>
  );
}

// ── Bulk Deals table ─────────────────────────────────────────────────────────
function BulkDealsTable({ deals, syncing, onSync }: { deals: BulkDeal[]; syncing: boolean; onSync: () => void }) {
  const navigate = useNavigate();
  const fmtQty = (n: number) => n >= 1e7 ? `${(n/1e7).toFixed(2)}Cr` : n >= 1e5 ? `${(n/1e5).toFixed(1)}L` : n.toLocaleString();
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-[10px] text-slate-400">
          NSE bulk deals (&gt;0.5% of company equity) — who is buying/selling large blocks
        </p>
        <button onClick={onSync} disabled={syncing}
          className={`flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-lg border transition-colors
            ${syncing ? "text-blue-400 border-blue-200 bg-blue-50 cursor-not-allowed"
                      : "text-slate-500 border-slate-200 bg-white hover:border-blue-300 hover:text-blue-600"}`}>
          <RefreshCw size={11} className={syncing ? "animate-spin" : ""} />
          {syncing ? "Syncing…" : "Sync from NSE"}
        </button>
      </div>

      {deals.length === 0 ? (
        <div className="py-12 text-center text-xs text-slate-400">
          No bulk deal data yet.{" "}
          <button onClick={onSync} disabled={syncing} className="text-blue-500 underline">
            Click "Sync from NSE"
          </button>{" "}
          to fetch the last 30 days.
        </div>
      ) : (
        <table className="w-full text-xs">
          <thead>
            <tr className="text-[10px] font-bold text-slate-400 uppercase tracking-wide border-b border-slate-100">
              <th className="text-left py-2 px-3">Date</th>
              <th className="text-left py-2 px-3">Symbol</th>
              <th className="text-left py-2 px-3">Institution / Client</th>
              <th className="text-center py-2 px-3">Action</th>
              <th className="text-right py-2 px-3">Qty</th>
              <th className="text-right py-2 px-3">Avg Price</th>
            </tr>
          </thead>
          <tbody>
            {deals.map((d, i) => (
              <tr key={i} className="border-b border-slate-50 hover:bg-slate-50">
                <td className="py-2 px-3 text-slate-500 whitespace-nowrap">{d.date}</td>
                <td className="py-2 px-3">
                  <button onClick={() => navigate(`/stock/${d.symbol}`)}
                    className="text-blue-600 hover:underline font-semibold">{d.symbol}</button>
                </td>
                <td className="py-2 px-3 text-slate-600 max-w-[220px] truncate" title={d.client_name}>{d.client_name}</td>
                <td className="py-2 px-3 text-center">
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold
                    ${d.buy_sell === "BUY" ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-600"}`}>
                    {d.buy_sell}
                  </span>
                </td>
                <td className="py-2 px-3 text-right text-slate-600">{fmtQty(d.quantity)}</td>
                <td className="py-2 px-3 text-right text-slate-700 font-medium">₹{d.price.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────
export default function Graph() {
  const [symbols, setSymbols] = useState<string[]>(DEFAULT_SYMBOLS);
  const [graphTab, setGraphTab] = useState<"correlation" | "ownership" | "deals">("correlation");
  const [period, setPeriod] = useState("3M");
  const [view, setView] = useState<"heatmap" | "table">("heatmap");
  const [matrix, setMatrix] = useState<CorrelationMatrix | null>(null);
  const [holders, setHolders] = useState<CommonHolderPair[]>([]);
  const [deals, setDeals] = useState<BulkDeal[]>([]);
  const [loading, setLoading] = useState(false);
  const [holdersLoading, setHoldersLoading] = useState(false);
  const [dealsLoading, setDealsLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);

  // Fetch correlation matrix
  useEffect(() => {
    if (symbols.length < 2) { setMatrix(null); return; }
    setLoading(true);
    api.getCorrelationMatrix(symbols, PERIOD_DAYS[period])
      .then(setMatrix).catch(() => setMatrix(null)).finally(() => setLoading(false));
  }, [symbols, period]);

  // Fetch ownership overlap
  useEffect(() => {
    if (symbols.length < 2) { setHolders([]); return; }
    setHoldersLoading(true);
    api.getCommonHolders(symbols)
      .then(setHolders).catch(() => setHolders([])).finally(() => setHoldersLoading(false));
  }, [symbols]);

  // Fetch bulk deals for selected symbols
  useEffect(() => {
    setDealsLoading(true);
    api.getBulkDeals(symbols, 30)
      .then(setDeals).catch(() => setDeals([])).finally(() => setDealsLoading(false));
  }, [symbols]);

  const handleSyncDeals = async () => {
    setSyncing(true);
    try {
      await api.syncBulkDeals(30);
      const fresh = await api.getBulkDeals(symbols, 30);
      setDeals(fresh);
    } catch { /* ignore */ }
    finally { setSyncing(false); }
  };

  const removeSymbol = (s: string) => setSymbols(prev => prev.filter(x => x !== s));
  const addSymbol    = (s: string) => {
    if (symbols.length >= 12 || symbols.includes(s)) return;
    setSymbols(prev => [...prev, s]);
  };

  return (
    <div className="min-h-screen bg-slate-50 p-4 md:p-6">
      <div className="max-w-5xl mx-auto space-y-4">

        {/* Header */}
        <div className="flex items-center gap-3">
          <GitBranch size={20} className="text-blue-500" />
          <div>
            <h1 className="text-lg font-bold text-slate-800">Stock Relationships</h1>
            <p className="text-xs text-slate-500">Discover which stocks move together or share institutional ownership</p>
          </div>
        </div>

        {/* Symbol chips + picker */}
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-4">
          <div className="flex flex-wrap gap-2 items-center">
            {symbols.map(s => (
              <div key={s} className="flex items-center gap-1 bg-slate-100 text-slate-700 rounded-lg px-2.5 py-1 text-xs font-semibold">
                {s}
                <button onClick={() => removeSymbol(s)} className="text-slate-400 hover:text-red-500 ml-0.5">
                  <X size={10} />
                </button>
              </div>
            ))}
            {symbols.length < 12 && <SymbolPicker onAdd={addSymbol} existing={symbols} />}
            {symbols.length >= 12 && <span className="text-[10px] text-slate-400">Max 12 stocks</span>}
          </div>
        </div>

        {/* Tab + Period + View controls */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Tab */}
          <div className="flex gap-1 bg-white border border-slate-200 rounded-lg p-1">
            {([["correlation", "Price Correlation"], ["ownership", "Institutional Ownership"], ["deals", "Bulk Deals"]] as const).map(([t, label]) => (
              <button key={t} onClick={() => setGraphTab(t)}
                className={`px-3 py-1 text-xs font-medium rounded transition-colors
                  ${graphTab === t ? "bg-blue-600 text-white" : "text-slate-500 hover:text-slate-700"}`}>
                {label}
              </button>
            ))}
          </div>

          {/* Period (correlation only) */}
          {graphTab === "correlation" && (
            <div className="flex gap-1">
              {Object.keys(PERIOD_DAYS).map(p => (
                <button key={p} onClick={() => setPeriod(p)}
                  className={`px-2.5 py-1 text-xs rounded transition-colors
                    ${period === p ? "bg-slate-700 text-white" : "bg-white border border-slate-200 text-slate-500 hover:border-slate-400"}`}>
                  {p}
                </button>
              ))}
            </div>
          )}

          {/* View toggle (correlation only) */}
          {graphTab === "correlation" && (
            <div className="flex gap-1 ml-auto bg-white border border-slate-200 rounded-lg p-1">
              {(["heatmap", "table"] as const).map(v => (
                <button key={v} onClick={() => setView(v)}
                  className={`px-2.5 py-1 text-xs rounded capitalize transition-colors
                    ${view === v ? "bg-slate-100 text-slate-700 font-medium" : "text-slate-400 hover:text-slate-600"}`}>
                  {v}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Content area */}
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-4 min-h-64">
          {graphTab === "correlation" && (
            <>
              {loading && (
                <div className="flex items-center justify-center py-16">
                  <div className="text-xs text-slate-400 animate-pulse">Computing correlations…</div>
                </div>
              )}
              {!loading && matrix && (
                view === "heatmap"
                  ? <Heatmap matrix={matrix} />
                  : <PairsTable matrix={matrix} />
              )}
              {!loading && !matrix && symbols.length >= 2 && (
                <div className="text-xs text-slate-400 py-8 text-center">No data available for selected period</div>
              )}
            </>
          )}

          {graphTab === "ownership" && (
            <>
              {holdersLoading && (
                <div className="flex items-center justify-center py-16">
                  <div className="text-xs text-slate-400 animate-pulse">Loading ownership data…</div>
                </div>
              )}
              {!holdersLoading && <OwnershipTable pairs={holders} />}
            </>
          )}

          {graphTab === "deals" && (
            <>
              {dealsLoading && (
                <div className="flex items-center justify-center py-16">
                  <div className="text-xs text-slate-400 animate-pulse">Loading bulk deals…</div>
                </div>
              )}
              {!dealsLoading && (
                <BulkDealsTable deals={deals} syncing={syncing} onSync={handleSyncDeals} />
              )}
            </>
          )}
        </div>

        {/* Explainer */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-[10px] text-slate-500">
          <div className="bg-white border border-slate-100 rounded-lg p-3">
            <div className="font-semibold text-slate-600 mb-1">Price Correlation</div>
            Based on Pearson correlation of daily returns. +1.0 = stocks move perfectly together.
            –1.0 = they move in opposite directions. 0 = no relationship.
            Useful for portfolio diversification — low correlation = less risk concentration.
          </div>
          <div className="bg-white border border-slate-100 rounded-lg p-3">
            <div className="font-semibold text-slate-600 mb-1">Institutional Ownership</div>
            Compares what % FII and mutual funds hold in common across stocks.
            When institutions heavily own two stocks, they tend to sell both together in risk-off events.
            High overlap = correlated sell-offs even if price patterns look different.
          </div>
          <div className="bg-white border border-slate-100 rounded-lg p-3">
            <div className="font-semibold text-slate-600 mb-1">Bulk Deals</div>
            NSE bulk deals are trades &gt;0.5% of a company's equity in a single session.
            These reveal when large institutions, FIIs, or insiders are accumulating or exiting.
            Data sourced live from NSE — sync to get the latest 30 days.
          </div>
        </div>

      </div>
    </div>
  );
}
