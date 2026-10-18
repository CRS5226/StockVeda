import { useEffect, useRef, useState } from "react";
import { AlertCircle, Download } from "lucide-react";
import { api, type TimeframeCandles, type TimeframeInfo } from "../lib/api";
import { addDays, candlesForRange, fromDateForCandles, isoDate } from "../lib/timeframes";
import BacktestChart, { NO_SMC, type SmcToggles } from "./BacktestChart";
import SymbolCombobox from "./SymbolCombobox";

type OhlcvRow = { date: string; open: number; high: number; low: number; close: number };

// Candle count a timeframe opens with; the date range follows from it.
const DEFAULT_CANDLES: Record<string, number> = { "1D": 250, "1W": 150, "1M": 60 };
const DEFAULT_INTRADAY_CANDLES = 300;
const FALLBACK_BARS_PER_DAY = 1;

interface Concept {
  key: keyof SmcToggles;
  label: string;
  hint: string;
  legend: { color: string; text: string }[];
}

// Grouped as in issue #79; each concept toggles independently.
const GROUPS: { title: string; concepts: Concept[] }[] = [
  {
    title: "Structure",
    concepts: [
      {
        key: "bos", label: "BOS", hint: "break of structure — body close beyond the confirmed HH / LL",
        legend: [
          { color: "bg-emerald-600", text: "BOS · bullish — closes above the HH, up-trend continues" },
          { color: "bg-red-600", text: "BOS · bearish — closes below the LL, down-trend continues" },
        ],
      },
      {
        key: "choch", label: "ChoCH", hint: "change of character — body close beyond the protected HL / LH",
        legend: [{ color: "bg-amber-500", text: "ChoCH — closes through the protected HL / LH, the trend flips" }],
      },
      {
        key: "idm", label: "IDM", hint: "inducement — nearest swing left of a high/low; taking it confirms the HH / LL",
        legend: [{ color: "bg-fuchsia-500", text: "IDM — inducement swing, drawn to the bar that took it" }],
      },
      {
        key: "points", label: "HH / HL / LH / LL", hint: "structure points, shown only once confirmed (HH/LL by IDM, HL/LH by BOS)",
        legend: [
          { color: "bg-green-700", text: "HH · HL — up-trend points" },
          { color: "bg-red-700", text: "LH · LL — down-trend points" },
        ],
      },
    ],
  },
  {
    title: "Blocks",
    concepts: [
      {
        key: "orderBlocks", label: "Order blocks", hint: "last opposing candle before an impulse",
        legend: [
          { color: "bg-emerald-600", text: "Bullish OB (green zone)" },
          { color: "bg-red-600", text: "Bearish OB (red zone)" },
        ],
      },
      {
        key: "breaker", label: "Breaker block", hint: "order block that failed, then flips polarity on a retest",
        legend: [{ color: "bg-orange-500", text: "BRK — breaker (block failed, now flips)" }],
      },
      {
        key: "reclaimed", label: "Reclaimed block", hint: "order block broken, then price closed back on its original side",
        legend: [{ color: "bg-lime-600", text: "RCL — reclaimed (block held after a break)" }],
      },
      {
        key: "mitigation", label: "Mitigation block", hint: "order block that absorbed price on a revisit, as intended",
        legend: [{ color: "bg-slate-500", text: "MIT — mitigation (block absorbed price)" }],
      },
    ],
  },
  {
    title: "Liquidity & imbalance",
    concepts: [
      {
        key: "liquidity", label: "Liquidity", hint: "equal highs/lows and sweeps",
        legend: [{ color: "bg-cyan-500", text: "EQH / EQL — equal highs / lows · SWEEP — liquidity grab" }],
      },
      {
        key: "fvg", label: "FVG", hint: "fair value gap",
        legend: [
          { color: "bg-blue-500", text: "Bullish FVG" },
          { color: "bg-purple-500", text: "Bearish FVG" },
        ],
      },
    ],
  },
];

const ALL_KEYS = GROUPS.flatMap((g) => g.concepts.map((c) => c.key));

