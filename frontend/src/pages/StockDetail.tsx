import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  TrendingUp, BarChart2, Users, Building2,
  ArrowUpRight, ArrowDownRight, SlidersHorizontal, FlaskConical,
  ChevronRight, Calendar, Layers,
} from "lucide-react";
import { useStockStore } from "../store/useStockStore";
import { useBacktestStore } from "../store/useBacktestStore";
import CandleChart from "../components/CandleChart";
import BacktestResults from "../components/BacktestResults";
import MacroLineChart from "../components/MacroLineChart";

type Range = "1M" | "3M" | "6M" | "1Y" | "3Y" | "MAX";
type Tab = "fundamentals" | "delivery" | "shareholding" | "corp" | "fno" | "backtest";

const RANGES: Range[] = ["1M", "3M", "6M", "1Y", "3Y", "MAX"];
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

function MetricCard({ label, value, icon: Icon, highlight }: {
  label: string; value: string; icon?: React.ElementType; highlight?: "up" | "down" | "neutral";
}) {
  const color = highlight === "up" ? "text-green-400" : highlight === "down" ? "text-red-400" : "text-gray-100";
  return (
    <div className="bg-gray-800/60 rounded-lg p-3 flex flex-col gap-1">
      <div className="flex items-center gap-1.5 text-xs text-gray-500">
        {Icon && <Icon size={11} />}
        {label}
      </div>
      <div className={`text-sm font-semibold ${color}`}>{value}</div>
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

  const {
    candles, fundamentals, delivery, shareholding,
    corporateActions, insiderTrades, fno, loading,
    fetchCandles, fetchFundamentals, fetchDelivery,
    fetchShareholding, fetchCorporateActions, fetchFno,
  } = useStockStore();

  const {
    params, results: btResults, loading: btLoading, error: btError,
    strategies, setParams, applyStrategy, runBacktest, loadStrategies,
  } = useBacktestStore();

  const [range, setRange] = useState<Range>("1Y");
  const [tab, setTab] = useState<Tab>("fundamentals");
  const [fundPeriod, setFundPeriod] = useState<"Q" | "A">("Q");

  useEffect(() => { fetchCandles(sym, fromDate(range), true); }, [sym, range]);

  useEffect(() => {
    if (tab === "fundamentals") fetchFundamentals(sym, fundPeriod);
    if (tab === "delivery") fetchDelivery(sym, fromDate("1Y"));
    if (tab === "shareholding") fetchShareholding(sym);
    if (tab === "corp") fetchCorporateActions(sym);
    if (tab === "fno") fetchFno(sym);
  }, [tab, sym, fundPeriod]);

  useEffect(() => {
    loadStrategies();
    setParams({ symbol: sym });
    fetchFundamentals(sym, "Q");
    fetchShareholding(sym);
  }, [sym]);

  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  const change = last && prev ? last.close - prev.close : 0;
  const changePct = prev?.close ? (change / prev.close) * 100 : 0;
  const up = change >= 0;

  const latestFund = fundamentals[0];
  const latestShare = shareholding[0];

  return (
    <div className="flex flex-col gap-4">
      {/* Breadcrumb */}
      <div className="flex items-center gap-1 text-xs text-gray-500">
        <button onClick={() => navigate("/")} className="hover:text-gray-300">Dashboard</button>
        <ChevronRight size={12} />
        <span className="text-gray-300 font-medium">{sym}</span>
      </div>

      {/* Main 50/50 layout */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">

        {/* LEFT — data panel */}
        <div className="flex flex-col gap-4">
          {/* Price header */}
          <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
            <div className="flex items-start justify-between mb-3">
              <div>
                <div className="text-2xl font-bold text-gray-100">{sym}</div>
                {last && (
                  <div className="flex items-baseline gap-2 mt-1">
                    <span className="text-3xl font-bold text-gray-100">₹{fmt(last.close)}</span>
                    <span className={`flex items-center gap-0.5 text-sm font-medium ${up ? "text-green-400" : "text-red-400"}`}>
                      {up ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
                      {up ? "+" : ""}{fmt(change)} ({up ? "+" : ""}{changePct.toFixed(2)}%)
                    </span>
                  </div>
                )}
              </div>
              {loading.candles && (
                <div className="w-5 h-5 border-2 border-gray-700 border-t-blue-400 rounded-full animate-spin mt-1" />
              )}
            </div>
            {last && (
              <div className="grid grid-cols-3 gap-2 text-xs text-gray-500 border-t border-gray-800 pt-3">
                <div><span className="block text-gray-600">Open</span>₹{fmt(last.open)}</div>
                <div><span className="block text-gray-600">High</span>₹{fmt(last.high)}</div>
                <div><span className="block text-gray-600">Low</span>₹{fmt(last.low)}</div>
                <div><span className="block text-gray-600">Volume</span>{last.volume?.toLocaleString("en-IN")}</div>
                <div><span className="block text-gray-600">Date</span>{last.date}</div>
                <div><span className="block text-gray-600">52W H/L</span>
                  {candles.length > 0
                    ? `${fmt(Math.max(...candles.map(c => c.high)))} / ${fmt(Math.min(...candles.map(c => c.low)))}`
                    : "—"}
                </div>
              </div>
            )}
          </div>

          {/* Key metrics grid */}
          <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
            <div className="text-xs font-semibold text-gray-400 mb-3 uppercase tracking-wide">Key Metrics</div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              <MetricCard label="Revenue (TTM)" value={fmtCr(latestFund?.revenue)} icon={BarChart2} />
              <MetricCard label="PAT" value={fmtCr(latestFund?.pat)} icon={TrendingUp}
                highlight={latestFund?.pat != null ? (latestFund.pat >= 0 ? "up" : "down") : undefined} />
              <MetricCard label="EPS" value={latestFund?.eps_basic != null ? `₹${fmt(latestFund.eps_basic)}` : "—"} />
              <MetricCard label="Total Debt" value={fmtCr(latestFund?.total_debt)} icon={Building2} />
              <MetricCard label="Equity" value={fmtCr(latestFund?.total_equity)} />
              <MetricCard label="Cash" value={fmtCr(latestFund?.cash)} />
              <MetricCard label="Promoter %" icon={Users}
                value={latestShare?.promoter_pct != null ? `${fmt(latestShare.promoter_pct)}%` : "—"}
                highlight={latestShare?.promoter_pct != null ? (latestShare.promoter_pct > 50 ? "up" : "neutral") : undefined} />
              <MetricCard label="FII %" icon={Users}
                value={latestShare?.fii_pct != null ? `${fmt(latestShare.fii_pct)}%` : "—"} />
              <MetricCard label="DII %" icon={Users}
                value={latestShare?.dii_pct != null ? `${fmt(latestShare.dii_pct)}%` : "—"} />
            </div>
          </div>

          {/* Tabs */}
          <div className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
            <div className="flex overflow-x-auto border-b border-gray-800">
              {TABS.map(({ id, label, icon: Icon }) => (
                <button key={id} onClick={() => setTab(id)}
                  className={`flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium whitespace-nowrap border-b-2 transition-colors ${
                    tab === id ? "border-blue-500 text-blue-400" : "border-transparent text-gray-500 hover:text-gray-300"
                  }`}>
                  <Icon size={12} />
                  {label}
                </button>
              ))}
            </div>

            <div className="p-3 min-h-[200px]">
              {/* Fundamentals */}
              {tab === "fundamentals" && (
                <div>
                  <div className="flex gap-2 mb-3">
                    {(["Q", "A"] as const).map((p) => (
                      <button key={p} onClick={() => { setFundPeriod(p); fetchFundamentals(sym, p); }}
                        className={`text-xs px-2 py-1 rounded ${fundPeriod === p ? "bg-blue-600 text-white" : "bg-gray-800 text-gray-400"}`}>
                        {p === "Q" ? "Quarterly" : "Annual"}
                      </button>
                    ))}
                  </div>
                  {loading.fundamentals ? (
                    <div className="flex justify-center py-8">
                      <div className="w-5 h-5 border-2 border-gray-700 border-t-blue-400 rounded-full animate-spin" />
                    </div>
                  ) : fundamentals.length === 0 ? (
                    <div className="text-xs text-gray-500 py-6 text-center">No data — run fundamentals sync.</div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs text-gray-300">
                        <thead>
                          <tr className="text-gray-500 border-b border-gray-800">
                            <th className="text-left py-1.5 px-2">Metric</th>
                            {fundamentals.slice(0, 6).map((f) => (
                              <th key={f.period} className="text-right py-1.5 px-2">{f.period.slice(0, 7)}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {([ ["Revenue", "revenue", fmtCr], ["EBITDA", "ebitda", fmtCr], ["PAT", "pat", fmtCr],
                            ["EPS", "eps_basic", (v: number | null | undefined) => v != null ? `₹${fmt(v)}` : "—"],
                            ["Debt", "total_debt", fmtCr], ["Cash", "cash", fmtCr],
                          ] as [string, string, (v: number | null | undefined) => string][]).map(([label, key, fn]) => (
                            <tr key={key} className="border-b border-gray-800/40 hover:bg-gray-800/20">
                              <td className="py-1.5 px-2 text-gray-400">{label}</td>
                              {fundamentals.slice(0, 6).map((f) => (
                                <td key={f.period} className="py-1.5 px-2 text-right">
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

              {/* Delivery */}
              {tab === "delivery" && (
                delivery.length === 0
                  ? <div className="text-xs text-gray-500 py-6 text-center">No delivery data.</div>
                  : <MacroLineChart title="Delivery %" height={160}
                      series={[{ label: "Delivery %", color: "#34d399", data: delivery.map((d) => ({ date: d.date, value: d.delivery_pct })) }]} />
              )}

              {/* Shareholding */}
              {tab === "shareholding" && (
                shareholding.length === 0
                  ? <div className="text-xs text-gray-500 py-6 text-center">No shareholding data.</div>
                  : <MacroLineChart title="Shareholding %" height={160}
                      series={[
                        { label: "Promoter", color: "#60a5fa", data: shareholding.map((s) => ({ date: s.period, value: s.promoter_pct ?? 0 })) },
                        { label: "FII", color: "#f59e0b", data: shareholding.map((s) => ({ date: s.period, value: s.fii_pct ?? 0 })) },
                        { label: "DII", color: "#34d399", data: shareholding.map((s) => ({ date: s.period, value: s.dii_pct ?? 0 })) },
                      ]} />
              )}

              {/* Corp Actions */}
              {tab === "corp" && (
                <div className="flex flex-col gap-3">
                  {corporateActions.length === 0
                    ? <div className="text-xs text-gray-500 py-6 text-center">No corp action data.</div>
                    : (
                      <table className="w-full text-xs text-gray-300">
                        <thead><tr className="text-gray-500 border-b border-gray-800">
                          {["Ex Date", "Type", "Value", "Ratio"].map((h) => <th key={h} className="text-left py-1.5 px-2">{h}</th>)}
                        </tr></thead>
                        <tbody>
                          {corporateActions.slice(0, 10).map((a, i) => (
                            <tr key={i} className="border-b border-gray-800/40">
                              <td className="py-1.5 px-2">{a.ex_date}</td>
                              <td className="py-1.5 px-2">
                                <span className={`px-1.5 py-0.5 rounded text-xs ${
                                  a.action_type === "DIVIDEND" ? "bg-green-900/40 text-green-400"
                                  : a.action_type === "BONUS" ? "bg-blue-900/40 text-blue-400"
                                  : "bg-gray-800 text-gray-400"}`}>
                                  {a.action_type}
                                </span>
                              </td>
                              <td className="py-1.5 px-2">{a.value != null ? `₹${a.value}` : "—"}</td>
                              <td className="py-1.5 px-2">{a.ratio ?? "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  {insiderTrades.length > 0 && (
                    <>
                      <div className="text-xs text-gray-400 font-medium mt-1">Insider Trades</div>
                      <table className="w-full text-xs text-gray-300">
                        <thead><tr className="text-gray-500 border-b border-gray-800">
                          {["Name", "Date", "Type", "Qty"].map((h) => <th key={h} className="text-left py-1.5 px-2">{h}</th>)}
                        </tr></thead>
                        <tbody>
                          {insiderTrades.slice(0, 10).map((t, i) => (
                            <tr key={i} className="border-b border-gray-800/40">
                              <td className="py-1.5 px-2 max-w-[120px] truncate">{t.person_name}</td>
                              <td className="py-1.5 px-2">{t.trade_date}</td>
                              <td className={`py-1.5 px-2 ${t.transaction_type === "Buy" ? "text-green-400" : "text-red-400"}`}>{t.transaction_type}</td>
                              <td className="py-1.5 px-2">{t.quantity?.toLocaleString("en-IN")}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </>
                  )}
                </div>
              )}

              {/* F&O */}
              {tab === "fno" && (
                fno.length === 0
                  ? <div className="text-xs text-gray-500 py-6 text-center">No F&O data.</div>
                  : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs text-gray-300">
                        <thead><tr className="text-gray-500 border-b border-gray-800">
                          {["Instrument", "Expiry", "Strike", "Type", "Close", "OI"].map((h) => <th key={h} className="text-left py-1.5 px-2">{h}</th>)}
                        </tr></thead>
                        <tbody>
                          {fno.slice(0, 20).map((f, i) => (
                            <tr key={i} className="border-b border-gray-800/40">
                              <td className="py-1.5 px-2">{f.instrument}</td>
                              <td className="py-1.5 px-2">{f.expiry ?? "—"}</td>
                              <td className="py-1.5 px-2">{f.strike != null ? fmt(f.strike, 0) : "—"}</td>
                              <td className={`py-1.5 px-2 ${f.option_type === "CE" ? "text-green-400" : f.option_type === "PE" ? "text-red-400" : ""}`}>{f.option_type ?? "—"}</td>
                              <td className="py-1.5 px-2">{fmt(f.close)}</td>
                              <td className="py-1.5 px-2">{f.open_interest?.toLocaleString("en-IN") ?? "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )
              )}

              {/* Backtest */}
              {tab === "backtest" && (
                <div className="flex flex-col gap-3">
                  <div className="flex flex-wrap gap-2">
                    <select
                      value={strategies.findIndex((s) => s.params.entry_col === params.entry_col && s.params.entry_threshold_col === params.entry_threshold_col)}
                      onChange={(e) => { const s = strategies[Number(e.target.value)]; if (s) applyStrategy(s); }}
                      className="bg-gray-800 text-gray-200 text-xs rounded px-2 py-1.5 outline-none">
                      <option value="-1">Custom</option>
                      {strategies.map((s, i) => <option key={i} value={i}>{s.name}</option>)}
                    </select>
                    <input type="date" value={params.from_date} onChange={(e) => setParams({ from_date: e.target.value })}
                      className="bg-gray-800 text-gray-200 text-xs rounded px-2 py-1.5 outline-none" />
                    <input type="date" value={params.to_date} onChange={(e) => setParams({ to_date: e.target.value })}
                      className="bg-gray-800 text-gray-200 text-xs rounded px-2 py-1.5 outline-none" />
                    <input type="number" value={params.initial_capital}
                      onChange={(e) => setParams({ initial_capital: Number(e.target.value) })}
                      placeholder="Capital ₹" className="w-28 bg-gray-800 text-gray-200 text-xs rounded px-2 py-1.5 outline-none" />
                    <button onClick={runBacktest} disabled={btLoading}
                      className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-xs font-medium rounded px-3 py-1.5">
                      <FlaskConical size={12} />
                      {btLoading ? "Running…" : "Run"}
                    </button>
                  </div>
                  {btError && <div className="text-red-400 text-xs">{btError}</div>}
                  {btResults && <BacktestResults results={btResults} />}
                </div>
              )}
            </div>
          </div>

          {/* Quick nav */}
          <div className="flex gap-2">
            <button onClick={() => navigate("/screener")}
              className="flex-1 flex items-center justify-center gap-1.5 bg-gray-900 border border-gray-800 hover:border-blue-600 text-gray-400 hover:text-blue-400 text-xs font-medium rounded-lg py-2.5 transition-colors">
              <SlidersHorizontal size={13} /> Screener
            </button>
            <button onClick={() => navigate("/backtest")}
              className="flex-1 flex items-center justify-center gap-1.5 bg-gray-900 border border-gray-800 hover:border-blue-600 text-gray-400 hover:text-blue-400 text-xs font-medium rounded-lg py-2.5 transition-colors">
              <FlaskConical size={13} /> Full Backtest
            </button>
          </div>
        </div>

        {/* RIGHT — sticky chart */}
        <div className="flex flex-col">
          <div className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden xl:sticky xl:top-16">
            <div className="flex items-center gap-1 px-3 py-2 border-b border-gray-800">
              <Calendar size={12} className="text-gray-500 mr-1" />
              {RANGES.map((r) => (
                <button key={r} onClick={() => setRange(r)}
                  className={`text-xs px-2 py-1 rounded transition-colors ${
                    range === r ? "bg-blue-600 text-white" : "bg-gray-800 text-gray-400 hover:text-gray-100"
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
