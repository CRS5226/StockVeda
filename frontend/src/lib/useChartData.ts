import { useCallback, useEffect, useRef, useState } from "react";
import { api, type Candle, type TimeframeCandles, type TimeframeInfo } from "./api";
import { addDays, fromDateForCandles, isoDate } from "./timeframes";

// Candle count each timeframe opens with; the date range follows from it.
const DEFAULT_CANDLES: Record<string, number> = { "1D": 250, "1W": 150, "1M": 60 };
// Intraday opens with about ten trading days of bars (at least 300, at most 1,500), so a 5-minute chart is not just a few days.
const INTRADAY_DAYS = 10;
const MIN_INTRADAY_CANDLES = 300;
const MAX_INTRADAY_CANDLES = 1500;
const FALLBACK_TIMEFRAMES: TimeframeInfo[] = [
  { key: "5m", kind: "intraday", base_interval: "5m", bars_per_day: 75, max_lookback_days: 60 },
  { key: "1D", kind: "daily", base_interval: "1d", bars_per_day: 1, max_lookback_days: null },
  { key: "1W", kind: "daily", base_interval: "1d", bars_per_day: 1, max_lookback_days: null },
  { key: "1M", kind: "daily", base_interval: "1d", bars_per_day: 1, max_lookback_days: null },
];

export interface ChartData {
  timeframes: TimeframeInfo[];
  bars: Candle[];
  loading: boolean;
  error: string;
  /** Message from the last data download (auto or manual), if any. */
  notice: string;
  fetching: boolean;
  /** Download the bars the current range is missing. */
  fetchMissing: () => void;
  /** Fetch the bars newer than the last stored one (the "Sync data" button); says when there is nothing new. */
  sync: () => void;
}

/** Date range a timeframe opens with, clamped to what the data source can supply. */
function defaultRange(info: TimeframeInfo): { from: string; to: string } {
  const to = isoDate(new Date());
  const count = DEFAULT_CANDLES[info.key]
    ?? Math.min(MAX_INTRADAY_CANDLES, Math.max(MIN_INTRADAY_CANDLES, Math.round((info.bars_per_day || 1) * INTRADAY_DAYS)));
  let from = fromDateForCandles(count, to, info.bars_per_day || 1);
  if (info.max_lookback_days) {
    const earliest = addDays(to, -info.max_lookback_days);
    if (from < earliest) from = earliest;
  }
  return { from, to };
}

/**
 * Loads candles for one symbol + timeframe for the Charts page.
 * Daily-based timeframes with no stored bars are downloaded once automatically (the daily candles
 * route backfills from Yahoo); intraday downloads only happen when the user asks for them.
 */
export function useChartData(symbol: string, tf: string): ChartData {
  const [timeframes, setTimeframes] = useState<TimeframeInfo[]>(FALLBACK_TIMEFRAMES);
  const [bars, setBars] = useState<Candle[]>([]);
  const [result, setResult] = useState<TimeframeCandles | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [fetching, setFetching] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const autoTried = useRef("");
  // what was on screen when a sync started, so the result can say how many bars were added
  const syncBase = useRef<{ last: string | null } | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPoll = () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } };
  useEffect(() => () => stopPoll(), []);

  useEffect(() => {
    api.getTimeframes().then(setTimeframes).catch(() => { /* keep the daily fallback list */ });
  }, []);

  const info = timeframes.find((t) => t.key === tf);

  // Load candles whenever the symbol, timeframe or reload counter changes.
  useEffect(() => {
    if (!symbol || !info) return;
    let cancelled = false;
    const { from, to } = defaultRange(info);
    setLoading(true);
    setError("");
    api.getTimeframeCandles(symbol, tf, { from, to })
      .then((res) => {
        if (cancelled) return;
        setResult(res);
        setBars(res.bars);
        const base = syncBase.current;
        if (base) {
          syncBase.current = null;
          const added = base.last ? res.bars.filter((b) => b.date > base.last!).length : res.bars.length;
          setNotice(added > 0 ? `Fetched ${added.toLocaleString()} new bars.` : "No new bars are available yet.");
        }
      })
      .catch((e) => {
        if (cancelled) return;
        setResult(null);
        setBars([]);
        setError(e instanceof Error ? e.message : "Failed to load candles");
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [symbol, tf, info, reloadKey]);

  const finish = useCallback((message: string, failed = false) => {
    stopPoll();
    setFetching(false);
    setNotice(message);
    if (failed) syncBase.current = null; // keep the error message instead of a bar count
    setReloadKey((k) => k + 1);
  }, []);

  const fetchMissing = useCallback(async () => {
    if (!result || !info) return;
    const { from } = defaultRange(info);
    setFetching(true);
    setNotice("");
    try {
      if (result.fetch.kind === "daily") {
        const rows = await api.getCandles(symbol, from);
        finish(`Fetched daily history: ${rows.length.toLocaleString()} bars stored.`);
        return;
      }
      const job = await api.fetchIntraday(symbol, result.fetch.interval, result.fetch.days);
      pollRef.current = setInterval(async () => {
        try {
          const st = await api.intradayFetchJob(job.job_id);
          if (st.status === "done") finish(`Fetched ${st.inserted.toLocaleString()} ${result.fetch.interval} bars.`);
          else if (st.status === "empty") finish("Yahoo returned no bars for this range.", true);
          else if (st.status === "error") finish(st.error ?? "Fetch failed.", true);
        } catch (e) {
          finish(e instanceof Error ? e.message : "Fetch failed.", true);
        }
      }, 1500);
    } catch (e) {
      finish(e instanceof Error ? e.message : "Fetch failed.", true);
    }
  }, [result, info, symbol, finish]);

  const sync = useCallback(() => {
    if (!result || fetching || loading) return;
    if (bars.length > 0 && result.missing.after === 0) { setNotice("Already up to date."); return; }
    syncBase.current = { last: bars.length ? bars[bars.length - 1].date : null };
    fetchMissing();
  }, [result, fetching, loading, bars, fetchMissing]);

  // Auto-download once per symbol + timeframe when a daily-based chart has no bars at all.
  useEffect(() => {
    if (loading || !result || bars.length > 0 || fetching) return;
    if (result.fetch.kind !== "daily") return;
    const key = `${symbol}|${tf}`;
    if (autoTried.current === key) return;
    autoTried.current = key;
    fetchMissing();
  }, [loading, result, bars.length, fetching, symbol, tf, fetchMissing]);

  return { timeframes, bars, loading, error, notice, fetching, fetchMissing, sync };
}
