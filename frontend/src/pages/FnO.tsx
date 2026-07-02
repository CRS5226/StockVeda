import { useState, useEffect, useRef, useCallback } from "react";
import { BarChart2, TrendingUp, TrendingDown, Minus, RefreshCw, ChevronDown, ChevronUp, Download } from "lucide-react";
import { api, type OptionChainData, type OptionChainRow } from "../lib/api";
import MacroLineChart from "../components/MacroLineChart";
import FnoFetchPanel, { toIso, INDEX_SYMBOLS } from "../components/FnoFetchPanel";

function fmt(n: number | null | undefined, dec = 0): string {
  if (n == null) return "—";
  return n.toLocaleString("en-IN", { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

function fmtK(n: number | null | undefined): string {
  if (n == null) return "—";
  if (Math.abs(n) >= 1_00_000) return (n / 1_00_000).toFixed(1) + "L";
  if (Math.abs(n) >= 1000) return (n / 1000).toFixed(0) + "K";
  return String(n);
}

function PcrBadge({ pcr }: { pcr: number | null }) {
  if (pcr == null) return <span className="text-slate-400">—</span>;
  const bull = pcr >= 1.2, bear = pcr <= 0.8;
  return (
    <span className={`font-bold ${bull ? "text-emerald-600" : bear ? "text-red-600" : "text-amber-600"}`}>
      {pcr.toFixed(2)}
      {bull ? " (Bullish)" : bear ? " (Bearish)" : " (Neutral)"}
    </span>
  );
}

function OIButterflyChart({ chain, maxPain, spot }: { chain: OptionChainRow[]; maxPain: number; spot: number }) {
  const visible = chain.filter(r => spot === 0 || (r.strike >= spot * 0.85 && r.strike <= spot * 1.15));
  const allOI = visible.flatMap(r => [r.ce_oi ?? 0, r.pe_oi ?? 0]);
  const maxOI = allOI.length > 0 ? Math.max(...allOI, 1) : 1;

  if (visible.length === 0) return <div className="text-xs text-slate-400 py-8 text-center">No strikes in ±15% range of spot</div>;

  return (
    <div className="overflow-y-auto max-h-[480px]">
      <div className="flex items-center gap-3 mb-2 text-[11px] text-slate-500">
        <span className="inline-flex items-center gap-1"><span className="w-3 h-2 bg-emerald-400 rounded inline-block" /> CE OI</span>
        <span className="inline-flex items-center gap-1"><span className="w-3 h-2 bg-red-400 rounded inline-block" /> PE OI</span>
        <span className="inline-flex items-center gap-1"><span className="w-2 h-2 bg-yellow-300 rounded-full inline-block" /> ATM</span>
        <span className="inline-flex items-center gap-1"><span className="w-2 h-2 bg-orange-300 rounded-full inline-block" /> Max Pain</span>
      </div>
      <div className="space-y-px">
        {visible.map(r => {
          const ceW = ((r.ce_oi ?? 0) / maxOI) * 100;
          const peW = ((r.pe_oi ?? 0) / maxOI) * 100;
          const isAtm = r.is_atm;
          const isMp = r.strike === maxPain;
          return (
            <div key={r.strike}
              className={`flex items-center h-5 text-[10px] rounded ${isAtm ? "bg-yellow-50 ring-1 ring-yellow-300" : isMp ? "bg-orange-50 ring-1 ring-orange-200" : ""}`}>
              {/* CE side — bar grows right-to-left from the strike column */}
              <div className="flex items-center w-[38%] h-full pr-1">
                <span className="text-slate-400 shrink-0 w-8 text-right mr-1">{fmtK(r.ce_oi)}</span>
                <div className="flex-1 relative h-3">
                  <div className="absolute right-0 top-0 bottom-0 bg-emerald-400 rounded-l-sm"
                    style={{ width: `${ceW}%` }} />
                </div>
              </div>
              {/* Strike label */}
              <div className="w-[24%] text-center font-semibold text-slate-700 shrink-0 flex items-center justify-center gap-0.5">
                {fmt(r.strike)}
                {isAtm && <span className="text-yellow-600 text-[7px] font-bold leading-none">▲</span>}
                {isMp && !isAtm && <span className="text-orange-500 text-[7px] font-bold leading-none">★</span>}
              </div>
              {/* PE side — bar grows left-to-right from the strike column */}
              <div className="flex items-center w-[38%] h-full pl-1">
                <div className="flex-1 relative h-3">
                  <div className="absolute left-0 top-0 bottom-0 bg-red-400 rounded-r-sm"
                    style={{ width: `${peW}%` }} />
                </div>
                <span className="text-slate-400 shrink-0 w-8 ml-1">{fmtK(r.pe_oi)}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SymbolAutocomplete({ value, onChange, onCommit, placeholder }: {
  value: string;
  onChange: (v: string) => void;
  onCommit: (v: string) => void;
  placeholder?: string;
}) {
  const [results, setResults] = useState<{ symbol: string; name: string; is_index: boolean }[]>([]);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  const search = (q: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (q.trim().length < 1) { setResults([]); return; }
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await api.fnoSearch(q.trim());
        setResults(res.results);
        setHighlight(0);
      } catch { setResults([]); }
    }, 200);
  };

  const commit = (sym: string) => {
    setOpen(false);
    setResults([]);
    onCommit(sym.toUpperCase());
  };

  return (
    <div ref={containerRef} className="relative">
      <input
        value={value}
        onChange={e => {
          const v = e.target.value.toUpperCase();
          onChange(v);
          setOpen(true);
          search(v);
        }}
        onFocus={() => { setOpen(true); if (value) search(value); }}
        onKeyDown={e => {
          if (!open || results.length === 0) {
            if (e.key === "Enter") commit(value.trim());
            return;
          }
          if (e.key === "ArrowDown") { e.preventDefault(); setHighlight(h => Math.min(h + 1, results.length - 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setHighlight(h => Math.max(h - 1, 0)); }
          else if (e.key === "Enter") { e.preventDefault(); commit(results[highlight]?.symbol ?? value.trim()); }
          else if (e.key === "Escape") setOpen(false);
        }}
        placeholder={placeholder}
        className="bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm font-semibold w-52 focus:outline-none focus:ring-2 focus:ring-blue-300 focus:border-blue-300"
      />
      {open && results.length > 0 && (
        <div className="absolute z-20 mt-1 w-72 bg-white border border-slate-200 rounded-lg shadow-lg max-h-64 overflow-y-auto">
          {results.map((r, i) => (
            <div key={r.symbol}
              onMouseDown={() => commit(r.symbol)}
              onMouseEnter={() => setHighlight(i)}
              className={`px-3 py-1.5 text-xs cursor-pointer flex items-center justify-between gap-2 ${i === highlight ? "bg-blue-50" : ""}`}>
              <span className="font-semibold text-slate-700 shrink-0">{r.symbol}</span>
              <span className="text-slate-400 truncate">{r.is_index ? "Index" : r.name}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function OptionTable({ chain, spot, showAll }: { chain: OptionChainRow[]; spot: number; showAll: boolean }) {
  const visible = showAll || spot === 0
    ? chain
    : chain.filter(r => r.strike >= spot * 0.85 && r.strike <= spot * 1.15);
  const maxCeOI = Math.max(...chain.map(r => r.ce_oi ?? 0), 1);
  const maxPeOI = Math.max(...chain.map(r => r.pe_oi ?? 0), 1);

  return (
    <div className="overflow-auto max-h-[480px] text-xs">
      <table className="w-full border-collapse min-w-[600px]">
        <thead className="sticky top-0 bg-white z-10">
          <tr className="text-[10px] text-slate-500 uppercase tracking-wide">
            <th className="text-right py-1.5 px-2 font-semibold bg-emerald-50/50 border-b border-slate-200">OI</th>
            <th className="text-right py-1.5 px-2 font-semibold bg-emerald-50/50 border-b border-slate-200">Chg</th>
            <th className="text-right py-1.5 px-2 font-semibold bg-emerald-50/50 border-b border-slate-200">LTP (CE)</th>
            <th className="text-center py-1.5 px-3 font-bold text-slate-700 border-b border-slate-200 bg-slate-50">Strike</th>
            <th className="text-left py-1.5 px-2 font-semibold bg-red-50/50 border-b border-slate-200">LTP (PE)</th>
            <th className="text-left py-1.5 px-2 font-semibold bg-red-50/50 border-b border-slate-200">Chg</th>
            <th className="text-left py-1.5 px-2 font-semibold bg-red-50/50 border-b border-slate-200">OI</th>
          </tr>
        </thead>
        <tbody>
          {visible.map(r => {
            const ceOpacity = ((r.ce_oi ?? 0) / maxCeOI) * 0.35;
            const peOpacity = ((r.pe_oi ?? 0) / maxPeOI) * 0.35;
            const ceChgPos = (r.ce_oi_change ?? 0) > 0;
            const peChgPos = (r.pe_oi_change ?? 0) > 0;
            return (
              <tr key={r.strike}
                className={`border-b border-slate-100 transition-colors ${r.is_atm ? "ring-1 ring-inset ring-yellow-300 bg-yellow-50" : "hover:bg-slate-50/50"}`}>
                <td className="text-right py-1 px-2 font-medium" style={{ background: `rgba(16,185,129,${ceOpacity})` }}>
                  {fmtK(r.ce_oi)}
                </td>
                <td className={`text-right py-1 px-2 ${ceChgPos ? "text-emerald-600" : "text-red-600"}`}
                  style={{ background: `rgba(16,185,129,${ceOpacity * 0.5})` }}>
                  {r.ce_oi_change != null ? (ceChgPos ? "+" : "") + fmtK(r.ce_oi_change) : "—"}
                </td>
                <td className="text-right py-1 px-2 font-semibold text-emerald-700"
                  style={{ background: `rgba(16,185,129,${ceOpacity * 0.3})` }}>
                  {fmt(r.ce_ltp, 2)}
                </td>
                <td className={`text-center py-1 px-3 font-bold text-slate-800 bg-slate-50 ${r.is_atm ? "text-yellow-700" : ""}`}>
                  {fmt(r.strike)}
                  {r.is_atm && <span className="ml-1 text-[8px] text-yellow-600 font-bold">ATM</span>}
                </td>
                <td className="text-left py-1 px-2 font-semibold text-red-700"
                  style={{ background: `rgba(239,68,68,${peOpacity * 0.3})` }}>
                  {fmt(r.pe_ltp, 2)}
                </td>
                <td className={`text-left py-1 px-2 ${peChgPos ? "text-emerald-600" : "text-red-600"}`}
                  style={{ background: `rgba(239,68,68,${peOpacity * 0.5})` }}>
                  {r.pe_oi_change != null ? (peChgPos ? "+" : "") + fmtK(r.pe_oi_change) : "—"}
                </td>
                <td className="text-left py-1 px-2 font-medium" style={{ background: `rgba(239,68,68,${peOpacity})` }}>
                  {fmtK(r.pe_oi)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

interface ParticipantRow { date: string; participant_type: string; instrument: string; long_oi: number; short_oi: number; net_oi: number }

type FuturesData = Awaited<ReturnType<typeof api.getFutures>>;

function FetchFuturesPanel({ symbol, onDone }: { symbol: string; onDone: () => void }) {
  const today = new Date();
  const thirtyDaysAgo = new Date(today); thirtyDaysAgo.setDate(today.getDate() - 30);

  const [fromDate, setFromDate] = useState(toIso(thirtyDaysAgo));
  const [toDate, setToDate] = useState(toIso(today));
  const [fetching, setFetching] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number; inserted: number; status: string; current_date: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopPoll = () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } };
  useEffect(() => () => stopPoll(), []);

  const startFetch = async () => {
    setErr(null); setFetching(true); setProgress(null);
    try {
      const res = await api.fnoFetchFutures(symbol || null, fromDate, toDate);
      setProgress({ done: 0, total: res.total_days, inserted: 0, status: "queued", current_date: "" });
      pollRef.current = setInterval(async () => {
        try {
          const job = await api.fnoFetchFuturesJob(res.job_id);
          setProgress(job);
          if (job.status === "done" || job.status === "empty" || job.status === "error") {
            stopPoll(); setFetching(false);
            if (job.status === "done") setTimeout(onDone, 600);
            else setErr(job.status === "empty" ? "No futures data found for this range." : "Fetch failed.");
          }
        } catch { stopPoll(); setFetching(false); }
      }, 1500);
    } catch (e: unknown) { setFetching(false); setErr(e instanceof Error ? e.message : "Fetch failed"); }
  };

  const pct = progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <div className="bg-blue-50 border border-blue-200 rounded-xl p-5 space-y-4">
      <div className="flex items-start gap-3">
        <div className="p-2 bg-blue-100 rounded-lg shrink-0 mt-0.5"><Download size={16} className="text-blue-600" /></div>
        <div>
          <div className="font-semibold text-blue-800 text-sm">Fetch Futures Data{symbol ? ` — ${symbol}` : ""}</div>
          <div className="text-xs text-blue-600 mt-0.5 leading-relaxed">
            Downloads NSE bhavcopy and extracts {symbol ? `${symbol} ` : ""}futures (all expiries) for the selected date range.
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-[10px] text-blue-600 font-semibold uppercase tracking-wide">From</label>
          <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} disabled={fetching}
            className="border border-blue-200 bg-white rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 disabled:opacity-50" />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[10px] text-blue-600 font-semibold uppercase tracking-wide">To</label>
          <input type="date" value={toDate} onChange={e => setToDate(e.target.value)} disabled={fetching}
            className="border border-blue-200 bg-white rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 disabled:opacity-50" />
        </div>
        <div className="flex gap-2 items-end">
          {(["1W", "1M", "3M"] as const).map(label => {
            const d = label === "1W" ? 7 : label === "1M" ? 30 : 90;
            return (
              <button key={label} disabled={fetching}
                onClick={() => { const x = new Date(); x.setDate(x.getDate() - d); setFromDate(toIso(x)); setToDate(toIso(today)); }}
                className="px-2.5 py-1.5 text-xs font-medium border border-blue-200 bg-white text-blue-600 hover:bg-blue-100 rounded-lg transition-colors disabled:opacity-50">
                {label}
              </button>
            );
          })}
        </div>
        <button onClick={startFetch} disabled={fetching || !fromDate || !toDate}
          className="flex items-center gap-1.5 px-4 py-1.5 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors whitespace-nowrap">
          <Download size={14} className={fetching ? "animate-bounce" : ""} />
          {fetching ? "Fetching…" : "Fetch Data"}
        </button>
      </div>
      {progress && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs text-blue-700">
            <span>{progress.done} / {progress.total} days · {progress.inserted.toLocaleString()} rows</span>
            {progress.current_date && <span className="text-blue-500">{progress.current_date}</span>}
          </div>
          <div className="w-full bg-blue-100 rounded-full h-2">
            <div className="bg-blue-500 h-2 rounded-full transition-all duration-300" style={{ width: `${pct}%` }} />
          </div>
          {progress.status === "done" && <div className="text-xs text-emerald-600 font-medium">Done! Loading futures data…</div>}
        </div>
      )}
      {err && <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{err}</div>}
    </div>
  );
}

function FuturesTab({ symbol }: { symbol: string }) {
  const [data, setData] = useState<FuturesData | null>(null);
  const [loading, setLoading] = useState(false);
  const [noData, setNoData] = useState(false);

  const load = useCallback(() => {
    if (!symbol) return;
    setLoading(true); setNoData(false);
    api.getFutures(symbol)
      .then(d => { setData(d); setNoData(false); })
      .catch(e => {
        if (String(e).includes("404")) setNoData(true);
        setData(null);
      })
      .finally(() => setLoading(false));
  }, [symbol]);

  useEffect(() => { load(); }, [load]);

  if (loading) return (
    <div className="space-y-2">{[...Array(4)].map((_, i) => <div key={i} className="h-8 bg-slate-100 rounded animate-pulse" />)}</div>
  );

  if (noData || !data) return (
    <FetchFuturesPanel symbol={symbol} onDone={load} />
  );

  const nearExpiry = data.expiries[0];
  const oiSeries = [{
    label: "OI (Near month)",
    color: "#3b82f6",
    data: data.oi_history.map(r => ({ date: r.date, value: r.open_interest ?? 0 })),
  }];
  const priceSeries = [
    { label: "Futures Close", color: "#f59e0b", data: data.oi_history.map(r => ({ date: r.date, value: r.close ?? 0 })) },
  ];

  return (
    <div className="space-y-5">
      {/* Metric cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          {
            label: "Near-Month Basis",
            value: nearExpiry?.basis != null
              ? <span className={`font-bold ${nearExpiry.basis > 0 ? "text-emerald-600" : "text-red-600"}`}>
                  {nearExpiry.basis > 0 ? "+" : ""}{fmt(nearExpiry.basis, 2)}
                </span>
              : <span className="text-slate-400">—</span>,
            sub: `Futures − Spot (${nearExpiry?.expiry ?? ""})`,
          },
          {
            label: "Cost of Carry",
            value: nearExpiry?.cost_of_carry != null
              ? <span className={`font-bold ${nearExpiry.cost_of_carry > 0 ? "text-emerald-600" : "text-red-600"}`}>
                  {nearExpiry.cost_of_carry > 0 ? "+" : ""}{nearExpiry.cost_of_carry.toFixed(2)}%
                </span>
              : <span className="text-slate-400">—</span>,
            sub: "Annualised carry cost",
          },
          {
            label: "Rollover",
            value: data.rollover_pct != null
              ? <span className={`font-bold ${data.rollover_pct > 70 ? "text-emerald-600" : data.rollover_pct < 40 ? "text-amber-600" : "text-slate-700"}`}>
                  {data.rollover_pct}%
                </span>
              : <span className="text-slate-400">—</span>,
            sub: "Near-month OI / total OI",
          },
          {
            label: "Near-Month OI",
            value: <span className="font-bold text-slate-700">{fmtK(nearExpiry?.open_interest)}</span>,
            sub: "Open interest (contracts)",
          },
        ].map(m => (
          <div key={m.label} className="bg-white border border-slate-200 rounded-xl p-3 space-y-0.5">
            <div className="text-[10px] text-slate-400 uppercase tracking-wide font-semibold">{m.label}</div>
            <div className="text-sm">{m.value}</div>
            <div className="text-[9px] text-slate-400 leading-tight">{m.sub}</div>
          </div>
        ))}
      </div>

      {/* Expiry table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-4 py-2.5 border-b border-slate-100 flex items-center justify-between">
          <div className="text-sm font-semibold text-slate-700">Open Interest across Expiries — {data.data_date}</div>
          <span className="text-xs text-slate-400">Spot: {fmt(data.spot, 2)}</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-[10px] text-slate-500 uppercase bg-slate-50 border-b border-slate-100">
                <th className="text-left px-4 py-2 font-semibold">Expiry</th>
                <th className="text-right px-3 py-2 font-semibold">DTE</th>
                <th className="text-right px-3 py-2 font-semibold">Close</th>
                <th className="text-right px-3 py-2 font-semibold">Basis</th>
                <th className="text-right px-3 py-2 font-semibold">CoC %</th>
                <th className="text-right px-3 py-2 font-semibold">OI</th>
                <th className="text-right px-3 py-2 font-semibold">OI Chg</th>
              </tr>
            </thead>
            <tbody>
              {data.expiries.map((e, i) => (
                <tr key={e.expiry} className={`border-b border-slate-50 ${i === 0 ? "bg-blue-50/40" : "hover:bg-slate-50/50"}`}>
                  <td className="px-4 py-1.5 font-medium text-slate-700">{e.expiry}{i === 0 && <span className="ml-1 text-[9px] text-blue-500 font-bold">NEAR</span>}</td>
                  <td className="text-right px-3 py-1.5 text-slate-500">{e.dte ?? "—"}d</td>
                  <td className="text-right px-3 py-1.5 font-semibold">{fmt(e.close, 2)}</td>
                  <td className={`text-right px-3 py-1.5 font-medium ${(e.basis ?? 0) > 0 ? "text-emerald-600" : "text-red-600"}`}>
                    {e.basis != null ? ((e.basis > 0 ? "+" : "") + fmt(e.basis, 2)) : "—"}
                  </td>
                  <td className={`text-right px-3 py-1.5 ${(e.cost_of_carry ?? 0) > 0 ? "text-emerald-600" : "text-red-600"}`}>
                    {e.cost_of_carry != null ? ((e.cost_of_carry > 0 ? "+" : "") + e.cost_of_carry.toFixed(2) + "%") : "—"}
                  </td>
                  <td className="text-right px-3 py-1.5">{fmtK(e.open_interest)}</td>
                  <td className={`text-right px-3 py-1.5 ${(e.oi_change ?? 0) > 0 ? "text-emerald-600" : "text-red-500"}`}>
                    {e.oi_change != null ? ((e.oi_change > 0 ? "+" : "") + fmtK(e.oi_change)) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* OI trend chart */}
      {data.oi_history.length > 1 && (
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-sm font-semibold text-slate-700 mb-3">Near-Month OI Trend</div>
          <MacroLineChart series={oiSeries} height={180} />
        </div>
      )}

      {/* Price trend */}
      {data.oi_history.length > 1 && (
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-sm font-semibold text-slate-700 mb-1">Near-Month Futures Price</div>
          <div className="text-xs text-slate-400 mb-3">EOD settle price over the fetched period</div>
          <MacroLineChart series={priceSeries} height={160} />
        </div>
      )}

      <div className="text-[10px] text-slate-400 text-right">
        Data from NSE EOD bhavcopy · {data.data_date} ·
        <button onClick={load} className="ml-1 text-blue-500 hover:underline">Refresh</button>
        {" · "}
        <button onClick={() => setNoData(true)} className="text-slate-400 hover:underline">Fetch more dates</button>
      </div>
    </div>
  );
}

export default function FnO() {
  const [pageTab, setPageTab] = useState<"options" | "futures">("options");
  const [symbol, setSymbol] = useState("NIFTY");
  const [inputVal, setInputVal] = useState("NIFTY");
  const [expiry, setExpiry] = useState<string | null>(null);
  const [chainData, setChainData] = useState<OptionChainData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lotSizes, setLotSizes] = useState<Record<string, number>>({});
  const [showAll, setShowAll] = useState(false);
  const [participantOI, setParticipantOI] = useState<ParticipantRow[]>([]);
  const [viewMode, setViewMode] = useState<"table" | "chart">("table");
  const [refreshMsg, setRefreshMsg] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchChain = useCallback((sym: string, exp?: string) => {
    setLoading(true);
    setError(null);
    api.getOptionChain(sym, exp ?? undefined)
      .then(data => {
        setChainData(data);
        if (!exp && data.expiry_dates.length > 0) {
          setExpiry(data.expiry_dates[0]);
        }
      })
      .catch(e => {
        const msg: string = e?.message ?? String(e);
        setError(msg.includes("404") ? `No F&O data for ${sym}. Run fno_bhavcopy sync first.` : msg);
        setChainData(null);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const sym = inputVal.trim().toUpperCase();
      if (sym.length >= 2) {
        setSymbol(sym);
        setExpiry(null);
        setShowAll(false);
        fetchChain(sym);
      }
    }, 400);
  }, [inputVal, fetchChain]);

  useEffect(() => {
    if (expiry && symbol) fetchChain(symbol, expiry);
  }, [expiry, symbol, fetchChain]);

  useEffect(() => {
    api.getFnoLotSizes().then(d => setLotSizes(d.lot_sizes)).catch(() => {});
    api.getFnoParticipantOI(90).then(rows => setParticipantOI(rows)).catch(() => {});
  }, []);

  useEffect(() => () => { if (refreshPollRef.current) clearInterval(refreshPollRef.current); }, []);

  const commitSymbol = useCallback((sym: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setInputVal(sym);
    setSymbol(sym);
    setExpiry(null);
    setShowAll(false);
    fetchChain(sym);
  }, [fetchChain]);

  // Refresh = check NSE for a newer bhavcopy than what's stored, and pull only the missing day(s).
  // Bhavcopy is EOD-only, so this never returns live/intraday prices — just syncs up to the latest published file.
  const handleRefresh = async () => {
    if (refreshPollRef.current) return;
    setRefreshing(true);
    setRefreshMsg("Checking NSE for a newer file…");
    try {
      const res = await api.fnoRefresh(symbol);
      if (res.status === "up_to_date") {
        setRefreshMsg(`Already up to date — data as of ${res.latest_date ?? "—"}`);
        setRefreshing(false);
        setTimeout(() => setRefreshMsg(null), 5000);
        return;
      }
      if (res.job_id) {
        setRefreshMsg("Fetching the latest day(s) from NSE…");
        refreshPollRef.current = setInterval(async () => {
          try {
            const job = await api.fnoFetchJob(res.job_id!);
            if (job.status === "done") {
              clearInterval(refreshPollRef.current!); refreshPollRef.current = null;
              setRefreshing(false);
              setRefreshMsg(`Updated — ${job.inserted.toLocaleString()} new rows synced`);
              fetchChain(symbol, expiry ?? undefined);
              setTimeout(() => setRefreshMsg(null), 5000);
            } else if (job.status === "empty") {
              clearInterval(refreshPollRef.current!); refreshPollRef.current = null;
              setRefreshing(false);
              setRefreshMsg("No new data yet — NSE hasn't published today's file (market may still be live)");
              setTimeout(() => setRefreshMsg(null), 6000);
            }
          } catch {
            clearInterval(refreshPollRef.current!); refreshPollRef.current = null;
            setRefreshing(false);
            setRefreshMsg(null);
          }
        }, 1500);
      } else {
        setRefreshing(false);
        setRefreshMsg(null);
      }
    } catch {
      setRefreshing(false);
      setRefreshMsg("Refresh failed — try again");
      setTimeout(() => setRefreshMsg(null), 5000);
    }
  };

  const chain = chainData?.chain ?? [];
  const atmRow = chain.find(r => r.is_atm);
  const lotSize = lotSizes[symbol] ?? null;

  const fiiData = participantOI.filter(r => r.participant_type === "FII" && r.instrument === "FUTURE_INDEX");
  const diiData = participantOI.filter(r => r.participant_type === "DII" && r.instrument === "FUTURE_INDEX");

  // lightweight-charts requires ascending time order
  const participantSeries = [
    {
      label: "FII Net",
      color: "#3b82f6",
      data: [...fiiData].sort((a, b) => a.date < b.date ? -1 : 1).map(r => ({ date: r.date, value: r.net_oi })),
    },
    {
      label: "DII Net",
      color: "#10b981",
      data: [...diiData].sort((a, b) => a.date < b.date ? -1 : 1).map(r => ({ date: r.date, value: r.net_oi })),
    },
  ];

  return (
    <div className="space-y-5">
      {/* Header + page-level tab */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <BarChart2 size={20} className="text-blue-600" />
          <h1 className="text-lg font-bold text-slate-800">F&O Analytics</h1>
          {pageTab === "options" && chainData?.data_date && (
            <span className="text-xs text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">
              Data as of {chainData.data_date}
            </span>
          )}
          {refreshMsg && (
            <span className="text-xs text-blue-600 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded-full">
              {refreshMsg}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* Options / Futures toggle */}
          <div className="flex rounded-lg border border-slate-200 overflow-hidden">
            {(["options", "futures"] as const).map(t => (
              <button key={t} onClick={() => setPageTab(t)}
                className={`px-4 py-1.5 text-xs font-semibold transition-colors capitalize ${pageTab === t ? "bg-blue-600 text-white" : "text-slate-500 hover:bg-slate-50"}`}>
                {t === "options" ? "Options" : "Futures"}
              </button>
            ))}
          </div>
          {pageTab === "options" && (
            <button onClick={handleRefresh} disabled={loading || refreshing}
              title="Pulls only the day(s) NSE has published since your last fetch — bhavcopy is EOD-only, so this never shows live/intraday prices"
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-slate-200 rounded-lg bg-white text-slate-500 hover:text-blue-600 hover:border-blue-300 transition-all disabled:opacity-50">
              <RefreshCw size={12} className={refreshing ? "animate-spin" : ""} />
              Refresh
            </button>
          )}
        </div>
      </div>

      {/* Symbol input — shared between tabs */}
      <div className="flex items-center gap-3 flex-wrap">
        <SymbolAutocomplete
          value={inputVal}
          onChange={setInputVal}
          onCommit={commitSymbol}
          placeholder="Symbol (NIFTY, RELIANCE…)"
        />

        {pageTab === "options" && chainData && chainData.expiry_dates.length > 0 && (
          <select
            value={expiry ?? chainData.expiry_dates[0]}
            onChange={e => setExpiry(e.target.value)}
            className="bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300">
            {chainData.expiry_dates.map(d => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        )}

        {pageTab === "options" && (
          <div className="flex rounded-lg border border-slate-200 overflow-hidden">
            {(["table", "chart"] as const).map(v => (
              <button key={v} onClick={() => setViewMode(v)}
                className={`px-3 py-1.5 text-xs font-medium transition-colors capitalize ${viewMode === v ? "bg-blue-50 text-blue-600" : "text-slate-500 hover:bg-slate-50"}`}>
                {v === "table" ? "Chain Table" : "OI Chart"}
              </button>
            ))}
          </div>
        )}

        {INDEX_SYMBOLS.map(s => (
          <button key={s} onClick={() => setInputVal(s)}
            className={`px-2.5 py-1 text-xs font-medium rounded-lg border transition-colors ${symbol === s ? "bg-blue-50 text-blue-600 border-blue-200" : "text-slate-500 border-slate-200 hover:bg-slate-50"}`}>
            {s}
          </button>
        ))}
      </div>

      {/* Futures tab content */}
      {pageTab === "futures" && <FuturesTab symbol={symbol} />}

      {/* ── Options tab content ─────────────────────────────────── */}
      {pageTab === "options" && error && (
        error.includes("No F&O data") || error.includes("sync") ? (
          <FnoFetchPanel symbol={symbol} isIndex={INDEX_SYMBOLS.includes(symbol)} onDone={() => { setError(null); fetchChain(symbol); }} />
        ) : (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800">
            <strong>Data unavailable:</strong> {error}
          </div>
        )
      )}

      {pageTab === "options" && loading && (
        <div className="space-y-2">
          {[...Array(8)].map((_, i) => (
            <div key={i} className="h-6 bg-slate-100 rounded animate-pulse" />
          ))}
        </div>
      )}

      {/* Key Metrics row */}
      {pageTab === "options" && !loading && chainData && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            {[
              {
                label: "PCR (OI)", value: <PcrBadge pcr={chainData.pcr} />,
                sub: "Put-Call Ratio — >1.2 bullish, <0.8 bearish",
              },
              {
                label: "Max Pain", value: <span className="font-bold text-orange-600">{fmt(chainData.max_pain)}</span>,
                sub: "Strike where max options expire worthless",
              },
              {
                label: "ATM CE OI", value: <span className="font-bold text-blue-600">{atmRow?.ce_oi != null ? fmtK(atmRow.ce_oi) : "—"}</span>,
                sub: "ATM Call open interest (contracts)",
              },
              {
                label: "Lot Size", value: <span className="font-bold text-slate-700">{lotSize != null && lotSize > 0 ? lotSize : "—"}</span>,
                sub: `${symbol} contract size`,
              },
              {
                label: "Spot", value: <span className="font-bold text-slate-800">{fmt(chainData.spot, 2)}</span>,
                sub: `${symbol} last close`,
              },
            ].map(m => (
              <div key={m.label} className="bg-white border border-slate-200 rounded-xl p-3 space-y-0.5">
                <div className="text-[10px] text-slate-400 uppercase tracking-wide font-semibold">{m.label}</div>
                <div className="text-sm">{m.value}</div>
                <div className="text-[9px] text-slate-400 leading-tight">{m.sub}</div>
              </div>
            ))}
          </div>

          {/* Key Resistance / Support — above the chain */}
          {chain.length > 0 && (() => {
            const maxCeRow = [...chain].sort((a, b) => (b.ce_oi ?? 0) - (a.ce_oi ?? 0))[0];
            const maxPeRow = [...chain].sort((a, b) => (b.pe_oi ?? 0) - (a.pe_oi ?? 0))[0];
            return (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 flex items-start gap-3">
                  <TrendingDown size={18} className="text-emerald-600 mt-0.5 shrink-0" />
                  <div>
                    <div className="text-xs font-semibold text-emerald-700">Key Resistance (Highest CE OI)</div>
                    <div className="text-lg font-bold text-emerald-800">{fmt(maxCeRow?.strike)}</div>
                    <div className="text-[11px] text-emerald-600">{fmtK(maxCeRow?.ce_oi)} contracts — sellers defending this level</div>
                  </div>
                </div>
                <div className="bg-red-50 border border-red-200 rounded-xl p-3 flex items-start gap-3">
                  <TrendingUp size={18} className="text-red-600 mt-0.5 shrink-0" />
                  <div>
                    <div className="text-xs font-semibold text-red-700">Key Support (Highest PE OI)</div>
                    <div className="text-lg font-bold text-red-800">{fmt(maxPeRow?.strike)}</div>
                    <div className="text-[11px] text-red-600">{fmtK(maxPeRow?.pe_oi)} contracts — buyers defending this level</div>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* Chain content */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-100">
              <div className="text-sm font-semibold text-slate-700">
                Option Chain — {chainData.symbol} · {chainData.expiry}
              </div>
              <button
                onClick={() => setShowAll(v => !v)}
                className="flex items-center gap-1 text-xs text-slate-500 hover:text-blue-600 transition-colors">
                {showAll ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                {showAll ? "Show ±15% only" : "Show all strikes"}
              </button>
            </div>
            <div className="p-3">
              {viewMode === "table" ? (
                <OptionTable chain={chain} spot={chainData.spot} showAll={showAll} />
              ) : (
                <OIButterflyChart chain={chain} maxPain={chainData.max_pain} spot={chainData.spot} />
              )}
            </div>
          </div>
        </>
      )}

      {/* Participant OI Trend */}
      {pageTab === "options" && participantSeries.some(s => s.data.length > 0) && (
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <Minus size={14} className="text-blue-500" />
            <h2 className="text-sm font-semibold text-slate-700">FII / DII Index Futures Net Position</h2>
            <span className="text-[10px] text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">FUTURE_INDEX · Last 90 days</span>
          </div>
          <div className="text-[10px] text-slate-400 mb-2 leading-relaxed">
            Net = Long − Short (contracts). Positive = net long (bullish), Negative = net short (bearish).
            FII positioning is a leading sentiment indicator for Nifty direction.
          </div>
          <MacroLineChart series={participantSeries} height={220} />
        </div>
      )}

      {/* Empty state when no sync has happened */}
      {pageTab === "options" && !loading && !error && !chainData && (
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-8 text-center text-slate-500">
          <BarChart2 size={32} className="mx-auto mb-3 text-slate-300" />
          <div className="font-medium mb-1">Enter a symbol to view the option chain</div>
          <div className="text-sm text-slate-400">
            Try NIFTY, BANKNIFTY, or any F&O stock like RELIANCE, HDFCBANK
          </div>
        </div>
      )}
    </div>
  );
}
