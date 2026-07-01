import { useState, useEffect, useRef, useCallback } from "react";
import { BarChart2, TrendingUp, TrendingDown, Minus, RefreshCw, ChevronDown, ChevronUp, Download } from "lucide-react";
import { api, type OptionChainData, type OptionChainRow } from "../lib/api";
import MacroLineChart from "../components/MacroLineChart";

const INDEX_SYMBOLS = ["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY"];

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

function toIso(d: Date) {
  return d.toISOString().slice(0, 10);
}

function FetchHistoryPanel({ onDone }: { onDone: () => void }) {
  const today = new Date();
  const thirtyDaysAgo = new Date(today);
  thirtyDaysAgo.setDate(today.getDate() - 30);

  const [fromDate, setFromDate] = useState(toIso(thirtyDaysAgo));
  const [toDate, setToDate] = useState(toIso(today));
  const [jobId, setJobId] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number; inserted: number; status: string; current_date: string } | null>(null);
  const [fetching, setFetching] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPoll = () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } };

  useEffect(() => () => stopPoll(), []);

  const startFetch = async () => {
    setErr(null);
    setFetching(true);
    setProgress(null);
    try {
      const res = await api.fnoFetchHistory(fromDate, toDate);
      setJobId(res.job_id);
      setProgress({ done: 0, total: res.total_days, inserted: 0, status: "queued", current_date: "" });
      pollRef.current = setInterval(async () => {
        try {
          const job = await api.fnoFetchJob(res.job_id);
          setProgress(job);
          if (job.status === "done" || job.status === "empty") {
            stopPoll();
            setFetching(false);
            if (job.status === "done") setTimeout(onDone, 800);
            else setErr("No data was fetched — NSE may not have files for this range. Try a more recent period.");
          }
        } catch { stopPoll(); setFetching(false); }
      }, 1500);
    } catch (e: unknown) {
      setFetching(false);
      setErr(e instanceof Error ? e.message : "Fetch failed");
    }
  };

  const pct = progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <div className="bg-blue-50 border border-blue-200 rounded-xl p-5 space-y-4">
      <div className="flex items-start gap-3">
        <div className="p-2 bg-blue-100 rounded-lg shrink-0 mt-0.5">
          <Download size={16} className="text-blue-600" />
        </div>
        <div>
          <div className="font-semibold text-blue-800 text-sm">Fetch Historical F&O Data</div>
          <div className="text-xs text-blue-600 mt-0.5 leading-relaxed">
            Downloads NSE bhavcopy (index options + futures) for the selected date range. Data is stored locally so the option chain loads instantly after.
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-[10px] text-blue-600 font-semibold uppercase tracking-wide">From</label>
          <input
            type="date" value={fromDate} onChange={e => setFromDate(e.target.value)}
            disabled={fetching}
            className="border border-blue-200 bg-white rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 disabled:opacity-50" />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[10px] text-blue-600 font-semibold uppercase tracking-wide">To</label>
          <input
            type="date" value={toDate} onChange={e => setToDate(e.target.value)}
            disabled={fetching}
            className="border border-blue-200 bg-white rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 disabled:opacity-50" />
        </div>
        <div className="flex gap-2 items-end">
          {(["1W", "1M", "3M", "6M"] as const).map(label => {
            const days = label === "1W" ? 7 : label === "1M" ? 30 : label === "3M" ? 90 : 180;
            return (
              <button key={label} disabled={fetching}
                onClick={() => { const d = new Date(); d.setDate(d.getDate() - days); setFromDate(toIso(d)); setToDate(toIso(today)); }}
                className="px-2.5 py-1.5 text-xs font-medium border border-blue-200 bg-white text-blue-600 hover:bg-blue-100 rounded-lg transition-colors disabled:opacity-50">
                {label}
              </button>
            );
          })}
        </div>
        <button
          onClick={startFetch}
          disabled={fetching || !fromDate || !toDate}
          className="flex items-center gap-1.5 px-4 py-1.5 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors whitespace-nowrap">
          <Download size={14} className={fetching ? "animate-bounce" : ""} />
          {fetching ? "Fetching…" : "Fetch Data"}
        </button>
      </div>

      {progress && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs text-blue-700">
            <span>{progress.done} / {progress.total} days processed · {progress.inserted.toLocaleString()} rows inserted</span>
            {progress.current_date && <span className="text-blue-500">{progress.current_date}</span>}
          </div>
          <div className="w-full bg-blue-100 rounded-full h-2">
            <div className="bg-blue-500 h-2 rounded-full transition-all duration-300" style={{ width: `${pct}%` }} />
          </div>
          {progress.status === "done" && (
            <div className="text-xs text-emerald-600 font-medium">Done! Loading option chain…</div>
          )}
        </div>
      )}

      {err && <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{err}</div>}

      {!jobId && (
        <div className="text-[10px] text-blue-500 leading-relaxed">
          Tip: Start with a recent 1–3 month window. Only index instruments (NIFTY, BANKNIFTY, FINNIFTY, MIDCPNIFTY) are stored — roughly 6K rows/day.
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

export default function FnO() {
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

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BarChart2 size={20} className="text-blue-600" />
          <h1 className="text-lg font-bold text-slate-800">F&O Analytics</h1>
          {chainData?.data_date && (
            <span className="text-xs text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">
              EOD {chainData.data_date}
            </span>
          )}
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => fetchChain(symbol, expiry ?? undefined)}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-slate-200 rounded-lg bg-white text-slate-500 hover:text-blue-600 hover:border-blue-300 transition-all disabled:opacity-50">
            <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
            Refresh
          </button>
        </div>
      </div>

      {/* Symbol + Expiry selector */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative">
          <input
            value={inputVal}
            onChange={e => setInputVal(e.target.value.toUpperCase())}
            placeholder="Symbol (NIFTY, RELIANCE…)"
            className="bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm font-semibold w-52 focus:outline-none focus:ring-2 focus:ring-blue-300 focus:border-blue-300"
          />
        </div>

        {chainData && chainData.expiry_dates.length > 0 && (
          <select
            value={expiry ?? chainData.expiry_dates[0]}
            onChange={e => setExpiry(e.target.value)}
            className="bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300">
            {chainData.expiry_dates.map(d => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        )}

        <div className="flex rounded-lg border border-slate-200 overflow-hidden">
          {(["table", "chart"] as const).map(v => (
            <button key={v} onClick={() => setViewMode(v)}
              className={`px-3 py-1.5 text-xs font-medium transition-colors capitalize ${viewMode === v ? "bg-blue-50 text-blue-600" : "text-slate-500 hover:bg-slate-50"}`}>
              {v === "table" ? "Chain Table" : "OI Chart"}
            </button>
          ))}
        </div>

        {INDEX_SYMBOLS.map(s => (
          <button key={s} onClick={() => { setInputVal(s); }}
            className={`px-2.5 py-1 text-xs font-medium rounded-lg border transition-colors ${symbol === s ? "bg-blue-50 text-blue-600 border-blue-200" : "text-slate-500 border-slate-200 hover:bg-slate-50"}`}>
            {s}
          </button>
        ))}
      </div>

      {/* Error state */}
      {error && (
        error.includes("No F&O data") || error.includes("sync") ? (
          <FetchHistoryPanel onDone={() => { setError(null); fetchChain(symbol); }} />
        ) : (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800">
            <strong>Data unavailable:</strong> {error}
          </div>
        )
      )}

      {/* Loading */}
      {loading && (
        <div className="space-y-2">
          {[...Array(8)].map((_, i) => (
            <div key={i} className="h-6 bg-slate-100 rounded animate-pulse" />
          ))}
        </div>
      )}

      {/* Key Metrics row */}
      {!loading && chainData && (
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
      {participantSeries.some(s => s.data.length > 0) && (
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
      {!loading && !error && !chainData && (
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
