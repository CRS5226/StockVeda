import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useStockStore } from "../store/useStockStore";
import { useBacktestStore } from "../store/useBacktestStore";
import CandleChart from "../components/CandleChart";
import BacktestResults from "../components/BacktestResults";
import MacroLineChart from "../components/MacroLineChart";

type Tab = "chart" | "fundamentals" | "delivery" | "shareholding" | "corp" | "fno";
type Range = "1M" | "3M" | "6M" | "1Y" | "3Y" | "MAX";

const RANGES: Range[] = ["1M", "3M", "6M", "1Y", "3Y", "MAX"];
function fromDateForRange(r: Range): string | undefined {
  const d = new Date();
  if (r === "MAX") return undefined;
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

export default function StockDetail() {
  const { symbol = "" } = useParams<{ symbol: string }>();
  const sym = symbol.toUpperCase();

  const { candles, fundamentals, delivery, shareholding, corporateActions, insiderTrades, fno,
    loading, fetchCandles, fetchFundamentals, fetchDelivery,
    fetchShareholding, fetchCorporateActions, fetchFno } = useStockStore();

  const { params, results: btResults, loading: btLoading, error: btError,
    strategies, setParams, applyStrategy, runBacktest, loadStrategies } = useBacktestStore();

  const [tab, setTab] = useState<Tab>("chart");
  const [range, setRange] = useState<Range>("1Y");
  const [fundPeriod, setFundPeriod] = useState<"Q" | "A">("Q");

  // Fetch candles on mount/range change
  useEffect(() => {
    if (!sym) return;
    fetchCandles(sym, fromDateForRange(range), true);
  }, [sym, range]);

  // Fetch other data on tab switch
  useEffect(() => {
    if (!sym) return;
    if (tab === "fundamentals") fetchFundamentals(sym, fundPeriod);
    if (tab === "delivery") fetchDelivery(sym, fromDateForRange("1Y"));
    if (tab === "shareholding") fetchShareholding(sym);
    if (tab === "corp") fetchCorporateActions(sym);
    if (tab === "fno") fetchFno(sym);
  }, [tab, sym, fundPeriod]);

  useEffect(() => { loadStrategies(); setParams({ symbol: sym }); }, [sym]);

  // Latest price info
  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  const change = last && prev ? last.close - prev.close : 0;
  const changePct = prev && prev.close ? (change / prev.close) * 100 : 0;

  const TABS: { id: Tab; label: string }[] = [
    { id: "chart", label: "Chart" },
    { id: "fundamentals", label: "Fundamentals" },
    { id: "delivery", label: "Delivery" },
    { id: "shareholding", label: "Shareholding" },
    { id: "corp", label: "Corp Actions" },
    { id: "fno", label: "F&O" },
  ];

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-4 bg-gray-900 rounded border border-gray-800 px-4 py-3">
        <span className="text-2xl font-bold text-gray-100">{sym}</span>
        {last && (
          <>
            <span className="text-xl font-semibold text-gray-100">₹{fmt(last.close)}</span>
            <span className={`text-sm font-medium ${change >= 0 ? "text-green-400" : "text-red-400"}`}>
              {change >= 0 ? "+" : ""}{fmt(change)} ({changePct >= 0 ? "+" : ""}{changePct.toFixed(2)}%)
            </span>
            <span className="text-xs text-gray-500 ml-auto">
              Vol: {last.volume?.toLocaleString("en-IN")} · {last.date}
            </span>
          </>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-800">
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors ${tab === t.id ? "border-blue-500 text-blue-400" : "border-transparent text-gray-500 hover:text-gray-300"}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === "chart" && (
        <div className="bg-gray-900 rounded border border-gray-800">
          <div className="flex items-center gap-1 px-3 py-2 border-b border-gray-800">
            {RANGES.map((r) => (
              <button key={r} onClick={() => setRange(r)}
                className={`text-xs px-2 py-1 rounded ${range === r ? "bg-blue-600 text-white" : "bg-gray-800 text-gray-400 hover:text-gray-100"}`}>
                {r}
              </button>
            ))}
          </div>
          <CandleChart candles={candles} loading={loading.candles} />
        </div>
      )}

      {tab === "fundamentals" && (
        <div className="bg-gray-900 rounded border border-gray-800 overflow-hidden">
          <div className="flex gap-2 px-3 py-2 border-b border-gray-800">
            {(["Q", "A"] as const).map((p) => (
              <button key={p} onClick={() => { setFundPeriod(p); fetchFundamentals(sym, p); }}
                className={`text-xs px-2 py-1 rounded ${fundPeriod === p ? "bg-blue-600 text-white" : "bg-gray-800 text-gray-400"}`}>
                {p === "Q" ? "Quarterly" : "Annual"}
              </button>
            ))}
          </div>
          {loading.fundamentals ? (
            <div className="p-6 text-gray-500 text-sm">Loading…</div>
          ) : fundamentals.length === 0 ? (
            <div className="p-6 text-gray-500 text-sm">No data — run fundamentals sync first.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-gray-300">
                <thead>
                  <tr className="text-gray-500 border-b border-gray-800 bg-gray-900">
                    <th className="text-left py-2 px-3 sticky left-0 bg-gray-900">Metric</th>
                    {fundamentals.map((f) => <th key={f.period} className="py-2 px-3 text-right font-medium">{f.period.slice(0, 7)}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {[
                    ["Revenue", "revenue", fmtCr],
                    ["Gross Profit", "gross_profit", fmtCr],
                    ["EBITDA", "ebitda", fmtCr],
                    ["PAT", "pat", fmtCr],
                    ["EPS Basic", "eps_basic", (v: number | null | undefined) => fmt(v)],
                    ["Total Assets", "total_assets", fmtCr],
                    ["Total Debt", "total_debt", fmtCr],
                    ["Total Equity", "total_equity", fmtCr],
                    ["Cash", "cash", fmtCr],
                    ["CFO", "cfo", fmtCr],
                    ["Capex", "capex", fmtCr],
                  ].map(([label, key, formatter]) => (
                    <tr key={String(key)} className="border-b border-gray-800/40 hover:bg-gray-800/20">
                      <td className="py-1.5 px-3 text-gray-400 sticky left-0 bg-gray-900">{String(label)}</td>
                      {fundamentals.map((f) => (
                        <td key={f.period} className="py-1.5 px-3 text-right">
                          {(formatter as (v: number | null | undefined) => string)(f[key as keyof typeof f] as number | null | undefined)}
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
        <div className="bg-gray-900 rounded border border-gray-800 p-3">
          {loading.delivery ? <div className="text-gray-500 text-sm p-4">Loading…</div>
            : delivery.length === 0 ? <div className="text-gray-500 text-sm p-4">No delivery data.</div>
            : (
              <MacroLineChart title="Delivery %" height={220}
                series={[{ label: "Delivery %", color: "#34d399", data: delivery.map((d) => ({ date: d.date, value: d.delivery_pct })) }]} />
            )}
        </div>
      )}

      {tab === "shareholding" && (
        <div className="bg-gray-900 rounded border border-gray-800 p-3">
          {shareholding.length === 0 ? <div className="text-gray-500 text-sm p-4">No shareholding data.</div>
            : (
              <MacroLineChart title="Shareholding %" height={220}
                series={[
                  { label: "Promoter", color: "#60a5fa", data: shareholding.map((s) => ({ date: s.period, value: s.promoter_pct ?? 0 })) },
                  { label: "FII", color: "#f59e0b", data: shareholding.map((s) => ({ date: s.period, value: s.fii_pct ?? 0 })) },
                  { label: "DII", color: "#34d399", data: shareholding.map((s) => ({ date: s.period, value: s.dii_pct ?? 0 })) },
                  { label: "MF", color: "#a78bfa", data: shareholding.map((s) => ({ date: s.period, value: s.mf_pct ?? 0 })) },
                  { label: "Retail", color: "#fb923c", data: shareholding.map((s) => ({ date: s.period, value: s.retail_pct ?? 0 })) },
                ]} />
            )}
        </div>
      )}

      {tab === "corp" && (
        <div className="flex flex-col gap-4">
          <div className="bg-gray-900 rounded border border-gray-800 overflow-hidden">
            <div className="px-3 py-2 border-b border-gray-800 text-xs font-medium text-gray-400">Corporate Actions</div>
            {corporateActions.length === 0 ? <div className="p-4 text-gray-500 text-sm">No data.</div> : (
              <table className="w-full text-xs text-gray-300">
                <thead><tr className="text-gray-500 border-b border-gray-800">
                  {["Ex Date","Type","Value","Ratio","Record Date"].map((h) => <th key={h} className="text-left py-2 px-3">{h}</th>)}
                </tr></thead>
                <tbody>
                  {corporateActions.map((a, i) => (
                    <tr key={i} className="border-b border-gray-800/40 hover:bg-gray-800/20">
                      <td className="py-1.5 px-3">{a.ex_date}</td>
                      <td className="py-1.5 px-3">
                        <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${
                          a.action_type === "DIVIDEND" ? "bg-green-900/40 text-green-400"
                          : a.action_type === "BONUS" ? "bg-blue-900/40 text-blue-400"
                          : a.action_type === "SPLIT" ? "bg-yellow-900/40 text-yellow-400"
                          : "bg-gray-800 text-gray-400"}`}>
                          {a.action_type}
                        </span>
                      </td>
                      <td className="py-1.5 px-3">{a.value != null ? `₹${a.value}` : "—"}</td>
                      <td className="py-1.5 px-3">{a.ratio ?? "—"}</td>
                      <td className="py-1.5 px-3">{a.record_date ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          {insiderTrades.length > 0 && (
            <div className="bg-gray-900 rounded border border-gray-800 overflow-hidden">
              <div className="px-3 py-2 border-b border-gray-800 text-xs font-medium text-gray-400">Insider / PIT Trades</div>
              <table className="w-full text-xs text-gray-300">
                <thead><tr className="text-gray-500 border-b border-gray-800">
                  {["Name","Category","Date","Type","Qty","Price"].map((h) => <th key={h} className="text-left py-2 px-3">{h}</th>)}
                </tr></thead>
                <tbody>
                  {insiderTrades.slice(0, 30).map((t, i) => (
                    <tr key={i} className="border-b border-gray-800/40 hover:bg-gray-800/20">
                      <td className="py-1.5 px-3">{t.person_name}</td>
                      <td className="py-1.5 px-3">{t.person_category}</td>
                      <td className="py-1.5 px-3">{t.trade_date}</td>
                      <td className={`py-1.5 px-3 ${t.transaction_type === "Buy" ? "text-green-400" : "text-red-400"}`}>{t.transaction_type}</td>
                      <td className="py-1.5 px-3">{t.quantity?.toLocaleString("en-IN")}</td>
                      <td className="py-1.5 px-3">{t.price != null ? `₹${fmt(t.price)}` : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === "fno" && (
        <div className="bg-gray-900 rounded border border-gray-800 overflow-x-auto">
          {fno.length === 0 ? <div className="p-4 text-gray-500 text-sm">No F&O data.</div> : (
            <table className="w-full text-xs text-gray-300">
              <thead><tr className="text-gray-500 border-b border-gray-800">
                {["Instrument","Expiry","Strike","Type","Close","OI","OI Chg"].map((h) => <th key={h} className="text-left py-2 px-3">{h}</th>)}
              </tr></thead>
              <tbody>
                {fno.slice(0, 50).map((f, i) => (
                  <tr key={i} className="border-b border-gray-800/40 hover:bg-gray-800/20">
                    <td className="py-1.5 px-3">{f.instrument}</td>
                    <td className="py-1.5 px-3">{f.expiry ?? "—"}</td>
                    <td className="py-1.5 px-3">{f.strike != null ? fmt(f.strike, 0) : "—"}</td>
                    <td className={`py-1.5 px-3 ${f.option_type === "CE" ? "text-green-400" : f.option_type === "PE" ? "text-red-400" : ""}`}>{f.option_type ?? "—"}</td>
                    <td className="py-1.5 px-3">{fmt(f.close)}</td>
                    <td className="py-1.5 px-3">{f.open_interest?.toLocaleString("en-IN") ?? "—"}</td>
                    <td className={`py-1.5 px-3 ${(f.oi_change ?? 0) >= 0 ? "text-green-400" : "text-red-400"}`}>
                      {f.oi_change != null ? `${f.oi_change >= 0 ? "+" : ""}${f.oi_change.toLocaleString("en-IN")}` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Backtest section */}
      <div className="bg-gray-900 rounded border border-gray-800 p-4">
        <div className="text-sm font-semibold text-gray-300 mb-3">Backtest</div>
        <div className="flex flex-wrap gap-3 mb-3">
          <select value={strategies.findIndex((s) => s.params.entry_col === params.entry_col && s.params.entry_threshold_col === params.entry_threshold_col)}
            onChange={(e) => { const s = strategies[Number(e.target.value)]; if (s) applyStrategy(s); }}
            className="bg-gray-800 text-gray-200 text-xs rounded px-2 py-1.5 outline-none">
            <option value="-1">Custom strategy</option>
            {strategies.map((s, i) => <option key={i} value={i}>{s.name}</option>)}
          </select>
          <input type="date" value={params.from_date} onChange={(e) => setParams({ from_date: e.target.value })}
            className="bg-gray-800 text-gray-200 text-xs rounded px-2 py-1.5 outline-none" />
          <input type="date" value={params.to_date} onChange={(e) => setParams({ to_date: e.target.value })}
            className="bg-gray-800 text-gray-200 text-xs rounded px-2 py-1.5 outline-none" />
          <input type="number" value={params.initial_capital} onChange={(e) => setParams({ initial_capital: Number(e.target.value) })}
            placeholder="Capital ₹" className="w-28 bg-gray-800 text-gray-200 text-xs rounded px-2 py-1.5 outline-none" />
          <button onClick={runBacktest} disabled={btLoading}
            className="bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-xs font-medium rounded px-3 py-1.5">
            {btLoading ? "Running…" : "Run Backtest"}
          </button>
        </div>
        {btError && <div className="text-red-400 text-xs mb-2">{btError}</div>}
        {btResults && <BacktestResults results={btResults} />}
      </div>
    </div>
  );
}
