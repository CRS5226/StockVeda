import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  TrendingUp, BarChart2, Users, Building2,
  ArrowUpRight, ArrowDownRight, SlidersHorizontal, FlaskConical,
  ChevronRight, Calendar, Layers, RefreshCw, Info, CheckCircle, AlertCircle, Loader2,
} from "lucide-react";
import { useStockStore } from "../store/useStockStore";
import { useBacktestStore } from "../store/useBacktestStore";
import { api } from "../lib/api";
import CandleChart from "../components/CandleChart";
import BacktestResults from "../components/BacktestResults";
import MacroLineChart from "../components/MacroLineChart";

type Range = "1M" | "3M" | "6M" | "1Y" | "3Y" | "MAX";
type Tab = "fundamentals" | "delivery" | "shareholding" | "corp" | "fno" | "backtest";

const RANGES: Range[] = ["1M", "3M", "6M", "1Y", "3Y", "MAX"];
const SYNC_SOURCES = ["bhavcopy", "fundamentals", "delivery", "shareholding", "corporate_actions", "fno_bhavcopy"];

function fromDate(r: Range) {
  if (r === "MAX") return undefined;
  const d = new Date();
  const months = { "1M": 1, "3M": 3, "6M": 6, "1Y": 12, "3Y": 36 }[r];
  d.setMonth(d.getMonth() - months);
  return d.toISOString().slice(0, 10);
}
function fmt(n?: number | null, dec = 2) {
  if (n == null) return "—";
  return n.toLocaleString("en-IN", { maximumFractionDigits: dec });
}
function fmtCr(n?: number | null) {
  if (n == null) return "—";
  return `₹${(n / 1e7).toLocaleString("en-IN", { maximumFractionDigits: 0 })} Cr`;
}

function MetricCard({ label, value, icon: Icon, up }: {
  label: string; value: string; icon?: React.ElementType; up?: boolean;
}) {
  return (
    <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
      <div className="flex items-center gap-1 text-xs text-slate-500 mb-1">
        {Icon && <Icon size={11} />}{label}
      </div>
      <div className={`text-sm font-bold ${up === true ? "text-emerald-600" : up === false ? "text-red-500" : "text-slate-800"}`}>
        {value}
      </div>
    </div>
  );
}

const TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
  { id: "fundamentals", label: "Fundamentals", icon: BarChart2 },
  { id: "delivery", label: "Delivery", icon: TrendingUp },
  { id: "shareholding", label: "Shareholding", icon: Users },
  { id: "corp", label: "Corp Actions", icon: Building2 },
  { id: "fno", label: "F&O", icon: Layers },
  { id: "backtest", label: "Backtest", icon: FlaskConical },
];