export default function SmcPanel() {
  const [symbol, setSymbol] = useState("");
  const [loaded, setLoaded] = useState("");
  const [timeframes, setTimeframes] = useState<TimeframeInfo[]>([]);
  const [tf, setTf] = useState("1D");
  const [toDate, setToDate] = useState(() => isoDate(new Date()));
  const [candles, setCandles] = useState(DEFAULT_CANDLES["1D"]);
  const [fromDate, setFromDate] = useState("");
  const [clampNote, setClampNote] = useState("");
  const [ohlcv, setOhlcv] = useState<OhlcvRow[]>([]);
  const [result, setResult] = useState<TimeframeCandles | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [fetchState, setFetchState] = useState<{ running: boolean; message: string }>({ running: false, message: "" });
  const [smc, setSmc] = useState<SmcToggles>({ ...NO_SMC, bos: true, choch: true, idm: true });
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const info = timeframes.find((t) => t.key === tf);
  const barsPerDay = info?.bars_per_day ?? FALLBACK_BARS_PER_DAY;

  const stopPoll = () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } };
  useEffect(() => () => stopPoll(), []);

  // Clamp a range start to what the data source can supply (yfinance caps intraday lookback).
  const clampFrom = (from: string, tfInfo: TimeframeInfo | undefined, to: string) => {
    const cap = tfInfo?.max_lookback_days;
    const earliest = cap ? addDays(isoDate(new Date()), -cap) : null;
    if (earliest && from < earliest) {
      setClampNote(`${tfInfo?.key} history is limited to the last ${cap} days — range starts ${earliest}.`);
      return earliest;
    }
    setClampNote("");
    return from > to ? to : from;
  };

  const applyCandles = (n: number, to: string, tfInfo: TimeframeInfo | undefined) => {
    const bpd = tfInfo?.bars_per_day ?? FALLBACK_BARS_PER_DAY;
    const from = clampFrom(fromDateForCandles(n, to, bpd), tfInfo, to);
    setFromDate(from);
    setCandles(candlesForRange(from, to, bpd));
  };

  useEffect(() => {
    api.getTimeframes()
      .then((list) => {
        setTimeframes(list);
        applyCandles(DEFAULT_CANDLES["1D"], toDate, list.find((t) => t.key === "1D"));
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load timeframes"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const changeTf = (key: string) => {
    const next = timeframes.find((t) => t.key === key);
    setTf(key);
    applyCandles(DEFAULT_CANDLES[key] ?? DEFAULT_INTRADAY_CANDLES, toDate, next);
  };
  const changeCandles = (n: number) => applyCandles(Math.max(1, n || 1), toDate, info);
  const changeFrom = (from: string) => {
    if (!from) return;
    const clamped = clampFrom(from, info, toDate);
    setFromDate(clamped);
    setCandles(candlesForRange(clamped, toDate, barsPerDay));
  };
  const changeTo = (to: string) => {
    if (!to) return;
    setToDate(to);
    const clamped = clampFrom(fromDate, info, to);
    setFromDate(clamped);
    setCandles(candlesForRange(clamped, to, barsPerDay));
  };

  const load = async (sym: string) => {
    const s = sym.trim().toUpperCase();
    if (!s || !fromDate) return;
    setLoading(true);
    setError("");
    try {
      const res = await api.getTimeframeCandles(s, tf, { from: fromDate, to: toDate });
      setResult(res);
      setOhlcv(res.bars.map(({ date, open, high, low, close }) => ({ date, open, high, low, close })));
      setLoaded(s);
    } catch (e) {
      setOhlcv([]);
      setResult(null);
      setLoaded("");
      setError(e instanceof Error ? e.message : "Failed to load candles");
    } finally {
      setLoading(false);
    }
  };

  // Re-load when the timeframe or range changes for an already-loaded stock, debounced so
  // typing a candle count does not query on every keystroke.
  useEffect(() => {
    if (!loaded) return;
    const id = setTimeout(() => load(loaded), 400);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tf, fromDate, toDate]);

  // Download the bars the range needs. Intraday goes through the existing Yahoo fetch job;
  // daily-based timeframes use the daily candles route, which backfills from Yahoo itself.
  const fetchMissing = async () => {
    if (!result || !loaded) return;
    setFetchState({ running: true, message: "" });
    const done = (message: string) => { stopPoll(); setFetchState({ running: false, message }); load(loaded); };
    try {
      if (result.fetch.kind === "daily") {
        const rows = await api.getCandles(loaded, fromDate);
        done(`Fetched daily history — ${rows.length.toLocaleString()} bars now stored.`);
        return;
      }
      const job = await api.fetchIntraday(loaded, result.fetch.interval, result.fetch.days);
      pollRef.current = setInterval(async () => {
        try {
          const st = await api.intradayFetchJob(job.job_id);
          if (st.status === "done") done(`Fetched ${st.inserted.toLocaleString()} ${result.fetch.interval} bars.`);
          else if (st.status === "empty") done("Yahoo returned no bars for this range.");
          else if (st.status === "error") done(st.error ?? "Fetch failed.");
        } catch (e) {
          done(e instanceof Error ? e.message : "Fetch failed.");
        }
      }, 1500);
    } catch (e) {
      done(e instanceof Error ? e.message : "Fetch failed.");
    }
  };

  const toggle = (key: keyof SmcToggles) => setSmc((prev) => ({ ...prev, [key]: !prev[key] }));
  const setAll = (on: boolean) => setSmc(Object.fromEntries(ALL_KEYS.map((k) => [k, on])) as unknown as SmcToggles);
  const activeLegends = GROUPS.flatMap((g) => g.concepts).filter((c) => smc[c.key]);

  return (
    <section className="bg-white border border-slate-200 rounded-xl shadow-sm p-4">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-sm font-semibold text-slate-700">SMC — Smart Money Concepts</span>
      </div>
      <p className="text-xs text-slate-400 mb-4">
        Chart overlays only — no signals or trades. Pick a stock, then switch each concept on or off.
      </p>

      <div className="flex flex-wrap items-end gap-3 mb-4">
        <div className="w-64">
          <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-[0.08em] mb-1">Stock</div>
          <SymbolCombobox value={symbol} onChange={setSymbol} placeholder="Search symbol…" />
        </div>
        <div>
          <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-[0.08em] mb-1">Timeframe</div>
          <select value={tf} onChange={(e) => changeTf(e.target.value)} disabled={!timeframes.length}
            className="border border-slate-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 bg-white">
            {timeframes.map((t) => <option key={t.key} value={t.key}>{t.key}</option>)}
          </select>
        </div>
        <div>
          <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-[0.08em] mb-1">From</div>
          <input type="date" value={fromDate} max={toDate} onChange={(e) => changeFrom(e.target.value)} className="border border-slate-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300" />
        </div>
        <div>
          <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-[0.08em] mb-1">To</div>
          <input type="date" value={toDate} max={isoDate(new Date())} onChange={(e) => changeTo(e.target.value)} className="border border-slate-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300" />
        </div>
        <div>
          <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-[0.08em] mb-1">Candles</div>
          <input type="number" min={1} value={candles} onChange={(e) => changeCandles(parseInt(e.target.value))}
            className="border border-slate-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 w-24" />
        </div>
        <button onClick={() => load(symbol)} disabled={!symbol.trim() || loading}
          className="px-4 py-2 rounded-lg text-sm font-medium bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
          {loading ? "Loading…" : "Show chart"}
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2 mb-4">
          <AlertCircle size={14} className="shrink-0" />{error}
        </div>
      )}

      {clampNote && (
        <div className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 mb-4">{clampNote}</div>
      )}

      {result && (
        <div className="text-xs text-slate-500 bg-slate-50 border border-slate-100 rounded-lg px-3 py-2 mb-4">
          {result.status.total_bars > 0 ? (
            <>
              <span className="font-medium text-slate-700">{loaded} · {result.interval}</span> — stored {result.status.earliest} → {result.status.latest}
              {" "}({result.status.total_bars.toLocaleString()} bars) · showing {result.bars.length.toLocaleString()}
            </>
          ) : (
            <><span className="font-medium text-slate-700">{loaded} · {result.interval}</span> — no data stored yet</>
          )}
        </div>
      )}

      {result && result.missing.total > 0 && (
        <div className="flex flex-wrap items-center gap-3 text-xs text-blue-800 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 mb-4">
          <Download size={14} className="shrink-0" />
          <span className="flex-1 min-w-48">
            About <strong>{result.missing.total.toLocaleString()}</strong> {result.interval} bars are missing for this range
            {result.missing.before > 0 && result.missing.after > 0
              ? ` (${result.missing.before.toLocaleString()} before, ${result.missing.after.toLocaleString()} after the stored data)`
              : result.missing.before > 0 ? " (before the stored data)" : " (after the stored data)"}.
            {result.max_lookback_days ? ` Yahoo only serves the last ${result.max_lookback_days} days at this timeframe.` : ""}
          </span>
          <button onClick={fetchMissing} disabled={fetchState.running}
            className="px-3 py-1.5 rounded-lg font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition-colors">
            {fetchState.running ? "Fetching…" : "Fetch missing data"}
          </button>
          {fetchState.running && (
            <div className="basis-full w-full bg-blue-100 rounded-full h-1.5 overflow-hidden">
              <div className="bg-blue-500 h-1.5 w-1/3 rounded-full animate-pulse" />
            </div>
          )}
        </div>
      )}
      {fetchState.message && !fetchState.running && (
        <div className="text-xs text-slate-500 mb-4">{fetchState.message}</div>
      )}

      <div className="grid gap-4 sm:grid-cols-3 mb-4">
        {GROUPS.map((g) => (
          <div key={g.title} className="border border-slate-100 rounded-lg p-3">
            <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-[0.08em] mb-2">{g.title}</div>
            <div className="flex flex-col gap-2">
              {g.concepts.map((c) => (
                <label key={c.key} className="flex items-start gap-2 cursor-pointer select-none" title={c.hint}>
                  <input type="checkbox" checked={smc[c.key]} onChange={() => toggle(c.key)} className="w-3.5 h-3.5 mt-0.5" />
                  <span className="min-w-0">
                    <span className="block text-xs font-medium text-slate-700 leading-tight">{c.label}</span>
                    <span className="block text-[10px] text-slate-400 leading-tight">{c.hint}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="flex gap-3 text-xs mb-3">
        <button onClick={() => setAll(true)} className="text-blue-600 hover:underline">Select all</button>
        <button onClick={() => setAll(false)} className="text-slate-500 hover:underline">Clear</button>
      </div>

      {ohlcv.length > 0 ? (
        <div className="border border-slate-200 rounded-lg overflow-hidden">
          <div className="px-3 py-1.5 text-xs font-semibold text-slate-600 bg-slate-50 border-b border-slate-100">{loaded} · {result?.interval ?? tf}</div>
          <BacktestChart symbol={loaded} ohlcv={ohlcv} smc={smc} />
          {activeLegends.length > 0 && (
            <div className="flex gap-x-4 gap-y-1 px-3 py-1.5 text-[10px] text-slate-400 border-t border-slate-100 bg-slate-50/50 flex-wrap">
              {activeLegends.flatMap((c) => c.legend).map((l) => (
                <span key={l.text} className="flex items-center gap-1">
                  <span className={`inline-block w-4 h-1 rounded-full ${l.color}`} />{l.text}
                </span>
              ))}
            </div>
          )}
        </div>
      ) : (
        !loading && !error && (
          <div className="text-center text-xs text-slate-400 py-12 border border-dashed border-slate-200 rounded-lg">
            Search for a stock, pick a timeframe and press “Show chart”.
          </div>
        )
      )}
    </section>
  );
}
