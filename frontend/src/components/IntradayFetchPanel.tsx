import { useEffect, useRef, useState } from "react";
import { Download } from "lucide-react";
import { api } from "../lib/api";

// yfinance's own lookback ceilings per interval — mirrors backend/data_sync/sync_intraday.py's
// MAX_LOOKBACK_DAYS so users see the real limit before submitting, not after a silent clamp.
const MAX_LOOKBACK_DAYS: Record<string, number> = { "1m": 7, "5m": 60, "15m": 60, "30m": 60, "60m": 730 };

/**
 * On-demand intraday OHLCV fetch panel for ORB — single-shot per symbol/interval
 * (unlike FnoFetchPanel's per-day bulk bhavcopy loop), since yfinance intraday is
 * one API call with a hard lookback ceiling that can't be bulk-backfilled.
 */
export default function IntradayFetchPanel({ symbol, interval, onDone }: { symbol: string; interval: string; onDone: () => void }) {
  const maxDays = MAX_LOOKBACK_DAYS[interval] ?? 60;
  const [days, setDays] = useState(Math.min(30, maxDays));
  const [progress, setProgress] = useState<{ done: number; total: number; inserted: number; status: string } | null>(null);
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
      const res = await api.fetchIntraday(symbol, interval, days);
      setProgress({ done: 0, total: 1, inserted: 0, status: "queued" });
      pollRef.current = setInterval(async () => {
        try {
          const job = await api.intradayFetchJob(res.job_id);
          setProgress(job);
          if (job.status === "done" || job.status === "empty" || job.status === "error") {
            stopPoll();
            setFetching(false);
            if (job.status === "done") setTimeout(onDone, 800);
            else if (job.status === "error") setErr(job.error ?? "Fetch failed");
            else setErr("No intraday data was returned — try a different symbol or interval.");
          }
        } catch { stopPoll(); setFetching(false); }
      }, 1500);
    } catch (e: unknown) {
      setFetching(false);
      setErr(e instanceof Error ? e.message : "Fetch failed");
    }
  };

  return (
    <div className="bg-blue-50 border border-blue-200 rounded-xl p-5 space-y-4">
      <div className="flex items-start gap-3">
        <div className="p-2 bg-blue-100 rounded-lg shrink-0 mt-0.5">
          <Download size={16} className="text-blue-600" />
        </div>
        <div>
          <div className="font-semibold text-blue-800 text-sm">Fetch Intraday Data{symbol ? ` — ${symbol}` : ""} ({interval})</div>
          <div className="text-xs text-blue-600 mt-0.5 leading-relaxed">
            Fetches recent intraday bars via Yahoo Finance for ORB backtesting. Lookback is limited by the
            interval — up to <strong>{maxDays} days</strong> for {interval} bars.
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-[10px] text-blue-600 font-semibold uppercase tracking-wide">Days (max {maxDays})</label>
          <input
            type="number" value={days} min={1} max={maxDays}
            onChange={(e) => setDays(Math.min(maxDays, Math.max(1, parseInt(e.target.value) || 1)))}
            disabled={fetching}
            className="border border-blue-200 bg-white rounded-lg px-3 py-1.5 text-sm w-24 focus:outline-none focus:ring-2 focus:ring-blue-300 disabled:opacity-50" />
        </div>
        <button
          onClick={startFetch}
          disabled={fetching || !symbol}
          className="flex items-center gap-1.5 px-4 py-1.5 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors whitespace-nowrap">
          <Download size={14} className={fetching ? "animate-bounce" : ""} />
          {fetching ? "Fetching…" : "Fetch Data"}
        </button>
      </div>

      {progress && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs text-blue-700">
            <span>{progress.status} · {progress.inserted.toLocaleString()} bars inserted</span>
          </div>
          <div className="w-full bg-blue-100 rounded-full h-2">
            <div className="bg-blue-500 h-2 rounded-full transition-all duration-300" style={{ width: `${progress.done ? 100 : 30}%` }} />
          </div>
          {progress.status === "done" && (
            <div className="text-xs text-emerald-600 font-medium">Done! Loading intraday data…</div>
          )}
        </div>
      )}

      {err && <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{err}</div>}
    </div>
  );
}