export default function StockDetail() {
  const { symbol = "" } = useParams<{ symbol: string }>();
  const sym = symbol.toUpperCase();
  const navigate = useNavigate();

  const { candles, fundamentals, delivery, shareholding, corporateActions, insiderTrades, fno, loading,
    fetchCandles, fetchFundamentals, fetchDelivery, fetchShareholding, fetchCorporateActions, fetchFno } = useStockStore();
  const { params, results: btResults, loading: btLoading, error: btError,
    strategies, setParams, applyStrategy, runBacktest, loadStrategies } = useBacktestStore();

  const [range, setRange] = useState<Range>("1Y");
  const [tab, setTab] = useState<Tab>("fundamentals");
  const [fundPeriod, setFundPeriod] = useState<"Q" | "A">("Q");
  const [stockInfo, setStockInfo] = useState<{ company_name: string | null; isin: string | null } | null>(null);
  const [syncing, setSyncing] = useState<string | null>(null);
  const [syncMsg, setSyncMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [prefetching, setPrefetching] = useState(false);

  useEffect(() => { fetchCandles(sym, fromDate(range), true); }, [sym, range]);

  useEffect(() => {
    if (tab === "fundamentals") fetchFundamentals(sym, fundPeriod);
    if (tab === "delivery") fetchDelivery(sym, fromDate("1Y"));
    if (tab === "shareholding") fetchShareholding(sym);
    if (tab === "corp") fetchCorporateActions(sym);
    if (tab === "fno") fetchFno(sym);
  }, [tab, sym, fundPeriod]);

  useEffect(() => {
    loadStrategies(); setParams({ symbol: sym });
    api.getStockInfo(sym).then((info) => setStockInfo(info)).catch(() => {});

    // Auto-fetch all missing yfinance data for this symbol on page load
    setPrefetching(true);
    api.prefetchSymbol(sym)
      .then(() => {
        fetchFundamentals(sym, "Q");
        fetchShareholding(sym);
        fetchCorporateActions(sym);
      })
      .catch(() => {})
      .finally(() => setPrefetching(false));
  }, [sym]);

  const triggerSync = async (source: string) => {
    setSyncing(source); setSyncMsg(null);
    try {
      await api.triggerSync(source);
      setSyncMsg({ text: `${source} sync queued — data will refresh in ~30s`, ok: true });
      setTimeout(() => {
        fetchCandles(sym, fromDate(range), true);
        fetchFundamentals(sym, fundPeriod);
      }, 8000);
    } catch {
      setSyncMsg({ text: `Failed to trigger ${source} sync`, ok: false });
    }
    setSyncing(null);
  };

  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  const change = last && prev ? last.close - prev.close : 0;
  const changePct = prev?.close ? (change / prev.close) * 100 : 0;
  const up = change >= 0;
  const latestFund = fundamentals[0];
  const latestShare = shareholding[0];
  const high52 = candles.length > 0 ? Math.max(...candles.map(c => c.high)) : null;
  const low52 = candles.length > 0 ? Math.min(...candles.map(c => c.low)) : null;

  return (
    <div className="flex flex-col gap-4">
      {/* Breadcrumb */}
      <div className="flex items-center gap-1 text-xs text-slate-400">
        <button onClick={() => navigate("/")} className="hover:text-blue-500 transition-colors">Dashboard</button>
        <ChevronRight size={12} />
        <span className="text-slate-600 font-medium">{sym}</span>
        {stockInfo?.company_name && <span className="text-slate-400">— {stockInfo.company_name}</span>}
      </div>

      {/* 50/50 grid */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">

        {/* LEFT */}
        <div className="flex flex-col gap-4">

          {/* Stock info card */}
          <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-4">
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-2xl font-bold text-slate-800">{sym}</span>
                  {stockInfo?.isin && (
                    <span className="text-xs bg-slate-100 text-slate-500 px-2 py-0.5 rounded font-mono">{stockInfo.isin}</span>
                  )}
                </div>
                {stockInfo?.company_name && (
                  <div className="text-sm text-slate-500 mb-2">{stockInfo.company_name}</div>
                )}
                {last && (
                  <div className="flex items-baseline gap-2">
                    <span className="text-3xl font-bold text-slate-900">₹{fmt(last.close)}</span>
                    <span className={`flex items-center gap-0.5 text-sm font-semibold ${up ? "text-emerald-600" : "text-red-500"}`}>
                      {up ? <ArrowUpRight size={15} /> : <ArrowDownRight size={15} />}
                      {up ? "+" : ""}{fmt(change)} ({up ? "+" : ""}{changePct.toFixed(2)}%)
                    </span>
                  </div>
                )}
              </div>
              {loading.candles && (
                <div className="w-5 h-5 border-2 border-slate-200 border-t-blue-500 rounded-full animate-spin mt-1" />
              )}
            </div>

            {last && (
              <>
                <div className="grid grid-cols-3 gap-3 text-xs mt-3 pt-3 border-t border-slate-100">
                  {[["Open", `₹${fmt(last.open)}`], ["High", `₹${fmt(last.high)}`], ["Low", `₹${fmt(last.low)}`],
                    ["Volume", last.volume?.toLocaleString("en-IN") ?? "—"],
                    ["52W High", high52 ? `₹${fmt(high52)}` : "—"],
                    ["52W Low",  low52  ? `₹${fmt(low52)}`  : "—"],
                  ].map(([l, v]) => (
                    <div key={l}>
                      <span className="block text-slate-400 mb-0.5">{l}</span>
                      <span className="font-medium text-slate-700">{v}</span>
                    </div>
                  ))}
                </div>
                <div className="flex items-center gap-1.5 mt-2.5 pt-2 border-t border-slate-100">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
                  <span className="text-xs text-slate-400">NSE EOD · data as of {last.date}</span>
                </div>
              </>
            )}
          </div>

          {/* Sync panel */}
          <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <RefreshCw size={14} className="text-blue-500" />
                <span className="text-sm font-semibold text-slate-700">Sync Data for {sym}</span>
              </div>
              {prefetching && (
                <div className="flex items-center gap-1.5 text-xs text-blue-500">
                  <Loader2 size={12} className="animate-spin" />
                  Fetching fresh data…
                </div>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {SYNC_SOURCES.map((src) => (
                <button key={src} onClick={() => triggerSync(src)}
                  disabled={syncing === src || prefetching}
                  className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-slate-200 bg-slate-50 hover:bg-blue-50 hover:border-blue-300 hover:text-blue-600 text-slate-600 transition-all disabled:opacity-50">
                  {syncing === src
                    ? <div className="w-3 h-3 border border-slate-300 border-t-blue-500 rounded-full animate-spin" />
                    : <RefreshCw size={11} />}
                  {src.replace("_", " ")}
                </button>
              ))}
            </div>
            {syncMsg && (
              <div className={`flex items-center gap-2 mt-2 text-xs ${syncMsg.ok ? "text-emerald-600" : "text-red-500"}`}>
                {syncMsg.ok ? <CheckCircle size={12} /> : <AlertCircle size={12} />}
                {syncMsg.text}
              </div>
            )}
          </div>

          {/* Key metrics */}
          <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-4">
            <div className="flex items-center gap-2 mb-3">
              <Info size={14} className="text-blue-500" />
              <span className="text-sm font-semibold text-slate-700">Key Metrics</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              <MetricCard label="Revenue (TTM)" value={fmtCr(latestFund?.revenue)} icon={BarChart2} />
              <MetricCard label="PAT" value={fmtCr(latestFund?.pat)} icon={TrendingUp}
                up={latestFund?.pat != null ? latestFund.pat >= 0 : undefined} />
              <MetricCard label="EPS" value={latestFund?.eps_basic != null ? `₹${fmt(latestFund.eps_basic)}` : "—"} />
              <MetricCard label="Total Debt" value={fmtCr(latestFund?.total_debt)} icon={Building2} />
              <MetricCard label="Equity" value={fmtCr(latestFund?.total_equity)} />
              <MetricCard label="Cash" value={fmtCr(latestFund?.cash)} />
              <MetricCard label="Promoter %" icon={Users}
                value={latestShare?.promoter_pct != null ? `${fmt(latestShare.promoter_pct)}%` : "—"}
                up={latestShare?.promoter_pct != null ? latestShare.promoter_pct > 50 : undefined} />
              <MetricCard label="FII %" icon={Users}
                value={latestShare?.fii_pct != null ? `${fmt(latestShare.fii_pct)}%` : "—"} />
              <MetricCard label="DII %" icon={Users}
                value={latestShare?.dii_pct != null ? `${fmt(latestShare.dii_pct)}%` : "—"} />
            </div>
          </div>

          {/* Tabs */}
          <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
            <div className="flex overflow-x-auto border-b border-slate-100">
              {TABS.map(({ id, label, icon: Icon }) => (
                <button key={id} onClick={() => setTab(id)}
                  className={`flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium whitespace-nowrap border-b-2 transition-colors ${
                    tab === id ? "border-blue-500 text-blue-600 bg-blue-50/50" : "border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-50"
                  }`}>
                  <Icon size={12} />{label}
                </button>
              ))}
            </div>

            <div className="p-3 min-h-[200px]">
              {tab === "fundamentals" && (
                <div>
                  <div className="flex gap-2 mb-3">
                    {(["Q", "A"] as const).map((p) => (
                      <button key={p} onClick={() => { setFundPeriod(p); fetchFundamentals(sym, p); }}
                        className={`text-xs px-2 py-1 rounded-md ${fundPeriod === p ? "bg-blue-500 text-white" : "bg-slate-100 text-slate-500 hover:bg-slate-200"}`}>
                        {p === "Q" ? "Quarterly" : "Annual"}
                      </button>
                    ))}
                  </div>
                  {loading.fundamentals ? (
                    <div className="flex justify-center py-8"><div className="w-5 h-5 border-2 border-slate-200 border-t-blue-500 rounded-full animate-spin" /></div>
                  ) : fundamentals.length === 0 ? (
                    <div className="text-xs text-slate-400 py-6 text-center">No data — use the Sync panel above to fetch fundamentals.</div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead><tr className="text-slate-400 border-b border-slate-100">
                          <th className="text-left py-1.5 px-2">Metric</th>
                          {fundamentals.slice(0, 6).map((f) => <th key={f.period} className="text-right py-1.5 px-2 font-medium">{f.period.slice(0, 7)}</th>)}
                        </tr></thead>
                        <tbody>
                          {([ ["Revenue", "revenue", fmtCr], ["EBITDA", "ebitda", fmtCr], ["PAT", "pat", fmtCr],
                            ["EPS", "eps_basic", (v: number | null | undefined) => v != null ? `₹${fmt(v)}` : "—"],
                            ["Debt", "total_debt", fmtCr], ["Cash", "cash", fmtCr],
                          ] as [string, string, (v: number | null | undefined) => string][]).map(([label, key, fn]) => (
                            <tr key={key} className="border-b border-slate-50 hover:bg-slate-50">
                              <td className="py-1.5 px-2 text-slate-500">{label}</td>
                              {fundamentals.slice(0, 6).map((f) => (
                                <td key={f.period} className="py-1.5 px-2 text-right text-slate-700">
                                  {fn(f[key as keyof typeof f] as number | null | undefined)}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {tab === "delivery" && (
                delivery.length === 0
                  ? <div className="text-xs text-slate-400 py-6 text-center">No delivery data — sync bhavcopy first.</div>
                  : <MacroLineChart title="Delivery %" height={160}
                      series={[{ label: "Delivery %", color: "#10b981", data: delivery.map((d) => ({ date: d.date, value: d.delivery_pct })) }]} />
              )}

              {tab === "shareholding" && (
                shareholding.length === 0
                  ? <div className="text-xs text-slate-400 py-6 text-center">No shareholding data.</div>
                  : <MacroLineChart title="Shareholding %" height={160}
                      series={[
                        { label: "Promoter", color: "#3b82f6", data: shareholding.map((s) => ({ date: s.period, value: s.promoter_pct ?? 0 })) },
                        { label: "FII", color: "#f59e0b", data: shareholding.map((s) => ({ date: s.period, value: s.fii_pct ?? 0 })) },
                        { label: "DII", color: "#10b981", data: shareholding.map((s) => ({ date: s.period, value: s.dii_pct ?? 0 })) },
                      ]} />
              )}

              {tab === "corp" && (
                <div className="flex flex-col gap-3">
                  {corporateActions.length === 0
                    ? <div className="text-xs text-slate-400 py-6 text-center">No data — sync corporate_actions first.</div>
                    : (
                      <table className="w-full text-xs">
                        <thead><tr className="text-slate-400 border-b border-slate-100">
                          {["Ex Date", "Type", "Value", "Ratio"].map((h) => <th key={h} className="text-left py-1.5 px-2">{h}</th>)}
                        </tr></thead>
                        <tbody>
                          {corporateActions.slice(0, 10).map((a, i) => (
                            <tr key={i} className="border-b border-slate-50">
                              <td className="py-1.5 px-2 text-slate-600">{a.ex_date}</td>
                              <td className="py-1.5 px-2">
                                <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${
                                  a.action_type === "DIVIDEND" ? "bg-emerald-50 text-emerald-700"
                                  : a.action_type === "BONUS" ? "bg-blue-50 text-blue-700"
                                  : "bg-slate-100 text-slate-600"}`}>
                                  {a.action_type}
                                </span>
                              </td>
                              <td className="py-1.5 px-2 text-slate-700">{a.value != null ? `₹${a.value}` : "—"}</td>
                              <td className="py-1.5 px-2 text-slate-600">{a.ratio ?? "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  {insiderTrades.length > 0 && (
                    <>
                      <div className="text-xs text-slate-500 font-medium mt-1">Insider Trades</div>
                      <table className="w-full text-xs">
                        <thead><tr className="text-slate-400 border-b border-slate-100">
                          {["Name", "Date", "Type", "Qty"].map((h) => <th key={h} className="text-left py-1.5 px-2">{h}</th>)}
                        </tr></thead>
                        <tbody>
                          {insiderTrades.slice(0, 10).map((t, i) => (
                            <tr key={i} className="border-b border-slate-50">
                              <td className="py-1.5 px-2 max-w-[120px] truncate text-slate-700">{t.person_name}</td>
                              <td className="py-1.5 px-2 text-slate-500">{t.trade_date}</td>
                              <td className={`py-1.5 px-2 font-medium ${t.transaction_type === "Buy" ? "text-emerald-600" : "text-red-500"}`}>{t.transaction_type}</td>
                              <td className="py-1.5 px-2 text-slate-700">{t.quantity?.toLocaleString("en-IN")}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </>
                  )}
                </div>
              )}

              {tab === "fno" && (
                fno.length === 0
                  ? <div className="text-xs text-slate-400 py-6 text-center">No F&O data — sync fno_bhavcopy first.</div>
                  : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead><tr className="text-slate-400 border-b border-slate-100">
                          {["Instrument", "Expiry", "Strike", "Type", "Close", "OI"].map((h) => <th key={h} className="text-left py-1.5 px-2">{h}</th>)}
                        </tr></thead>
                        <tbody>
                          {fno.slice(0, 20).map((f, i) => (
                            <tr key={i} className="border-b border-slate-50">
                              <td className="py-1.5 px-2 text-slate-700">{f.instrument}</td>
                              <td className="py-1.5 px-2 text-slate-500">{f.expiry ?? "—"}</td>
                              <td className="py-1.5 px-2 text-slate-700">{f.strike != null ? fmt(f.strike, 0) : "—"}</td>
                              <td className={`py-1.5 px-2 font-medium ${f.option_type === "CE" ? "text-emerald-600" : f.option_type === "PE" ? "text-red-500" : "text-slate-600"}`}>{f.option_type ?? "—"}</td>
                              <td className="py-1.5 px-2 text-slate-700">{fmt(f.close)}</td>
                              <td className="py-1.5 px-2 text-slate-600">{f.open_interest?.toLocaleString("en-IN") ?? "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )
              )}

              {tab === "backtest" && (
                <div className="flex flex-col gap-3">
                  <div className="flex flex-wrap gap-2">
                    <select value={strategies.findIndex((s) => s.params.entry_col === params.entry_col && s.params.entry_threshold_col === params.entry_threshold_col)}
                      onChange={(e) => { const s = strategies[Number(e.target.value)]; if (s) applyStrategy(s); }}
                      className="bg-slate-50 border border-slate-200 text-slate-700 text-xs rounded-lg px-2 py-1.5 outline-none">
                      <option value="-1">Custom</option>
                      {strategies.map((s, i) => <option key={i} value={i}>{s.name}</option>)}
                    </select>
                    <input type="date" value={params.from_date} onChange={(e) => setParams({ from_date: e.target.value })}
                      className="bg-slate-50 border border-slate-200 text-slate-700 text-xs rounded-lg px-2 py-1.5 outline-none" />
                    <input type="date" value={params.to_date} onChange={(e) => setParams({ to_date: e.target.value })}
                      className="bg-slate-50 border border-slate-200 text-slate-700 text-xs rounded-lg px-2 py-1.5 outline-none" />
                    <input type="number" value={params.initial_capital} onChange={(e) => setParams({ initial_capital: Number(e.target.value) })}
                      placeholder="Capital ₹" className="w-28 bg-slate-50 border border-slate-200 text-slate-700 text-xs rounded-lg px-2 py-1.5 outline-none" />
                    <button onClick={runBacktest} disabled={btLoading}
                      className="flex items-center gap-1.5 bg-blue-500 hover:bg-blue-600 disabled:opacity-40 text-white text-xs font-medium rounded-lg px-3 py-1.5 transition-colors">
                      <FlaskConical size={12} />{btLoading ? "Running…" : "Run"}
                    </button>
                  </div>
                  {btError && <div className="text-red-500 text-xs">{btError}</div>}
                  {btResults && <BacktestResults results={btResults} />}
                </div>
              )}
            </div>
          </div>

          {/* Quick nav */}
          <div className="flex gap-2">
            <button onClick={() => navigate("/screener")}
              className="flex-1 flex items-center justify-center gap-1.5 bg-white border border-slate-200 hover:border-blue-400 hover:text-blue-600 text-slate-500 text-xs font-medium rounded-xl py-2.5 transition-all shadow-sm">
              <SlidersHorizontal size={13} /> Screener
            </button>
            <button onClick={() => navigate("/backtest")}
              className="flex-1 flex items-center justify-center gap-1.5 bg-white border border-slate-200 hover:border-blue-400 hover:text-blue-600 text-slate-500 text-xs font-medium rounded-xl py-2.5 transition-all shadow-sm">
              <FlaskConical size={13} /> Full Backtest
            </button>
          </div>
        </div>

        {/* RIGHT — sticky chart */}
        <div className="flex flex-col">
          <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden xl:sticky xl:top-16">
            <div className="flex items-center gap-1 px-3 py-2 border-b border-slate-100">
              <Calendar size={12} className="text-slate-400 mr-1" />
              {RANGES.map((r) => (
                <button key={r} onClick={() => setRange(r)}
                  className={`text-xs px-2 py-1 rounded-md transition-colors ${
                    range === r ? "bg-blue-500 text-white" : "bg-slate-100 text-slate-500 hover:bg-slate-200"
                  }`}>
                  {r}
                </button>
              ))}
            </div>
            <CandleChart candles={candles} loading={loading.candles} />
          </div>
        </div>
      </div>
    </div>
  );
}
