import { useState, useEffect, useRef } from "react";
import { Download } from "lucide-react";
import { api } from "../lib/api";

export function toIso(d: Date) {
  return d.toISOString().slice(0, 10);
}

export const INDEX_SYMBOLS = ["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY"];

interface Props {
  symbol: string;
  isIndex: boolean;
  onDone: () => void;
  /**
   * Controlled from/to date range — pass these (with the setters) when the caller
   * already shows its own From Date/To Date fields (e.g. the Backtest page's
   * straddle/spread panels), so this panel doesn't duplicate a second, separate
   * date range. The 1W/1M/3M/6M presets then write directly into the caller's
   * own fields instead of an internal, hidden copy. Omit both to fall back to an
   * internal default (used by the standalone F&O option-chain page).
   */
  fromDate?: string;
  toDate?: string;
  onFromDateChange?: (d: string) => void;
  onToDateChange?: (d: string) => void;
}

/**
 * Shared "fetch NSE bhavcopy for a date range" panel — used by the F&O page's
 * option chain view and the Backtest page's Options (straddle/strangle) mode.
 */
export default function FnoFetchPanel({ symbol, isIndex, onDone, fromDate: fromDateProp, toDate: toDateProp, onFromDateChange, onToDateChange }: Props) {
  const today = new Date();
  const thirtyDaysAgo = new Date(today);
  thirtyDaysAgo.setDate(today.getDate() - 30);

  const controlled = fromDateProp != null && toDateProp != null;
  const [internalFromDate, setInternalFromDate] = useState(toIso(thirtyDaysAgo));
  const [internalToDate, setInternalToDate] = useState(toIso(today));

  const fromDate = controlled ? fromDateProp! : internalFromDate;
  const toDate = controlled ? toDateProp! : internalToDate;
  const setFromDate = controlled ? onFromDateChange! : setInternalFromDate;
  const setToDate = controlled ? onToDateChange! : setInternalToDate;

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
      const res = await api.fnoFetchHistory(fromDate, toDate, isIndex ? null : symbol);
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
          <div className="font-semibold text-blue-800 text-sm">Fetch Historical F&O Data{symbol ? ` — ${symbol}` : ""}</div>
          <div className="text-xs text-blue-600 mt-0.5 leading-relaxed">
            Downloads NSE bhavcopy and extracts {symbol ? `${symbol}'s` : ""} option chain (all expiries) for the
            {controlled
              ? " From Date / To Date range set above."
              : " selected date range."} Data is stored locally so it loads instantly after.
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        {!controlled && (
          <>
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
          </>
        )}
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
          {isIndex
            ? "Tip: Start with a recent 1–3 month window — roughly 6K rows/day for index options."
            : "Tip: Start with a recent 1–3 month window. Stock option chains are bulkier than index ones — roughly 200–300 rows/day."}
        </div>
      )}
    </div>
  );
}
