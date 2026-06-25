import { useEffect, useRef, useState, useCallback } from "react";
import { Search, X, ChevronDown, Play, AlertCircle, Plus, Trash2, BookmarkPlus, BarChart2 } from "lucide-react";
import { api, ConditionRow } from "../lib/api";
import { useBacktestStore, SavedRun } from "../store/useBacktestStore";
import BacktestChart from "../components/BacktestChart";

// ── helpers ────────────────────────────────────────────────────────────────

function fmt(n: number, dec = 0) {
  return n.toLocaleString("en-IN", { maximumFractionDigits: dec });
}

function pnlClass(n: number) {
  return n >= 0 ? "text-emerald-600" : "text-red-500";
}

// ── Strategy presets ───────────────────────────────────────────────────────

const PRESETS: { label: string; tip: string; conditions: ConditionRow[] }[] = [
  {
    label: "Trend Momentum",
    tip: "Strong trend + momentum flip — SMA200 regime filter avoids bear markets",
    conditions: [
      { left: "rsi_14",      operator: "above",         right: "50" },
      { left: "macd",        operator: "crosses_above",  right: "macd_signal" },
      { left: "close",       operator: "above",          right: "sma_200" },
      { left: "adx_14",      operator: "above",          right: "25" },
    ],
  },
  {
    label: "Volume Breakout",
    tip: "Price + RSI + unusual volume all confirm — avoids false breakouts",
    conditions: [
      { left: "close",        operator: "crosses_above", right: "sma_50" },
      { left: "rsi_14",       operator: "above",         right: "55" },
      { left: "volume_ratio", operator: "above",         right: "1.2" },
    ],
  },
  {
    label: "Golden Zone Buy",
    tip: "Pullback-to-SMA50 retest in uptrend — highest probability daily setup",
    conditions: [
      { left: "close",  operator: "crosses_above", right: "sma_50" },
      { left: "sma_50", operator: "above",          right: "sma_200" },
      { left: "rsi_14", operator: "above",          right: "40" },
      { left: "rsi_14", operator: "below",          right: "60" },
    ],
  },
  {
    label: "RSI Midline Surge",
    tip: "RSI crossing 50 with MACD hist positive is a strong continuation signal",
    conditions: [
      { left: "rsi_14",    operator: "crosses_above", right: "50" },
      { left: "macd_hist", operator: "above",          right: "0" },
      { left: "close",     operator: "above",          right: "ema_20" },
    ],
  },
  {
    label: "Mean Reversion",
    tip: "Oversold → turning — requires price AND momentum confirmation",
    conditions: [
      { left: "rsi_14",    operator: "crosses_above", right: "30" },
      { left: "close",     operator: "above",          right: "bb_lower" },
      { left: "macd_hist", operator: "above",          right: "0" },
    ],
  },
  {
    label: "EMA Ribbon Entry",
    tip: "All EMAs aligned up + fresh pullback entry + MACD momentum",
    conditions: [
      { left: "ema_20", operator: "above",          right: "ema_50" },
      { left: "close",  operator: "crosses_above",  right: "ema_20" },
      { left: "macd_hist", operator: "above",       right: "0" },
    ],
  },
  {
    label: "ADX Trend Entry",
    tip: "Only enters when ADX > 25 (genuinely trending, not ranging)",
    conditions: [
      { left: "adx_14", operator: "above",          right: "25" },
      { left: "macd",   operator: "crosses_above",  right: "macd_signal" },
      { left: "close",  operator: "above",          right: "sma_200" },
    ],
  },
  {
    label: "Pin Bar + Trend",
    tip: "Bullish pin bar rejection candle in an uptrend — candlestick + indicator combo",
    conditions: [
      { left: "cdl_pin_bar_bull", operator: "above", right: "0" },
      { left: "close",            operator: "above",  right: "sma_50" },
      { left: "rsi_14",           operator: "above",  right: "40" },
    ],
  },
  {
    label: "Engulfing Reversal",
    tip: "Bullish engulfing after a pullback — strong reversal pattern",
    conditions: [
      { left: "cdl_bull_engulf", operator: "above", right: "0" },
      { left: "rsi_14",         operator: "below",  right: "50" },
      { left: "close",          operator: "above",  right: "sma_200" },
    ],
  },
  {
    label: "MACD Cross",
    tip: "Classic MACD crossover — momentum shift signal",
    conditions: [{ left: "macd", operator: "crosses_above", right: "macd_signal" }],
  },
  {
    label: "Golden Cross",
    tip: "SMA50 crosses above SMA200 — long-term trend confirmation",
    conditions: [{ left: "sma_50", operator: "crosses_above", right: "sma_200" }],
  },
];

const INDICATOR_LABELS: Record<string, string> = {
  close: "Close Price", open: "Open", high: "High", low: "Low", volume: "Volume",
  rsi_14: "RSI (14)", sma_20: "SMA 20", sma_50: "SMA 50", sma_200: "SMA 200",
  ema_20: "EMA 20", ema_50: "EMA 50",
  macd: "MACD", macd_signal: "MACD Signal", macd_hist: "MACD Histogram",
  bb_upper: "BB Upper", bb_lower: "BB Lower", atr_14: "ATR (14)",
  adx_14: "ADX (14)", volume_ratio: "Volume Ratio",
  cdl_hammer: "Hammer Candle", cdl_bull_engulf: "Bullish Engulfing",
  cdl_inside_bar: "Inside Bar (NR4)", cdl_pin_bar_bull: "Pin Bar (Bull)",
};

const OPERATOR_LABELS: Record<string, string> = {
  crosses_above: "crosses above",
  crosses_below: "crosses below",
  above: "is greater than",
  below: "is less than",
};

// ── Symbol search ──────────────────────────────────────────────────────────

function SymbolSearch({ onAdd }: { onAdd: (sym: string) => void }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<{ symbol: string; name: string }[]>([]);
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(-1);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const search = useCallback((val: string) => {
    if (val.length < 1) { setResults([]); setOpen(false); setHighlighted(-1); return; }
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(async () => {
      try {
        const res = await api.searchSymbols(val);
        setResults(res.slice(0, 8));
        setOpen(res.length > 0);
        setHighlighted(0);
      } catch { setResults([]); }
    }, 180);
  }, []);

  useEffect(() => { search(q); }, [q, search]);

  const pick = (sym: string) => { onAdd(sym); setQ(""); setResults([]); setOpen(false); setHighlighted(-1); };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open || !results.length) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setHighlighted((h) => Math.min(h + 1, results.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHighlighted((h) => Math.max(h - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); const i = highlighted >= 0 ? highlighted : 0; if (results[i]) pick(results[i].symbol); }
    else if (e.key === "Escape") { setOpen(false); setHighlighted(-1); }
  };

  useEffect(() => {
    if (highlighted >= 0 && listRef.current)
      (listRef.current.children[highlighted] as HTMLElement)?.scrollIntoView({ block: "nearest" });
  }, [highlighted]);

  return (
    <div className="relative">
      <div className="flex items-center gap-2 bg-slate-100 rounded-lg px-3 py-2 focus-within:ring-2 focus-within:ring-blue-500 focus-within:bg-white border border-transparent focus-within:border-blue-300 transition-all">
        <Search size={14} className="text-slate-400 shrink-0" />
        <input value={q} onChange={(e) => setQ(e.target.value.toUpperCase())}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onFocus={() => results.length > 0 && setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="Search symbol to add…"
          className="flex-1 bg-transparent text-sm text-slate-800 placeholder-slate-400 outline-none min-w-0" />
      </div>
      {open && results.length > 0 && (
        <ul ref={listRef} className="absolute z-50 top-full mt-1 left-0 right-0 bg-white border border-slate-200 rounded-lg shadow-lg max-h-60 overflow-y-auto">
          {results.map((r, i) => (
            <li key={r.symbol}>
              <button onMouseDown={() => pick(r.symbol)} onMouseEnter={() => setHighlighted(i)}
                className={`w-full text-left px-3 py-2 text-sm flex items-center gap-3 transition-colors ${i === highlighted ? "bg-blue-50" : "hover:bg-blue-50"}`}>
                <span className="font-semibold text-blue-700 w-24 shrink-0">{r.symbol}</span>
                <span className="text-slate-500 text-xs truncate">{r.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Load watchlist dropdown ────────────────────────────────────────────────

function LoadWatchlistMenu() {
  const [open, setOpen] = useState(false);
  const { watchlists, loadWatchlistSymbols } = useBacktestStore();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg hover:border-blue-300 hover:bg-blue-50 transition-all">
        Load Watchlist <ChevronDown size={13} />
      </button>
      {open && (
        <div className="absolute top-full mt-1 right-0 z-50 bg-white border border-slate-200 rounded-xl shadow-lg min-w-48 py-1">
          {watchlists.length === 0 ? (
            <div className="px-3 py-3 text-xs text-slate-400 text-center">No watchlists saved yet</div>
          ) : watchlists.map((w) => (
            <button key={w.id} onMouseDown={() => { loadWatchlistSymbols(w.symbols); setOpen(false); }}
              className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50 flex items-center justify-between">
              <span className="truncate">{w.name}</span>
              <span className="text-xs text-slate-400 shrink-0 ml-2">{w.symbols.length}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Reason chip ─────────────────────────────────────────────────────────────

function ReasonChip({ reason }: { reason: "target" | "sl" | "timeout" | "indicator" }) {
  if (reason === "target")    return <span className="px-1.5 py-0.5 bg-emerald-100 text-emerald-700 rounded text-[10px] font-semibold">Target</span>;
  if (reason === "sl")        return <span className="px-1.5 py-0.5 bg-red-100 text-red-600 rounded text-[10px] font-semibold">SL</span>;
  if (reason === "indicator") return <span className="px-1.5 py-0.5 bg-purple-100 text-purple-600 rounded text-[10px] font-semibold">Exit Signal</span>;
  return <span className="px-1.5 py-0.5 bg-slate-100 text-slate-500 rounded text-[10px] font-semibold">Timeout</span>;
}

// ── Condition row builder ──────────────────────────────────────────────────

function ConditionBuilder({
  conditions, onChange, indicators, operators,
}: {
  conditions: ConditionRow[];
  onChange: (rows: ConditionRow[]) => void;
  indicators: string[];
  operators: string[];
}) {
  const update = (idx: number, field: keyof ConditionRow, value: string) => {
    onChange(conditions.map((c, i) => i === idx ? { ...c, [field]: value } : c));
  };

  const add = () => onChange([...conditions, { left: "close", operator: "crosses_above", right: "sma_50" }]);
  const remove = (idx: number) => onChange(conditions.filter((_, i) => i !== idx));

  const isNumericRight = (val: string) => !isNaN(parseFloat(val)) && !indicators.includes(val);

  return (
    <div className="flex flex-col gap-2">
      {conditions.map((row, idx) => (
        <div key={idx} className="flex items-center gap-2">
          <span className="text-xs font-semibold text-slate-400 w-6 shrink-0 text-right">
            {idx === 0 ? "IF" : "AND"}
          </span>

          <select value={row.left} onChange={(e) => update(idx, "left", e.target.value)}
            className="flex-1 min-w-0 text-xs px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:border-blue-400">
            {indicators.map((ind) => (
              <option key={ind} value={ind}>{INDICATOR_LABELS[ind] ?? ind}</option>
            ))}
          </select>

          <select value={row.operator} onChange={(e) => update(idx, "operator", e.target.value)}
            className="w-36 shrink-0 text-xs px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:border-blue-400">
            {operators.map((op) => (
              <option key={op} value={op}>{OPERATOR_LABELS[op] ?? op}</option>
            ))}
          </select>

          {isNumericRight(row.right) ? (
            <div className="flex items-center gap-1 flex-1 min-w-0">
              <input type="number" value={row.right}
                onChange={(e) => update(idx, "right", e.target.value)}
                className="flex-1 min-w-0 text-xs px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:border-blue-400" />
              <button onClick={() => update(idx, "right", "sma_50")}
                className="text-[10px] text-blue-500 hover:underline shrink-0 whitespace-nowrap">
                indicator
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-1 flex-1 min-w-0">
              <select value={row.right} onChange={(e) => update(idx, "right", e.target.value)}
                className="flex-1 min-w-0 text-xs px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:border-blue-400">
                {indicators.map((ind) => (
                  <option key={ind} value={ind}>{INDICATOR_LABELS[ind] ?? ind}</option>
                ))}
              </select>
              <button onClick={() => update(idx, "right", "30")}
                className="text-[10px] text-blue-500 hover:underline shrink-0 whitespace-nowrap">
                value
              </button>
            </div>
          )}

          <button onClick={() => remove(idx)} disabled={conditions.length === 1}
            className="text-slate-300 hover:text-red-400 disabled:opacity-30 transition-colors shrink-0">
            <Trash2 size={13} />
          </button>
        </div>
      ))}

      <button onClick={add}
        className="self-start flex items-center gap-1.5 text-xs text-blue-500 hover:text-blue-700 mt-0.5 transition-colors">
        <Plus size={12} /> Add Condition
      </button>
    </div>
  );
}

// ── Main page ───────────────────────────────────────────────────────────────

const SYNC_DAY_OPTIONS = [
  { label: "6 months", days: 180 },
  { label: "1 year",   days: 365 },
  { label: "2 years",  days: 730 },
  { label: "3 years",  days: 1095 },
  { label: "5 years",  days: 1825 },
];

function DataPanel() {
  const { pickedSymbols, candleStats, syncJob, syncLoading, fetchCandleStats, startDataSync, removeSymbol } = useBacktestStore();
  const [syncDays, setSyncDays] = useState(730);
  const prevSyncLoading = useRef(false);

  useEffect(() => { fetchCandleStats(); }, [pickedSymbols.join(",")]);

  useEffect(() => {
    if (!syncLoading && prevSyncLoading.current) fetchCandleStats();
    prevSyncLoading.current = syncLoading;
  }, [syncLoading]);

  const statMap = Object.fromEntries(candleStats.map((s) => [s.symbol, s]));

  const barColor = (candles: number) => {
    if (candles >= 500) return "bg-emerald-400";
    if (candles >= 200) return "bg-yellow-400";
    if (candles > 0)    return "bg-orange-400";
    return "bg-slate-200";
  };

  const isDone = syncJob?.status === "complete" || syncJob?.status === "done";

  return (
    <div className="mt-3">
      {/* Per-symbol data table */}
      <div className="rounded-lg border border-slate-100 overflow-hidden mb-3 max-h-64 overflow-y-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 z-10">
            <tr className="bg-slate-50 border-b border-slate-100 text-slate-400 font-semibold">
              <th className="text-left px-3 py-1.5">Symbol</th>
              <th className="text-right px-3 py-1.5">Daily Candles</th>
              <th className="text-left px-3 py-1.5 hidden sm:table-cell">Date Range</th>
              <th className="px-3 py-1.5 w-28 hidden sm:table-cell">vs 5yr</th>
              <th className="px-2 py-1.5 w-6"></th>
            </tr>
          </thead>
          <tbody>
            {pickedSymbols.map((sym) => {
              const stat = statMap[sym];
              const candles = stat?.candles ?? 0;
              const pct = Math.min(100, Math.round((candles / 1260) * 100)); // 1260 ≈ 5 trading years
              return (
                <tr key={sym} className="border-b border-slate-50 last:border-0">
                  <td className="px-3 py-1.5 font-semibold text-slate-700">{sym}</td>
                  <td className="px-3 py-1.5 text-right">
                    {candles === 0 ? (
                      <span className="text-slate-300 italic">no data</span>
                    ) : (
                      <span className={candles >= 200 ? "text-slate-700" : "text-orange-500 font-semibold"}>{candles.toLocaleString()}</span>
                    )}
                  </td>
                  <td className="px-3 py-1.5 text-slate-400 hidden sm:table-cell">
                    {stat?.from_date ? `${stat.from_date} → ${stat.to_date}` : <span className="text-slate-200">—</span>}
                  </td>
                  <td className="px-3 py-1.5 hidden sm:table-cell">
                    <div className="flex items-center gap-1.5">
                      <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full transition-all ${barColor(candles)}`} style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-[10px] text-slate-400 w-8 text-right shrink-0">{pct}%</span>
                    </div>
                  </td>
                  <td className="px-2 py-1.5">
                    <button onClick={() => removeSymbol(sym)} className="text-slate-200 hover:text-red-400 transition-colors"><X size={11} /></button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Sync controls */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-slate-500 font-medium">Fetch historical data:</span>
        <select value={syncDays} onChange={(e) => setSyncDays(Number(e.target.value))}
          disabled={syncLoading}
          className="text-xs px-2 py-1 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:border-blue-400 disabled:opacity-50">
          {SYNC_DAY_OPTIONS.map((o) => (
            <option key={o.days} value={o.days}>{o.label}</option>
          ))}
        </select>
        <button onClick={() => startDataSync(syncDays)} disabled={syncLoading}
          className="flex items-center gap-1.5 px-3 py-1 text-xs bg-blue-500 hover:bg-blue-600 disabled:opacity-50 text-white rounded-lg transition-colors font-medium">
          {syncLoading
            ? <><span className="w-3 h-3 border border-white/40 border-t-white rounded-full animate-spin inline-block" /> Syncing…</>
            : "Sync Selected"}
        </button>
        {syncJob && (
          <div className="flex items-center gap-2 flex-1 min-w-40">
            <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
              <div className={`h-full rounded-full transition-all ${isDone ? "bg-emerald-400" : "bg-blue-400"}`}
                style={{ width: `${syncJob.pct}%` }} />
            </div>
            <span className="text-[10px] text-slate-400 whitespace-nowrap">
              {syncJob.done}/{syncJob.total}
              {syncJob.current_symbol && !isDone ? ` · ${syncJob.current_symbol}` : ""}
              {isDone ? " · done ✓" : ""}
            </span>
          </div>
        )}
      </div>
      <div className="mt-1.5 text-[10px] text-slate-400">
        All candles are <span className="font-semibold text-slate-500">daily (1D)</span> · Green ≥500 days · Yellow ≥200 · Orange &lt;200 (limited history)
      </div>
    </div>
  );
}

export default function Backtest() {
  const store = useBacktestStore();
  const {
    pickedSymbols, indicators, operators, strategy,
    v2Results, v2Loading, v2Error, activeSymbol,
    savedRuns,
    addSymbol, removeSymbol, clearSymbols,
    setStrategy, runBacktestV2, setActiveSymbol,
    saveCurrentRun, clearSavedRuns,
  } = store;

  const [showExitConditions, setShowExitConditions] = useState(false);
  const [activePreset, setActivePreset] = useState<string | null>("MACD Cross");
  const [compareMode, setCompareMode] = useState(false);
  const [saveLabel, setSaveLabel] = useState("");
  const [showSaveInput, setShowSaveInput] = useState(false);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [loadingPct, setLoadingPct] = useState(0);
  const loadingTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    store.loadEntryConditions();
    store.loadWatchlists();
    store.loadIndicators();
  }, []);

  // Simulated progress counter while backtest runs
  useEffect(() => {
    if (v2Loading) {
      setLoadingPct(0);
      const estimatedMs = Math.max(4000, pickedSymbols.length * 600);
      const tickMs = 120;
      loadingTimer.current = setInterval(() => {
        setLoadingPct((p) => {
          const remaining = 95 - p;
          return p + remaining * (tickMs / estimatedMs) * 3;
        });
      }, tickMs);
    } else {
      if (loadingTimer.current) { clearInterval(loadingTimer.current); loadingTimer.current = null; }
      if (loadingPct > 0) {
        setLoadingPct(100);
        setTimeout(() => setLoadingPct(0), 500);
      }
    }
    return () => { if (loadingTimer.current) clearInterval(loadingTimer.current); };
  }, [v2Loading]);

  const canRun = pickedSymbols.length > 0 && strategy.entry_conditions.length > 0 && !v2Loading;

  // In compare mode, show saved run data; otherwise show current run
  const displayResults: typeof v2Results = compareMode && activeRunId
    ? savedRuns.find((r) => r.id === activeRunId)?.results ?? v2Results
    : v2Results;
  const symbolsWithResults = displayResults ? Object.keys(displayResults.per_symbol) : [];
  const activeData = activeSymbol && displayResults?.per_symbol[activeSymbol];

  return (
    <div className="flex flex-col gap-4">

      {/* ── Section 1: Universe ── */}
      <section className="bg-white border border-slate-200 rounded-xl shadow-sm p-4">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-5 h-5 rounded-full bg-blue-500 text-white text-xs flex items-center justify-center font-bold shrink-0">1</div>
          <span className="text-sm font-semibold text-slate-700">Pick Stocks</span>
          <span className="text-xs text-slate-400 ml-1">— search symbols or load a saved watchlist</span>
        </div>

        <div className="flex flex-wrap items-center gap-2 mb-3">
          <div className="flex-1 min-w-52">
            <SymbolSearch onAdd={addSymbol} />
          </div>
          <LoadWatchlistMenu />
          {pickedSymbols.length > 0 && (
            <button onClick={clearSymbols} className="text-xs text-slate-400 hover:text-red-500 transition-colors px-2 py-1">
              Clear all
            </button>
          )}
        </div>

        {pickedSymbols.length > 0 ? (
          <DataPanel />
        ) : (
          <div className="text-xs text-slate-400 py-3 text-center border border-dashed border-slate-200 rounded-lg">
            No stocks selected — search above or load a watchlist
          </div>
        )}
      </section>

      {/* ── Section 2: Strategy ── */}
      <section className={`bg-white border border-slate-200 rounded-xl shadow-sm p-4 transition-opacity ${pickedSymbols.length === 0 ? "opacity-40 pointer-events-none" : ""}`}>
        <div className="flex items-center gap-2 mb-4">
          <div className="w-5 h-5 rounded-full bg-blue-500 text-white text-xs flex items-center justify-center font-bold shrink-0">2</div>
          <span className="text-sm font-semibold text-slate-700">Strategy Builder</span>
        </div>

        {/* Strategy presets */}
        <div className="mb-4">
          <div className="text-xs text-slate-400 mb-2 font-medium">Strategy presets — click to load, then customise below</div>
          <div className="flex flex-wrap gap-1.5">
            {PRESETS.map((p) => {
              const isActive = activePreset === p.label;
              return (
                <button key={p.label} title={p.tip}
                  onClick={() => {
                    setStrategy({ entry_conditions: p.conditions });
                    setActivePreset(p.label);
                  }}
                  className={`px-2.5 py-1 text-xs border rounded-full transition-all font-medium ${
                    isActive
                      ? "bg-blue-500 text-white border-blue-500 shadow-sm"
                      : "bg-slate-100 text-slate-600 border-slate-200 hover:bg-blue-50 hover:text-blue-700 hover:border-blue-300"
                  }`}>
                  {p.label}
                </button>
              );
            })}
            <button
              onClick={() => {
                setStrategy({ entry_conditions: [{ left: "close", operator: "crosses_above", right: "sma_50" }] });
                setActivePreset("Custom");
              }}
              className={`px-2.5 py-1 text-xs border rounded-full transition-all font-medium ${
                activePreset === "Custom"
                  ? "bg-violet-500 text-white border-violet-500 shadow-sm"
                  : "bg-slate-100 text-slate-500 border-slate-200 border-dashed hover:bg-violet-50 hover:text-violet-700 hover:border-violet-300"
              }`}>
              + Custom
            </button>
          </div>
          {activePreset && activePreset !== "Custom" && (
            <div className="mt-1.5 text-[11px] text-slate-400 italic">
              {PRESETS.find((p) => p.label === activePreset)?.tip}
            </div>
          )}
        </div>

        {/* Entry conditions */}
        <div className="mb-4">
          <div className="text-xs text-slate-500 font-semibold mb-2 uppercase tracking-wide">
            Entry Conditions
            {activePreset && activePreset !== "Custom" && (
              <span className="ml-2 text-[10px] font-normal text-blue-500 normal-case">
                {activePreset} — edit below to customise
              </span>
            )}
          </div>
          {indicators.length > 0 ? (
            <ConditionBuilder
              conditions={strategy.entry_conditions}
              onChange={(rows) => {
                setStrategy({ entry_conditions: rows });
                setActivePreset(null);
              }}
              indicators={indicators}
              operators={operators}
            />
          ) : (
            <div className="text-xs text-slate-400 animate-pulse">Loading indicators…</div>
          )}
        </div>

        {/* Exit conditions (toggle) */}
        <div className="mb-4 border-t border-slate-100 pt-3">
          <button onClick={() => setShowExitConditions((v) => !v)}
            className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-700 font-semibold mb-2 transition-colors">
            <ChevronDown size={12} className={`transition-transform ${showExitConditions ? "rotate-180" : ""}`} />
            Indicator Exit Conditions
            <span className="text-slate-400 font-normal">(optional)</span>
          </button>
          {showExitConditions && indicators.length > 0 && (
            <ConditionBuilder
              conditions={strategy.exit_conditions.length ? strategy.exit_conditions : [{ left: "macd", operator: "crosses_below", right: "macd_signal" }]}
              onChange={(rows) => setStrategy({ exit_conditions: rows })}
              indicators={indicators}
              operators={operators}
            />
          )}
        </div>

        {/* Exit params + dates */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
          <div>
            <label className="text-xs text-slate-500 mb-1 block">Target %</label>
            <input type="number" step="0.5" value={strategy.target_pct}
              onChange={(e) => setStrategy({ target_pct: parseFloat(e.target.value) })}
              className="w-full text-sm px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:border-blue-400" />
          </div>
          <div>
            <label className="text-xs text-slate-500 mb-1 block">Stop-Loss %</label>
            <input type="number" step="0.5" value={strategy.sl_pct}
              onChange={(e) => setStrategy({ sl_pct: parseFloat(e.target.value) })}
              className="w-full text-sm px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:border-blue-400" />
          </div>
          <div>
            <label className="text-xs text-slate-500 mb-1 block">Max Hold (bars)</label>
            <input type="number" value={strategy.max_bars}
              onChange={(e) => setStrategy({ max_bars: parseInt(e.target.value) })}
              className="w-full text-sm px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:border-blue-400" />
          </div>
          <div>
            <label className="text-xs text-slate-500 mb-1 block">Capital / Stock (₹)</label>
            <input type="number" value={strategy.capital_per_trade}
              onChange={(e) => setStrategy({ capital_per_trade: parseFloat(e.target.value) })}
              className="w-full text-sm px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:border-blue-400" />
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3 mb-4">
          <div>
            <label className="text-xs text-slate-500 mb-1 block">From Date</label>
            <input type="date" value={strategy.from_date}
              onChange={(e) => setStrategy({ from_date: e.target.value })}
              className="w-full text-sm px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:border-blue-400" />
          </div>
          <div>
            <label className="text-xs text-slate-500 mb-1 block">To Date</label>
            <input type="date" value={strategy.to_date}
              onChange={(e) => setStrategy({ to_date: e.target.value })}
              className="w-full text-sm px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:border-blue-400" />
          </div>
          <div>
            <label className="text-xs text-slate-500 mb-1 block">Timeframe</label>
            <div className="flex rounded-lg overflow-hidden border border-slate-200 text-xs h-[34px]">
              {(["1D", "1W"] as const).map((tf) => (
                <button key={tf}
                  onClick={() => setStrategy({ timeframe: tf })}
                  className={`flex-1 font-medium transition-colors ${
                    strategy.timeframe === tf
                      ? "bg-blue-500 text-white"
                      : "text-slate-500 bg-slate-50 hover:bg-slate-100"
                  }`}>
                  {tf === "1D" ? "Daily" : "Weekly"}
                </button>
              ))}
            </div>
          </div>
        </div>

        <button onClick={runBacktestV2} disabled={!canRun}
          className="flex items-center gap-2 px-5 py-2 bg-blue-500 hover:bg-blue-600 disabled:opacity-40 text-white text-sm font-medium rounded-lg transition-colors">
          {v2Loading
            ? <><span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin shrink-0" /> Running on {pickedSymbols.length} stocks…</>
            : <><Play size={13} /> Run Backtest on {pickedSymbols.length} stock{pickedSymbols.length !== 1 ? "s" : ""}</>
          }
        </button>

        {v2Error && (
          <div className="mt-3 flex items-center gap-2 text-sm text-red-500">
            <AlertCircle size={14} /> {v2Error.replace("Error: ", "")}
          </div>
        )}
      </section>

      {/* ── Section 3: Results — left panel + right panel ── */}
      {(v2Results || v2Loading) && (
        <section className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">

          {/* Save / Compare toolbar — only when results exist */}
          {v2Results && <div className="flex items-center gap-2 px-4 py-2.5 border-b border-slate-100 bg-slate-50/60 flex-wrap">
            <span className="text-xs font-semibold text-slate-500 mr-1">Results</span>
            {savedRuns.length > 0 && (
              <button onClick={() => { setCompareMode((m) => !m); setActiveRunId(null); }}
                className={`flex items-center gap-1.5 px-2.5 py-1 text-xs border rounded-lg font-medium transition-colors ${
                  compareMode ? "bg-blue-500 text-white border-blue-500" : "border-slate-200 text-slate-600 hover:border-blue-300 hover:bg-blue-50"
                }`}>
                <BarChart2 size={12} /> Compare ({savedRuns.length})
              </button>
            )}
            {showSaveInput ? (
              <div className="flex items-center gap-1.5">
                <input autoFocus value={saveLabel} onChange={(e) => setSaveLabel(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && saveLabel.trim()) { saveCurrentRun(saveLabel.trim()); setSaveLabel(""); setShowSaveInput(false); } if (e.key === "Escape") setShowSaveInput(false); }}
                  placeholder="Run label…"
                  className="text-xs px-2 py-1 border border-slate-200 rounded-lg outline-none focus:border-blue-400 w-36" />
                <button disabled={!saveLabel.trim()}
                  onClick={() => { saveCurrentRun(saveLabel.trim()); setSaveLabel(""); setShowSaveInput(false); }}
                  className="text-xs px-2 py-1 bg-blue-500 text-white rounded-lg disabled:opacity-40 hover:bg-blue-600">Save</button>
                <button onClick={() => setShowSaveInput(false)} className="text-xs text-slate-400 hover:text-slate-600">Cancel</button>
              </div>
            ) : (
              <button onClick={() => setShowSaveInput(true)}
                className="flex items-center gap-1.5 px-2.5 py-1 text-xs border border-slate-200 rounded-lg text-slate-600 hover:border-blue-300 hover:bg-blue-50 font-medium transition-colors">
                <BookmarkPlus size={12} /> Save Run
              </button>
            )}
            {savedRuns.length > 0 && (
              <button onClick={clearSavedRuns} className="text-xs text-slate-400 hover:text-red-400 transition-colors ml-auto">Clear saved</button>
            )}
          </div>}

          {/* Compare table */}
          {v2Results && compareMode && savedRuns.length > 0 && (
            <div className="border-b border-slate-100 overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-100 text-slate-400 font-semibold">
                    {["Run", "TF", "Total PnL", "Win Rate", "Trades", "Avg PnL%", "Best", "Worst"].map((h) => (
                      <th key={h} className="px-3 py-2 text-left whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[...savedRuns, { id: "current", label: "Current run", timeframe: strategy.timeframe, results: v2Results }].map((run) => {
                    const agg = run.results.aggregate;
                    const isActive = (compareMode && activeRunId === run.id) || (!compareMode && run.id === "current");
                    return (
                      <tr key={run.id}
                        onClick={() => { setActiveRunId(run.id === "current" ? null : run.id); }}
                        className={`border-b border-slate-50 cursor-pointer transition-colors ${isActive ? "bg-blue-50" : "hover:bg-slate-50"}`}>
                        <td className="px-3 py-2 font-semibold text-slate-700">{run.label}</td>
                        <td className="px-3 py-2 text-slate-400">{run.timeframe}</td>
                        <td className={`px-3 py-2 font-semibold ${pnlClass(agg.total_pnl)}`}>
                          {agg.total_pnl >= 0 ? "+" : ""}₹{fmt(agg.total_pnl)}
                        </td>
                        <td className={`px-3 py-2 ${agg.win_rate_pct >= 50 ? "text-emerald-600" : "text-red-400"}`}>{agg.win_rate_pct}%</td>
                        <td className="px-3 py-2 text-slate-500">{agg.total_trades}</td>
                        <td className={`px-3 py-2 ${pnlClass(agg.avg_pnl_pct)}`}>{agg.avg_pnl_pct}%</td>
                        <td className="px-3 py-2 text-emerald-600 font-medium">{agg.best_symbol || "—"}</td>
                        <td className="px-3 py-2 text-red-400 font-medium">{agg.worst_symbol || "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex" style={{ height: 640 }}>

            {/* Left panel: stock list */}
            <div className="w-52 shrink-0 border-r border-slate-100 flex flex-col">
              <div className="p-3 border-b border-slate-100 bg-slate-50/60">
                <div className="text-[10px] text-slate-400 font-semibold uppercase tracking-wide mb-1">Combined Results</div>
                {displayResults ? (
                  <>
                    <div className={`text-base font-bold ${pnlClass(displayResults.aggregate.total_pnl)}`}>
                      {displayResults.aggregate.total_pnl >= 0 ? "+" : ""}₹{fmt(displayResults.aggregate.total_pnl)}
                    </div>
                    <div className="flex gap-3 mt-1 text-[10px] text-slate-400">
                      <span>{displayResults.aggregate.total_trades} trades</span>
                      <span className={displayResults.aggregate.win_rate_pct >= 50 ? "text-emerald-500" : "text-red-400"}>
                        {displayResults.aggregate.win_rate_pct}% win
                      </span>
                    </div>
                  </>
                ) : (
                  <div className="text-slate-300 text-sm animate-pulse">—</div>
                )}
              </div>

              <div className="overflow-y-auto flex-1">
                {symbolsWithResults.map((sym) => {
                  const symStats = displayResults!.per_symbol[sym].stats;
                  const isActive = sym === activeSymbol;
                  return (
                    <button key={sym} onClick={() => setActiveSymbol(sym)}
                      className={`w-full text-left px-3 py-2.5 border-b border-slate-50 transition-colors ${
                        isActive ? "bg-blue-50 border-l-2 border-l-blue-500" : "hover:bg-slate-50"
                      }`}>
                      <div className="flex items-center justify-between gap-1">
                        <span className={`text-xs font-semibold ${isActive ? "text-blue-700" : "text-slate-700"}`}>{sym}</span>
                        <span className={`text-[10px] font-semibold ${pnlClass(symStats.total_pnl)}`}>
                          {symStats.total_pnl >= 0 ? "+" : ""}₹{fmt(symStats.total_pnl)}
                        </span>
                      </div>
                      <div className="text-[10px] text-slate-400 mt-0.5">
                        {symStats.total_trades} trades · {symStats.win_rate_pct}% win
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Right panel: chart + trade log */}
            <div className="flex-1 min-w-0 flex flex-col">
              {activeData ? (
                <>
                  <div className="px-4 pt-3 pb-1.5 flex items-center gap-3 border-b border-slate-100 flex-wrap">
                    <span className="text-sm font-semibold text-slate-800">{activeSymbol}</span>
                    <div className="flex items-center gap-3 text-xs text-slate-400">
                      <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full bg-blue-500" /> Entry</span>
                      <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full bg-emerald-500" /> Target</span>
                      <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full bg-red-400" /> SL</span>
                    </div>
                    <span className="ml-auto text-xs text-slate-400">
                      {activeData.trades.length} trade{activeData.trades.length !== 1 ? "s" : ""}
                      {activeData.stats.total_pnl !== 0 && (
                        <span className={`ml-2 font-semibold ${pnlClass(activeData.stats.total_pnl)}`}>
                          {activeData.stats.total_pnl >= 0 ? "+" : ""}₹{fmt(activeData.stats.total_pnl)}
                        </span>
                      )}
                    </span>
                  </div>

                  <BacktestChart
                    symbol={activeSymbol!}
                    ohlcv={activeData.ohlcv}
                    trades={activeData.trades}
                  />

                  {activeData.trades.length > 0 ? (
                    <div className="border-t border-slate-100 overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-slate-400 bg-slate-50 border-b border-slate-100">
                            {["Entry Date","Entry ₹","Target ₹","SL ₹","Exit Date","Exit ₹","Reason","P&L","P&L%"].map((h) => (
                              <th key={h} className={`py-2 px-3 font-semibold whitespace-nowrap ${["Entry Date","Exit Date","Reason"].includes(h) ? "text-left" : "text-right"}`}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {activeData.trades.map((t, i) => (
                            <tr key={i} className="border-b border-slate-50 hover:bg-slate-50/70 transition-colors">
                              <td className="py-1.5 px-3 text-slate-600 whitespace-nowrap">{t.entry_date.slice(0, 10)}</td>
                              <td className="py-1.5 px-3 text-right text-slate-700">₹{t.entry_price.toFixed(2)}</td>
                              <td className="py-1.5 px-3 text-right text-emerald-600">₹{t.target_price.toFixed(2)}</td>
                              <td className="py-1.5 px-3 text-right text-red-500">₹{t.sl_price.toFixed(2)}</td>
                              <td className="py-1.5 px-3 text-slate-600 whitespace-nowrap">{t.exit_date.slice(0, 10)}</td>
                              <td className="py-1.5 px-3 text-right text-slate-700">₹{t.exit_price.toFixed(2)}</td>
                              <td className="py-1.5 px-3"><ReasonChip reason={t.exit_reason} /></td>
                              <td className={`py-1.5 px-3 text-right font-medium ${pnlClass(t.pnl)}`}>
                                {t.pnl >= 0 ? "+" : ""}₹{fmt(t.pnl)}
                              </td>
                              <td className={`py-1.5 px-3 text-right font-medium ${pnlClass(t.pnl_pct)}`}>
                                {t.pnl_pct >= 0 ? "+" : ""}{t.pnl_pct.toFixed(2)}%
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="p-8 text-center text-slate-400 text-sm">
                      No trades fired for {activeSymbol} in the selected period with this strategy
                    </div>
                  )}
                </>
              ) : v2Loading ? (
                <div className="flex-1 flex flex-col items-center justify-center gap-5 select-none">
                  {/* Circular progress ring */}
                  <div className="relative w-28 h-28">
                    <svg className="w-28 h-28 -rotate-90" viewBox="0 0 112 112">
                      <circle cx="56" cy="56" r="46" fill="none" stroke="#e2e8f0" strokeWidth="8" />
                      <circle cx="56" cy="56" r="46" fill="none" stroke="#3b82f6" strokeWidth="8"
                        strokeLinecap="round"
                        strokeDasharray={String(2 * Math.PI * 46)}
                        strokeDashoffset={String(2 * Math.PI * 46 * (1 - Math.min(loadingPct, 100) / 100))}
                        style={{ transition: "stroke-dashoffset 0.15s ease" }} />
                    </svg>
                    <div className="absolute inset-0 flex items-center justify-center">
                      <span className="text-2xl font-bold text-slate-700 tabular-nums">{Math.floor(Math.min(loadingPct, 100))}%</span>
                    </div>
                  </div>
                  <div className="text-center">
                    <div className="text-sm font-medium text-slate-600">
                      Running on {pickedSymbols.length} stock{pickedSymbols.length !== 1 ? "s" : ""}…
                    </div>
                    <div className="text-xs text-slate-400 mt-1">
                      {strategy.timeframe === "1W" ? "Weekly" : "Daily"} · {activePreset || "Custom strategy"}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex-1 flex items-center justify-center text-slate-400 text-sm">
                  Select a stock from the list to view its chart
                </div>
              )}
            </div>

          </div>
        </section>
      )}

    </div>
  );
}
