import { useEffect, useRef, useState, useCallback } from "react";
import { Search, X, ChevronDown, Play, AlertCircle, Plus, Trash2, BookmarkPlus, BarChart2,
         Shuffle, Zap, LayoutGrid, Sigma, Sunrise, SlidersHorizontal, BrainCircuit, Radar } from "lucide-react";
import { api, ConditionRow, SweepDim } from "../lib/api";
import { useBacktestStore, SavedRun, ALGO_COLORS, StraddleConfig, StraddleResult, SpreadConfig, SpreadResult, ORBConfig, ORBResult } from "../store/useBacktestStore";
import BacktestChart, { type BoxZone } from "../components/BacktestChart";
import TrendOutlook from "../components/TrendOutlook";
import FnoFetchPanel, { INDEX_SYMBOLS } from "../components/FnoFetchPanel";
import IntradayFetchPanel from "../components/IntradayFetchPanel";
import OrbTradeChart from "../components/OrbTradeChart";
import SymbolCombobox from "../components/SymbolCombobox";
import type { PatternHit } from "../lib/candlePatterns";
import type { BacktestTradeV2 } from "../lib/api";

// ── helpers ────────────────────────────────────────────────────────────────

function fmt(n: number, dec = 0) {
  return n.toLocaleString("en-IN", { maximumFractionDigits: dec });
}

function pnlClass(n: number) {
  return n >= 0 ? "text-emerald-600" : "text-red-500";
}

function tradeStats(trades: BacktestTradeV2[]) {
  if (!trades.length) return { profitFactor: 0, expectancy: 0, targetHits: 0, slHits: 0, timeStops: 0 };
  const winners   = trades.filter((t) => t.pnl > 0);
  const losers    = trades.filter((t) => t.pnl <= 0);
  const gProfit   = winners.reduce((s, t) => s + t.pnl, 0);
  const gLoss     = Math.abs(losers.reduce((s, t) => s + t.pnl, 0));
  const pf        = gLoss > 0 ? gProfit / gLoss : gProfit > 0 ? Infinity : 0;
  const winRate   = winners.length / trades.length;
  const avgWin    = winners.length ? winners.reduce((s, t) => s + t.pnl_pct, 0) / winners.length : 0;
  const avgLoss   = losers.length  ? Math.abs(losers.reduce((s, t) => s + t.pnl_pct, 0) / losers.length) : 0;
  const exp       = winRate * avgWin - (1 - winRate) * avgLoss;
  const targetHits = trades.filter((t) => t.exit_reason === "target").length;
  const slHits     = trades.filter((t) => t.exit_reason === "sl").length;
  const timeStops  = trades.length - targetHits - slHits;
  return { profitFactor: pf, expectancy: exp, targetHits, slHits, timeStops };
}

/** Reward zone (entry→target) and risk zone (SL→entry) boxes for long-only trades. */
function tradeBoxZones(trades: BacktestTradeV2[]): BoxZone[] {
  return trades.flatMap((t) => [
    { entry_date: t.entry_date, exit_date: t.exit_date, top: t.target_price, bottom: t.entry_price,
      fill: "rgba(16,185,129,0.15)", border: "#10b981" },
    { entry_date: t.entry_date, exit_date: t.exit_date, top: t.entry_price, bottom: t.sl_price,
      fill: "rgba(239,68,68,0.12)", border: "#ef4444" },
  ]);
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
  cdl_doji: "Doji", cdl_shooting_star: "Shooting Star",
  cdl_morning_star: "Morning Star", cdl_evening_star: "Evening Star",
  cdl_bear_engulf: "Bearish Engulfing",
  pcr_oi: "PCR (OI)", max_pain: "Max Pain Strike", max_pain_dist_pct: "Max Pain Distance %",
  atm_oi: "ATM Combined OI", oi_concentration: "OI Concentration %",
  basis: "Futures Basis", cost_of_carry: "Cost of Carry %", rollover_pct: "Rollover %",
  atm_iv: "ATM Implied Vol %", iv_rank: "IV Rank (60d) %",
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

// ── Single-value symbol combobox (search-as-you-type + keyboard nav) ───────
// For fields like straddle/spread/ORB's "Symbol" input, where typing should both
// filter suggestions AND directly update the bound value (unlike SymbolSearch
// above, which clears itself after adding to a list).

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

// ── ATM Delta snapshot (Options mode, Step 1 only — ORB has no option chain) ─

function AtmDeltaSnapshot({ symbol, hasData }: { symbol: string; hasData: boolean }) {
  const [snap, setSnap] = useState<import("../lib/api").OptionChainData | null>(null);

  useEffect(() => {
    if (!symbol || !hasData) { setSnap(null); return; }
    api.getOptionChain(symbol).then(setSnap).catch(() => setSnap(null));
  }, [symbol, hasData]);

  if (!snap?.atm_greeks) return null; // silent — the coverage pill above already communicates "no data"
  const atmRow = snap.chain.find((r) => r.is_atm);
  const fmtDelta = (d: number | null) => (d === null ? "—" : d.toFixed(3));
  const fmtIv = (v: number | null) => (v === null ? "—" : `${v.toFixed(1)}%`);

  return (
    <div className="mb-3 flex flex-wrap items-stretch gap-2">
      <div className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 flex items-center gap-1.5">
        <span className="font-semibold text-slate-600">ATM Snapshot</span>
        <span className="text-slate-400">— {snap.expiry} ({snap.atm_greeks.dte_days}d) · strike {atmRow?.strike} · spot {snap.spot.toFixed(2)}</span>
      </div>
      <div className="flex items-center gap-3 text-xs bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
        <span className="font-semibold text-emerald-700">CE</span>
        <span className="text-slate-500">premium <span className="font-medium text-slate-700">{atmRow?.ce_ltp ?? "—"}</span></span>
        <span className="text-slate-500">IV <span className="font-medium text-slate-700">{fmtIv(snap.atm_greeks.ce.iv)}</span></span>
        <span className="text-slate-500">Δ <span className="font-semibold text-emerald-700">{fmtDelta(snap.atm_greeks.ce.delta)}</span></span>
      </div>
      <div className="flex items-center gap-3 text-xs bg-red-50 border border-red-200 rounded-lg px-3 py-2">
        <span className="font-semibold text-red-700">PE</span>
        <span className="text-slate-500">premium <span className="font-medium text-slate-700">{atmRow?.pe_ltp ?? "—"}</span></span>
        <span className="text-slate-500">IV <span className="font-medium text-slate-700">{fmtIv(snap.atm_greeks.pe.iv)}</span></span>
        <span className="text-slate-500">Δ <span className="font-semibold text-red-700">{fmtDelta(snap.atm_greeks.pe.delta)}</span></span>
      </div>
    </div>
  );
}

// ── Timeline preset buttons (shared across Options/ORB Step 1) ─────────────

function TimelinePresetButtons({ onPick }: { onPick: (fromDate: string, toDate: string) => void }) {
  const pick = (days: number) => {
    const to = new Date();
    const from = new Date(); from.setDate(from.getDate() - days);
    onPick(from.toISOString().slice(0, 10), to.toISOString().slice(0, 10));
  };
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <span className="text-xs text-slate-400">Quick range:</span>
      {SYNC_DAY_OPTIONS.map((o) => (
        <button key={o.days} onClick={() => pick(o.days)}
          className="px-2 py-1 text-[11px] font-medium bg-slate-50 border border-slate-200 rounded-md hover:border-blue-300 hover:bg-blue-50 text-slate-600 transition-colors">
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ── Multi-Algo Panel (Section 1+2 combined for multi-algo mode) ──────────────

function MultiAlgoPanel({
  symbol, algoSlots, activeAlgoId, indicators, operators,
  onSymbolChange, onAddAlgo, onAddCustomAlgo, onRemoveAlgo, onUpdateAlgo, onSetActive, onRunAll,
  expandedAlgoId, setExpandedAlgoId,
}: {
  symbol: string; algoSlots: import("../store/useBacktestStore").AlgoSlot[];
  activeAlgoId: string | null; indicators: string[]; operators: string[];
  onSymbolChange: (s: string) => void;
  onAddAlgo: () => void; onAddCustomAlgo: () => void; onRemoveAlgo: (id: string) => void;
  onUpdateAlgo: (id: string, patch: Partial<Pick<import("../store/useBacktestStore").AlgoSlot, "label" | "strategy">>) => void;
  onSetActive: (id: string) => void; onRunAll: () => Promise<void>;
  expandedAlgoId: string | null; setExpandedAlgoId: (id: string | null) => void;
}) {
  const [search, setSearch] = useState("");
  const [suggestions, setSuggestions] = useState<{symbol:string;name:string}[]>([]);
  const [hoverIdx, setHoverIdx] = useState(-1);
  const [candleStat, setCandleStat] = useState<{candles:number;from_date:string|null;to_date:string|null}|null>(null);
  const [openPresetId, setOpenPresetId] = useState<string | null>(null);
  const anyLoading = algoSlots.some((a) => a.loading);

  useEffect(() => {
    if (search.length < 1) { setSuggestions([]); setHoverIdx(-1); return; }
    api.searchSymbols(search).then(setSuggestions).catch(() => setSuggestions([]));
  }, [search]);

  useEffect(() => {
    if (!symbol) { setCandleStat(null); return; }
    api.getCandleStats([symbol]).then((stats) => setCandleStat(stats[0] ?? null)).catch(() => {});
  }, [symbol]);

  const presetDropdownRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!openPresetId) return;
    const handler = (e: MouseEvent) => {
      if (presetDropdownRef.current && !presetDropdownRef.current.contains(e.target as Node)) {
        setOpenPresetId(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [openPresetId]);

  const selectSuggestion = (s: {symbol:string}) => {
    onSymbolChange(s.symbol); setSearch(""); setSuggestions([]); setHoverIdx(-1);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!suggestions.length) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setHoverIdx((i) => Math.min(i + 1, suggestions.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHoverIdx((i) => Math.max(i - 1, 0)); }
    else if (e.key === "Enter" && hoverIdx >= 0) { e.preventDefault(); selectSuggestion(suggestions[hoverIdx]); }
    else if (e.key === "Escape") { setSuggestions([]); setHoverIdx(-1); }
  };

  const fmtDate = (d: string | null) => d ? d.slice(0, 7).replace("-", "/") : "—";

  return (
    <div className="flex flex-col gap-3">
      {/* Stock picker */}
      <section className="bg-white border border-slate-200 rounded-xl shadow-sm p-4">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-5 h-5 rounded-full bg-blue-500 text-white text-xs flex items-center justify-center font-bold shrink-0">1</div>
          <span className="text-sm font-semibold text-slate-700">Pick ONE Stock</span>
          <span className="text-xs text-slate-400 ml-1">— all algos run on this single symbol</span>
        </div>
        <div className="relative max-w-sm">
          <input value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              if (symbol) onSymbolChange("");
              if (!e.target.value) setSuggestions([]);
            }}
            onKeyDown={handleKeyDown}
            placeholder={symbol ? `${symbol} — type to change…` : "Search symbol e.g. HDFCBANK…"}
            className="w-full text-sm px-3 py-2 border border-slate-200 rounded-lg outline-none focus:border-blue-400 bg-slate-50" />
          {suggestions.length > 0 && (
            <div className="absolute z-20 top-full left-0 right-0 bg-white border border-slate-200 rounded-lg shadow-lg mt-1 max-h-48 overflow-y-auto">
              {suggestions.map((s, i) => (
                <button key={s.symbol} onClick={() => selectSuggestion(s)}
                  onMouseEnter={() => setHoverIdx(i)}
                  className={`w-full text-left px-3 py-2 text-xs flex justify-between transition-colors ${
                    i === hoverIdx ? "bg-blue-50 text-blue-700" : "hover:bg-slate-50"
                  }`}>
                  <span className="font-semibold">{s.symbol}</span>
                  <span className="text-slate-400 truncate ml-2">{s.name}</span>
                </button>
              ))}
              <div className="px-3 py-1 text-[10px] text-slate-300 border-t border-slate-100">↑↓ navigate · Enter select · Esc close</div>
            </div>
          )}
        </div>
        {symbol && (
          <div className="mt-2 flex items-center gap-3 flex-wrap">
            <span className="flex items-center gap-1.5 px-2.5 py-1 bg-blue-50 border border-blue-200 rounded-lg text-xs font-semibold text-blue-700">
              {symbol}
              <button onClick={() => onSymbolChange("")} className="text-blue-300 hover:text-red-400"><X size={10} /></button>
            </span>
            {candleStat && (
              <span className="text-[11px] text-slate-500 flex items-center gap-1">
                <span className="font-semibold text-slate-700">{candleStat.candles.toLocaleString()}</span> candles
                <span className="text-slate-300 mx-1">·</span>
                {fmtDate(candleStat.from_date)} → {fmtDate(candleStat.to_date)}
              </span>
            )}
          </div>
        )}
      </section>

      {/* Algo stack */}
      <section className="bg-white border border-slate-200 rounded-xl shadow-sm p-4">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-5 h-5 rounded-full bg-blue-500 text-white text-xs flex items-center justify-center font-bold shrink-0">2</div>
          <span className="text-sm font-semibold text-slate-700">Strategy Stack</span>
          <span className="text-xs text-slate-400 ml-1">— up to 5 algos, each with independent conditions</span>
        </div>

        <div className="space-y-2">
          {algoSlots.map((slot) => {
            const isExpanded = expandedAlgoId === slot.id;
            return (
              <div key={slot.id} className="border border-slate-200 rounded-lg">
                {/* Algo header */}
                <div className="flex items-center gap-2 px-3 py-2 bg-slate-50 cursor-pointer rounded-t-lg"
                  onClick={() => setExpandedAlgoId(isExpanded ? null : slot.id)}>
                  <span className="w-3 h-3 rounded-full shrink-0" style={{ background: slot.color }} />
                  <input value={slot.label} onClick={(e) => e.stopPropagation()}
                    onChange={(e) => onUpdateAlgo(slot.id, { label: e.target.value })}
                    className="text-xs font-semibold text-slate-700 bg-transparent outline-none w-24 border-b border-transparent hover:border-slate-300 focus:border-blue-400" />
                  {/* Preset picker — custom popover */}
                  <div ref={openPresetId === slot.id ? presetDropdownRef : undefined} className="relative" onClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={(e) => { e.stopPropagation(); setOpenPresetId(openPresetId === slot.id ? null : slot.id); }}
                      className="flex items-center gap-1 text-[10px] text-slate-500 bg-white border border-slate-200 rounded-md px-2 py-0.5 hover:border-blue-300 hover:text-blue-600 transition-colors whitespace-nowrap">
                      Load preset <ChevronDown size={9} className={`transition-transform ${openPresetId === slot.id ? "rotate-180" : ""}`} />
                    </button>
                    {openPresetId === slot.id && (
                      <div className="absolute z-30 top-full left-0 mt-1 w-52 bg-white border border-slate-200 rounded-lg shadow-xl overflow-hidden">
                        <div className="px-2.5 py-1.5 text-[9px] font-semibold text-slate-400 uppercase tracking-wide border-b border-slate-100 bg-slate-50">Select preset</div>
                        <div className="max-h-56 overflow-y-auto">
                          {PRESETS.map((p) => (
                            <button key={p.label}
                              onMouseDown={(e) => {
                                e.stopPropagation();
                                onUpdateAlgo(slot.id, { label: p.label, strategy: { ...slot.strategy, entry_conditions: p.conditions } });
                                setOpenPresetId(null);
                              }}
                              className="w-full text-left px-3 py-2 hover:bg-blue-50 transition-colors border-b border-slate-50 last:border-0">
                              <div className="text-xs font-semibold text-slate-700">{p.label}</div>
                              <div className="text-[10px] text-slate-400 truncate mt-0.5">{p.tip}</div>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                  <span className="text-[10px] text-slate-400 hidden sm:inline">
                    {slot.strategy.entry_conditions.length} cond · T{slot.strategy.target_pct}% SL{slot.strategy.sl_pct}%
                  </span>
                  <span className="ml-auto flex items-center gap-2">
                    <ChevronDown size={12} className={`text-slate-400 transition-transform ${isExpanded ? "rotate-180" : ""}`} />
                    {algoSlots.length > 1 && (
                      <button onClick={(e) => { e.stopPropagation(); onRemoveAlgo(slot.id); }}
                        className="text-slate-300 hover:text-red-400"><X size={12} /></button>
                    )}
                  </span>
                </div>

                {/* Expanded body */}
                {isExpanded && (
                  <div className="p-3 space-y-3">
                    <div>
                      <div className="text-[10px] font-semibold text-slate-500 uppercase mb-1.5">Entry Conditions</div>
                      <ConditionBuilder
                        conditions={slot.strategy.entry_conditions}
                        onChange={(rows) => onUpdateAlgo(slot.id, { strategy: { ...slot.strategy, entry_conditions: rows } })}
                        indicators={indicators} operators={operators} />
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      {[
                        { label: "Target %", key: "target_pct" as const, step: "0.5" },
                        { label: "Stop-Loss %", key: "sl_pct" as const, step: "0.5" },
                        { label: "Max Hold (days)", key: "max_bars" as const, step: "1" },
                      ].map(({ label, key, step }) => (
                        <div key={key}>
                          <label className="text-[10px] text-slate-500 mb-1 block">{label}</label>
                          <input type="number" step={step} value={slot.strategy[key]}
                            onChange={(e) => onUpdateAlgo(slot.id, { strategy: { ...slot.strategy, [key]: parseFloat(e.target.value) } })}
                            className="w-full text-xs px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:border-blue-400" />
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {algoSlots.length < 5 && (
          <div className="flex gap-2 mt-2">
            <button onClick={onAddAlgo}
              className="flex items-center gap-1 px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg text-slate-600 hover:bg-blue-50 hover:border-blue-300 transition-colors">
              <Plus size={11} /> Add Preset Algo
            </button>
            <button onClick={onAddCustomAlgo}
              className="flex items-center gap-1 px-2.5 py-1.5 text-xs border border-dashed border-slate-300 rounded-lg text-slate-500 hover:bg-violet-50 hover:border-violet-400 hover:text-violet-600 transition-colors">
              <Plus size={11} /> Custom Algo
            </button>
          </div>
        )}

        <button onClick={onRunAll} disabled={!symbol || anyLoading}
          className="mt-3 flex items-center gap-2 px-5 py-2 bg-blue-500 hover:bg-blue-600 disabled:opacity-40 text-white text-sm font-medium rounded-lg transition-colors">
          {anyLoading
            ? <><span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin shrink-0" />Running algos…</>
            : <><Play size={13} />Run {algoSlots.length} Algo{algoSlots.length !== 1 ? "s" : ""} on {symbol || "…"}</>
          }
        </button>
      </section>
    </div>
  );
}

// ── Multi-Algo Results ────────────────────────────────────────────────────────

const CANDLE_BARS: Record<string, number> = {
  MS: 3, ES: 3, "3W": 3, "3B": 3,
  E: 2, BE: 2, P: 2, DC: 2,
  H: 1, IH: 1, SS: 1, DD: 1, GD: 1, M: 1,
};

function MultiAlgoResults({
  symbol, algoSlots, activeAlgoId, onSetActive,
  patternHits, outlook, outlookLoading,
}: {
  symbol: string;
  algoSlots: import("../store/useBacktestStore").AlgoSlot[];
  activeAlgoId: string | null; onSetActive: (id: string) => void;
  patternHits: PatternHit[];
  outlook: Parameters<typeof TrendOutlook>[0]["data"];
  outlookLoading: boolean;
}) {
  const slotsWithResults = algoSlots.filter((a) => a.results);
  if (slotsWithResults.length === 0) return null;

  const activeId = activeAlgoId ?? slotsWithResults[0]?.id;
  const activeSlot = algoSlots.find((a) => a.id === activeId) ?? slotsWithResults[0];
  const activeTrades = activeSlot?.results?.trades ?? [];

  // All algos run on the same stock → ohlcv is identical across slots.
  // Pin to the first slot so the chart never remounts or resets zoom when
  // the user switches active algo.
  const ohlcv = slotsWithResults[0]?.results?.ohlcv ?? [];

  const algoTradeSets = slotsWithResults.map((slot) => ({
    label: slot.label,
    color: slot.color,
    trades: slot.results!.trades,
    active: slot.id === activeId,
  }));

  const last10Dates = new Set(ohlcv.slice(-10).map(r => r.date.slice(0, 10)));
  const chartPatternHits = patternHits.filter(h => last10Dates.has(h.date));

  return (
    <section className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
      <div className="flex" style={{ minHeight: 500 }}>
        {/* Left: algo list */}
        <div className="w-56 shrink-0 border-r border-slate-100 flex flex-col">
          <div className="p-3 border-b border-slate-100 bg-slate-50/60">
            <div className="text-[10px] text-slate-400 font-semibold uppercase tracking-wide">Algo Comparison</div>
            {symbol && <div className="text-xs font-bold text-slate-700 mt-0.5">{symbol}</div>}
          </div>
          <div className="overflow-y-auto flex-1">
            {slotsWithResults.map((slot) => {
              const ts = tradeStats(slot.results!.trades);
              const isActive = slot.id === activeId;
              return (
                <button key={slot.id} onClick={() => onSetActive(slot.id)}
                  className={`w-full text-left px-3 py-3 border-b border-slate-50 transition-all ${
                    isActive ? "bg-white shadow-sm" : "hover:bg-slate-50"
                  }`}
                  style={{ borderLeft: `3px solid ${isActive ? slot.color : "transparent"}` }}>
                  <div className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full shrink-0 shadow-sm" style={{ background: slot.color }} />
                    <span className="text-xs font-semibold text-slate-700 truncate flex-1">{slot.label}</span>
                    <span className={`text-[11px] font-bold ${pnlClass(slot.results!.stats.total_pnl)}`}>
                      {slot.results!.stats.total_pnl >= 0 ? "+" : ""}₹{fmt(slot.results!.stats.total_pnl)}
                    </span>
                  </div>
                  <div className="text-[10px] text-slate-400 mt-1 pl-5 flex flex-wrap gap-x-2">
                    <span>{slot.results!.stats.total_trades} trades</span>
                    <span>{slot.results!.stats.win_rate_pct}% win</span>
                    {slot.results!.trades.length > 0 && (
                      <span className={ts.profitFactor >= 1.5 ? "text-emerald-500" : ts.profitFactor >= 1 ? "text-amber-500" : "text-red-400"}>
                        PF {isFinite(ts.profitFactor) ? ts.profitFactor.toFixed(1) : "∞"}×
                      </span>
                    )}
                  </div>
                  {/* Show conditions used — helps debug "same chart" issue */}
                  <div className="pl-5 mt-1.5 space-y-0.5">
                    {slot.strategy.entry_conditions.slice(0, 3).map((c, ci) => (
                      <div key={ci} className="text-[9px] text-slate-300 truncate">
                        {c.left} <span className="text-slate-200">{c.operator.replace(/_/g, " ")}</span> {c.right}
                      </div>
                    ))}
                    {slot.strategy.entry_conditions.length > 3 && (
                      <div className="text-[9px] text-slate-200">+{slot.strategy.entry_conditions.length - 3} more</div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Center: chart + trade log */}
        <div className="flex-1 min-w-0 flex flex-col border-r border-slate-100">
          {/* Chart header */}
          <div className="px-4 pt-3 pb-2 flex items-center gap-3 border-b border-slate-100 flex-wrap">
            <div>
              <span className="text-sm font-bold text-slate-800">{symbol || "Algo Overlay Chart"}</span>
              {symbol && <span className="text-xs text-slate-400 ml-2">· Algo Overlay</span>}
            </div>
            {/* Algo color pills */}
            <div className="flex items-center gap-1.5 flex-wrap">
              {slotsWithResults.map((s) => {
                const isActive = s.id === activeId;
                return (
                  <button key={s.id} onClick={() => onSetActive(s.id)}
                    className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[10px] font-medium transition-all ${
                      isActive ? "shadow-sm text-white" : "text-slate-500 border-slate-200 hover:border-slate-300 bg-white"
                    }`}
                    style={isActive ? { background: s.color, borderColor: s.color } : {}}>
                    <span className="w-2 h-2 rounded-full" style={{ background: isActive ? "#fff" : s.color }} />
                    {s.label}
                  </button>
                );
              })}
            </div>
          </div>

          {ohlcv.length > 0 && (
            <BacktestChart symbol={symbol} ohlcv={ohlcv} algoTrades={algoTradeSets} patternHits={chartPatternHits} />
          )}

          {/* No-signals message for active algo */}
          {ohlcv.length > 0 && activeTrades.length === 0 && (
            <div className="flex flex-col items-center justify-center py-10 gap-2 border-t border-slate-100 bg-slate-50/30">
              <div className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: activeSlot?.color + "22" }}>
                <span className="text-base">📭</span>
              </div>
              <div className="text-sm font-semibold" style={{ color: activeSlot?.color }}>{activeSlot?.label}</div>
              <div className="text-xs text-slate-400">No signals generated for {symbol} in this period</div>
              <div className="text-[10px] text-slate-300 mt-0.5">
                {activeSlot?.strategy.entry_conditions.length} condition{activeSlot?.strategy.entry_conditions.length !== 1 ? "s" : ""} — none triggered
              </div>
            </div>
          )}

          {/* Trade log */}
          {activeTrades.length > 0 && (
            <div className="border-t border-slate-100">
              <div className="px-4 py-2 flex items-center gap-2 bg-slate-50/60">
                <span className="w-2.5 h-2.5 rounded-full" style={{ background: activeSlot?.color }} />
                <span className="text-xs font-semibold text-slate-700">{activeSlot?.label} — Trade Log</span>
                <span className="text-[10px] text-slate-400">{activeTrades.length} trade{activeTrades.length !== 1 ? "s" : ""}</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-slate-100 bg-slate-50/40">
                      <th className="text-left px-3 py-1.5 text-[10px] font-semibold text-slate-400 uppercase">#</th>
                      <th className="text-left px-3 py-1.5 text-[10px] font-semibold text-slate-400 uppercase">Entry</th>
                      <th className="text-right px-3 py-1.5 text-[10px] font-semibold text-slate-400 uppercase">Entry ₹</th>
                      <th className="text-right px-3 py-1.5 text-[10px] font-semibold text-emerald-500 uppercase">Target ₹</th>
                      <th className="text-right px-3 py-1.5 text-[10px] font-semibold text-red-400 uppercase">Stop ₹</th>
                      <th className="text-left px-3 py-1.5 text-[10px] font-semibold text-slate-400 uppercase">Exit</th>
                      <th className="text-right px-3 py-1.5 text-[10px] font-semibold text-slate-400 uppercase">Exit ₹</th>
                      <th className="text-left px-3 py-1.5 text-[10px] font-semibold text-slate-400 uppercase">Result</th>
                      <th className="text-right px-3 py-1.5 text-[10px] font-semibold text-slate-400 uppercase">PnL</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeTrades.map((t, i) => (
                      <tr key={i} className="border-b border-slate-50 hover:bg-slate-50 transition-colors">
                        <td className="px-3 py-1.5 text-slate-400">{i + 1}</td>
                        <td className="px-3 py-1.5 text-slate-600 whitespace-nowrap">{t.entry_date.slice(0, 10)}</td>
                        <td className="px-3 py-1.5 text-right font-medium text-slate-700">₹{fmt(t.entry_price, 2)}</td>
                        <td className="px-3 py-1.5 text-right text-emerald-600 font-medium">₹{fmt(t.target_price, 2)}</td>
                        <td className="px-3 py-1.5 text-right text-red-500 font-medium">₹{fmt(t.sl_price, 2)}</td>
                        <td className="px-3 py-1.5 text-slate-600 whitespace-nowrap">{t.exit_date.slice(0, 10)}</td>
                        <td className="px-3 py-1.5 text-right font-medium text-slate-700">₹{fmt(t.exit_price, 2)}</td>
                        <td className="px-3 py-1.5">
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                            t.exit_reason === "target" ? "bg-emerald-50 text-emerald-600" :
                            t.exit_reason === "sl" ? "bg-red-50 text-red-500" : "bg-slate-100 text-slate-400"
                          }`}>
                            {t.exit_reason === "target" ? "🎯 Target" : t.exit_reason === "sl" ? "🛑 Stop" : "⏱ Time"}
                          </span>
                        </td>
                        <td className={`px-3 py-1.5 text-right font-bold ${pnlClass(t.pnl)}`}>
                          {t.pnl >= 0 ? "+" : ""}₹{fmt(t.pnl)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Right sidebar: recent patterns + trend outlook */}
        <div className="w-72 shrink-0 flex flex-col overflow-y-auto bg-slate-50/30">
          <div className="px-3 pt-3 pb-2 border-b border-slate-100">
            <div className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">
              Recent Patterns · Last 10 Days
            </div>
          </div>
          <div className="flex-1 px-2 py-2 space-y-1.5">
            {chartPatternHits.length === 0 ? (
              <div className="text-[10px] text-slate-400 text-center py-6">No patterns in last 10 trading days</div>
            ) : (
              chartPatternHits.map((p, i) => {
                const bars = CANDLE_BARS[p.label] ?? 1;
                return (
                  <div key={i} className={`px-2 py-1.5 rounded-lg border ${
                    p.bias === "bullish" ? "bg-purple-50 border-purple-100" : "bg-fuchsia-50 border-fuchsia-100"
                  }`}>
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <span className={`font-bold text-[11px] ${p.bias === "bullish" ? "text-purple-600" : "text-fuchsia-600"}`}>{p.label}</span>
                      <span className="text-[9px] text-slate-400 bg-slate-100 rounded px-1">{bars}-bar</span>
                      <span className={`ml-auto text-xs ${p.bias === "bullish" ? "text-purple-400" : "text-fuchsia-400"}`}>
                        {p.bias === "bullish" ? "↑" : "↓"}
                      </span>
                    </div>
                    <div className={`text-[10px] font-semibold ${p.bias === "bullish" ? "text-purple-700" : "text-fuchsia-700"}`}>{p.date}</div>
                    <div className="text-slate-500 text-[9px] leading-tight mt-0.5">{p.tip}</div>
                  </div>
                );
              })
            )}
          </div>
          <div className="border-t border-slate-100 px-3 pt-3 pb-4">
            <div className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mb-2">Trend Outlook</div>
            <TrendOutlook symbol={symbol} data={outlook} loading={outlookLoading} sidebar />
          </div>
        </div>
      </div>
    </section>
  );
}

const STRADDLE_STRATEGIES = [
  { key: "short_straddle" as const, label: "Short Straddle", tip: "Sell ATM CE + ATM PE — profits from premium decay, loses on a big move either way" },
  { key: "long_straddle" as const, label: "Long Straddle", tip: "Buy ATM CE + ATM PE — profits from a big move either way, loses to premium decay" },
  { key: "short_strangle" as const, label: "Short Strangle", tip: "Sell OTM CE + OTM PE — cheaper premium than a straddle, wider profit zone, smaller max profit" },
  { key: "long_strangle" as const, label: "Long Strangle", tip: "Buy OTM CE + OTM PE — cheaper than a long straddle, needs a bigger move to profit" },
];

const EXIT_REASON_LABELS: Record<string, string> = {
  target: "Target Hit",
  sl: "Stoploss Hit",
  expiry: "Expiry Hit",
  data_end: "NA",
};

function OptionsStraddlePanel({
  straddle, results, loading, error, onChange, onRun,
}: {
  straddle: StraddleConfig;
  results: StraddleResult | null;
  loading: boolean;
  error: string | null;
  onChange: (p: Partial<StraddleConfig>) => void;
  onRun: () => void;
}) {
  const isStrangle = straddle.strategy.includes("strangle");
  const isShort = straddle.strategy.startsWith("short");

  const [dataStatus, setDataStatus] = useState<{ earliest_date: string | null; latest_date: string | null; total_days: number } | null>(null);
  const [showFetchPanel, setShowFetchPanel] = useState(false);
  const [selectedTradeIdx, setSelectedTradeIdx] = useState(0);

  const loadDataStatus = useCallback(() => {
    if (!straddle.symbol) return;
    api.fnoDataStatus(straddle.symbol).then(setDataStatus).catch(() => setDataStatus(null));
  }, [straddle.symbol]);

  useEffect(() => { loadDataStatus(); }, [loadDataStatus]);
  useEffect(() => { setSelectedTradeIdx(0); }, [results]);

  return (
    <div className="flex flex-col gap-4">
      <section className="bg-white border border-slate-200 rounded-xl shadow-sm p-4">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-5 h-5 rounded-full bg-blue-500 text-white text-xs flex items-center justify-center font-bold shrink-0">1</div>
          <span className="text-sm font-semibold text-slate-700">Pick Symbol & Data</span>
          <span className="text-xs text-slate-400 ml-1">— choose a symbol, confirm option-chain coverage, and set your backtest window</span>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-2">
          <div>
            <label className="text-xs text-slate-500 mb-1 block">Symbol</label>
            <SymbolCombobox value={straddle.symbol} onChange={(sym) => onChange({ symbol: sym })} />
          </div>
          <div>
            <label className="text-xs text-slate-500 mb-1 block">From Date</label>
            <input type="date" value={straddle.from_date} onChange={(e) => onChange({ from_date: e.target.value })}
              className="w-full text-sm px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:border-blue-400" />
          </div>
          <div>
            <label className="text-xs text-slate-500 mb-1 block">To Date</label>
            <input type="date" value={straddle.to_date} onChange={(e) => onChange({ to_date: e.target.value })}
              className="w-full text-sm px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:border-blue-400" />
          </div>
          <div>
            <label className="text-xs text-slate-500 mb-1 block"
              title="Cash = true spot/index price. Futures = continuous roll-adjusted near-month futures close. This only changes the reference price used for ATM/offset strike selection and P&L mark-to-market — the option chain and available strikes are always the exchange's real (spot-relative) strikes and are unchanged either way.">
              Data Source
            </label>
            <div className="flex rounded-lg overflow-hidden border border-slate-200 text-xs h-[34px]">
              {(["cash", "futures"] as const).map((ds) => (
                <button key={ds} onClick={() => onChange({ data_source: ds })}
                  className={`flex-1 font-medium transition-colors ${
                    straddle.data_source === ds ? "bg-blue-500 text-white" : "text-slate-500 bg-slate-50 hover:bg-slate-100"
                  }`}>
                  {ds === "cash" ? "Cash" : "Futures"}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="mb-3">
          <TimelinePresetButtons onPick={(f, t) => onChange({ from_date: f, to_date: t })} />
        </div>

        {/* Option data coverage for this symbol — the backtest can only trade expiry cycles inside this range */}
        {straddle.symbol && (
          <div className="mb-3 flex items-center gap-2 flex-wrap text-xs">
            {dataStatus?.earliest_date ? (
              <span className="text-slate-500 bg-slate-50 border border-slate-200 rounded-full px-2.5 py-1">
                Option data available: <span className="font-semibold text-slate-700">{dataStatus.earliest_date} → {dataStatus.latest_date}</span> ({dataStatus.total_days} days)
              </span>
            ) : (
              <span className="text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2.5 py-1">
                No option data synced yet for {straddle.symbol}
              </span>
            )}
            <button onClick={() => setShowFetchPanel((v) => !v)}
              className="text-blue-600 hover:underline font-medium">
              {showFetchPanel ? "Hide fetch panel" : "Fetch / extend this range"}
            </button>
          </div>
        )}

        {showFetchPanel && straddle.symbol && (
          <div className="mb-4">
            <FnoFetchPanel
              symbol={straddle.symbol}
              isIndex={INDEX_SYMBOLS.includes(straddle.symbol)}
              onDone={() => { loadDataStatus(); setShowFetchPanel(false); }}
            />
          </div>
        )}

        <AtmDeltaSnapshot symbol={straddle.symbol} hasData={!!dataStatus?.earliest_date} />
      </section>

      <section className="bg-white border border-slate-200 rounded-xl shadow-sm p-4">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-5 h-5 rounded-full bg-blue-500 text-white text-xs flex items-center justify-center font-bold shrink-0">2</div>
          <span className="text-sm font-semibold text-slate-700">Strategy Builder</span>
          <span className="text-xs text-slate-400 ml-1">— one trade per expiry cycle, tracking combined CE+PE premium</span>
        </div>

        <div className="mb-3">
          <label className="text-xs text-slate-500 mb-1.5 block">Strategy</label>
          <div className="flex flex-wrap gap-1.5">
            {STRADDLE_STRATEGIES.map((s) => (
              <button key={s.key} title={s.tip} onClick={() => onChange({ strategy: s.key })}
                className={`px-2.5 py-1.5 text-xs font-medium border rounded-lg transition-colors ${
                  straddle.strategy === s.key
                    ? "bg-blue-500 text-white border-blue-500"
                    : "bg-slate-50 text-slate-600 border-slate-200 hover:border-blue-300 hover:bg-blue-50"
                }`}>
                {s.label}
              </button>
            ))}
          </div>
        </div>

        <div className={`grid gap-3 mb-4 ${isStrangle ? "grid-cols-2 md:grid-cols-5" : "grid-cols-2 md:grid-cols-4"}`}>
          <div>
            <label className="text-xs text-slate-500 mb-1 block">Capital / Trade (₹)</label>
            <input type="number" value={straddle.capital_per_trade}
              onChange={(e) => onChange({ capital_per_trade: parseFloat(e.target.value) })}
              className="w-full text-sm px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:border-blue-400" />
          </div>
          {isStrangle && (
            <div>
              <label className="text-xs text-slate-500 mb-1 block">Strangle Width %</label>
              <input type="number" step="0.5" value={straddle.strangle_width_pct}
                onChange={(e) => onChange({ strangle_width_pct: parseFloat(e.target.value) })}
                className="w-full text-sm px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:border-blue-400" />
            </div>
          )}
          <div>
            <label className="text-xs text-slate-500 mb-1 block" title="Enter once days-to-expiry drops to this many">Entry DTE</label>
            <input type="number" value={straddle.entry_dte}
              onChange={(e) => onChange({ entry_dte: parseInt(e.target.value) })}
              className="w-full text-sm px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:border-blue-400" />
          </div>
          <div>
            <label className="text-xs text-slate-500 mb-1 block">Target %</label>
            <input type="number" step="1" value={straddle.target_pct}
              onChange={(e) => onChange({ target_pct: parseFloat(e.target.value) })}
              className="w-full text-sm px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:border-blue-400" />
          </div>
          <div>
            <label className="text-xs text-slate-500 mb-1 block">Stop-Loss %</label>
            <input type="number" step="1" value={straddle.sl_pct}
              onChange={(e) => onChange({ sl_pct: parseFloat(e.target.value) })}
              className="w-full text-sm px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:border-blue-400" />
          </div>
          <div>
            <label className="text-xs text-slate-500 mb-1 block" title="Force-close once days-to-expiry drops to this many, regardless of P&L">Force Exit DTE</label>
            <input type="number" value={straddle.force_exit_dte}
              onChange={(e) => onChange({ force_exit_dte: parseInt(e.target.value) })}
              className="w-full text-sm px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:border-blue-400" />
          </div>
        </div>

        <button onClick={onRun} disabled={!straddle.symbol || loading}
          className="flex items-center gap-2 px-5 py-2 bg-blue-500 hover:bg-blue-600 disabled:opacity-40 text-white text-sm font-medium rounded-lg transition-colors">
          {loading
            ? <><span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin shrink-0" /> Running…</>
            : <><Play size={13} /> Run Backtest</>}
        </button>
      </section>

      {error && (
        <div className="flex items-center gap-2 px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
          <AlertCircle size={16} className="shrink-0" />
          {error}
        </div>
      )}

      {results && (
        <section className="bg-white border border-slate-200 rounded-xl shadow-sm p-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            {[
              { label: "Total Trades", value: results.stats.total_trades },
              { label: "Win Rate", value: `${results.stats.win_rate_pct}%` },
              { label: "Total P&L", value: `₹${results.stats.total_pnl.toLocaleString("en-IN")}`, color: results.stats.total_pnl >= 0 ? "text-emerald-600" : "text-red-600" },
              { label: "Avg P&L %", value: `${results.stats.avg_pnl_pct}%`, color: results.stats.avg_pnl_pct >= 0 ? "text-emerald-600" : "text-red-600" },
            ].map((m) => (
              <div key={m.label} className="bg-slate-50 border border-slate-200 rounded-lg p-3">
                <div className="text-[10px] text-slate-400 uppercase tracking-wide font-semibold">{m.label}</div>
                <div className={`text-lg font-bold ${m.color ?? "text-slate-800"}`}>{m.value}</div>
              </div>
            ))}
          </div>

          {results.ohlcv.length > 0 && (
            <div className="mb-4 border border-slate-200 rounded-lg overflow-hidden">
              <BacktestChart
                symbol={straddle.symbol}
                ohlcv={results.ohlcv}
                hLines={false}
                trades={results.trades.map((t) => ({
                  entry_date: t.entry_date, exit_date: t.exit_date,
                  entry_price: 0, target_price: 0, sl_price: 0, exit_price: 0,
                  exit_reason: t.exit_reason === "target" ? "target" : t.exit_reason === "sl" ? "sl" : "timeout",
                  pnl: t.pnl_amount, pnl_pct: t.pnl_pct, shares: 1,
                }))}
              />
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-[10px] text-slate-500 uppercase bg-slate-50 border-b border-slate-200">
                  <th className="text-left px-3 py-2 font-semibold">Expiry</th>
                  <th className="text-left px-3 py-2 font-semibold">Entry</th>
                  <th className="text-left px-3 py-2 font-semibold">Exit</th>
                  <th className="text-right px-3 py-2 font-semibold">{isStrangle ? "Call / Put Strike" : "Strike"}</th>
                  <th className="text-right px-3 py-2 font-semibold" title="CE leg premium, entry → exit">CE Premium</th>
                  <th className="text-right px-3 py-2 font-semibold" title="PE leg premium, entry → exit">PE Premium</th>
                  <th className="text-right px-3 py-2 font-semibold">Entry Premium</th>
                  <th className="text-right px-3 py-2 font-semibold" title="Premium level that closes the trade in profit">Target Premium</th>
                  <th className="text-right px-3 py-2 font-semibold" title="Premium level that closes the trade at a loss">Stop-Loss Premium</th>
                  <th className="text-right px-3 py-2 font-semibold">Exit Premium</th>
                  <th className="text-right px-3 py-2 font-semibold">P&L %</th>
                  <th className="text-right px-3 py-2 font-semibold">P&L ₹</th>
                  <th className="text-left px-3 py-2 font-semibold">Reason</th>
                </tr>
              </thead>
              <tbody>
                {results.trades.map((t, i) => {
                  const targetPremium = isShort
                    ? t.entry_premium * (1 - straddle.target_pct / 100)
                    : t.entry_premium * (1 + straddle.target_pct / 100);
                  const slPremium = isShort
                    ? t.entry_premium * (1 + straddle.sl_pct / 100)
                    : t.entry_premium * (1 - straddle.sl_pct / 100);
                  return (
                  <tr key={i}
                    onClick={() => setSelectedTradeIdx(i)}
                    className={`border-b border-slate-50 cursor-pointer transition-colors ${
                      i === selectedTradeIdx ? "bg-blue-50" : "hover:bg-slate-50/50"
                    }`}>
                    <td className="px-3 py-1.5 font-medium text-slate-700">{t.expiry}</td>
                    <td className="px-3 py-1.5 text-slate-500">{t.entry_date}</td>
                    <td className="px-3 py-1.5 text-slate-500">{t.exit_date}</td>
                    <td className="text-right px-3 py-1.5 font-semibold">
                      {isStrangle ? `${t.call_strike} / ${t.put_strike}` : t.call_strike}
                    </td>
                    <td className="text-right px-3 py-1.5">{t.entry_ce} → {t.exit_ce}</td>
                    <td className="text-right px-3 py-1.5">{t.entry_pe} → {t.exit_pe}</td>
                    <td className="text-right px-3 py-1.5">{t.entry_premium}</td>
                    <td className="text-right px-3 py-1.5 text-emerald-600">{Math.max(0, targetPremium).toFixed(2)}</td>
                    <td className="text-right px-3 py-1.5 text-red-600">{slPremium.toFixed(2)}</td>
                    <td className="text-right px-3 py-1.5">{t.exit_premium}</td>
                    <td className={`text-right px-3 py-1.5 font-medium ${t.pnl_pct >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                      {t.pnl_pct >= 0 ? "+" : ""}{t.pnl_pct}%
                    </td>
                    <td className={`text-right px-3 py-1.5 font-medium ${t.pnl_amount >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                      {t.pnl_amount >= 0 ? "+" : ""}₹{t.pnl_amount.toLocaleString("en-IN")}
                    </td>
                    <td className="px-3 py-1.5 text-slate-500">{EXIT_REASON_LABELS[t.exit_reason] ?? t.exit_reason}</td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="text-[10px] text-slate-400 mt-3 leading-relaxed">
            {isShort ? "Short strategy: profit = premium decay (entry − exit)." : "Long strategy: profit = premium gain (exit − entry)."}
            {" "}IV/premium data is EOD-only (no intraday fills) — real slippage and bid/ask spread aren't modeled.
            {straddle.data_source === "futures" && " Reference price for this run: continuous roll-adjusted futures close, not spot."}
          </div>
        </section>
      )}
    </div>
  );
}

const SPREAD_STRATEGIES = [
  { key: "bull_call_spread" as const, label: "Bull Call Spread", tip: "Buy a call, sell a further OTM call — defined-risk bullish bet, cheaper than a naked call" },
  { key: "bear_put_spread" as const, label: "Bear Put Spread", tip: "Buy a put, sell a further OTM put — defined-risk bearish bet, cheaper than a naked put" },
  { key: "iron_condor" as const, label: "Iron Condor", tip: "Sell an OTM call + OTM put, buy further OTM wings for protection — defined-risk bet that price stays range-bound" },
];

function OptionsSpreadPanel({
  spread, results, loading, error, onChange, onRun,
}: {
  spread: SpreadConfig;
  results: SpreadResult | null;
  loading: boolean;
  error: string | null;
  onChange: (p: Partial<SpreadConfig>) => void;
  onRun: () => void;
}) {
  const isCondor = spread.strategy === "iron_condor";

  const [dataStatus, setDataStatus] = useState<{ earliest_date: string | null; latest_date: string | null; total_days: number } | null>(null);
  const [showFetchPanel, setShowFetchPanel] = useState(false);
  const [selectedTradeIdx, setSelectedTradeIdx] = useState(0);

  const loadDataStatus = useCallback(() => {
    if (!spread.symbol) return;
    api.fnoDataStatus(spread.symbol).then(setDataStatus).catch(() => setDataStatus(null));
  }, [spread.symbol]);

  useEffect(() => { loadDataStatus(); }, [loadDataStatus]);
  useEffect(() => { setSelectedTradeIdx(0); }, [results]);

  const selectedTrade = results?.trades[selectedTradeIdx] ?? results?.trades[0];

  return (
    <div className="flex flex-col gap-4">
      <section className="bg-white border border-slate-200 rounded-xl shadow-sm p-4">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-5 h-5 rounded-full bg-blue-500 text-white text-xs flex items-center justify-center font-bold shrink-0">1</div>
          <span className="text-sm font-semibold text-slate-700">Pick Symbol & Data</span>
          <span className="text-xs text-slate-400 ml-1">— choose a symbol, confirm option-chain coverage, and set your backtest window</span>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-2">
          <div>
            <label className="text-xs text-slate-500 mb-1 block">Symbol</label>
            <SymbolCombobox value={spread.symbol} onChange={(sym) => onChange({ symbol: sym })} />
          </div>
          <div>
            <label className="text-xs text-slate-500 mb-1 block">From Date</label>
            <input type="date" value={spread.from_date} onChange={(e) => onChange({ from_date: e.target.value })}
              className="w-full text-sm px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:border-blue-400" />
          </div>
          <div>
            <label className="text-xs text-slate-500 mb-1 block">To Date</label>
            <input type="date" value={spread.to_date} onChange={(e) => onChange({ to_date: e.target.value })}
              className="w-full text-sm px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:border-blue-400" />
          </div>
          <div>
            <label className="text-xs text-slate-500 mb-1 block"
              title="Cash = true spot/index price. Futures = continuous roll-adjusted near-month futures close. This only changes the reference price used for ATM/offset strike selection and P&L mark-to-market — the option chain and available strikes are always the exchange's real (spot-relative) strikes and are unchanged either way.">
              Data Source
            </label>
            <div className="flex rounded-lg overflow-hidden border border-slate-200 text-xs h-[34px]">
              {(["cash", "futures"] as const).map((ds) => (
                <button key={ds} onClick={() => onChange({ data_source: ds })}
                  className={`flex-1 font-medium transition-colors ${
                    spread.data_source === ds ? "bg-blue-500 text-white" : "text-slate-500 bg-slate-50 hover:bg-slate-100"
                  }`}>
                  {ds === "cash" ? "Cash" : "Futures"}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="mb-3">
          <TimelinePresetButtons onPick={(f, t) => onChange({ from_date: f, to_date: t })} />
        </div>

        {/* Option data coverage for this symbol — the backtest can only trade expiry cycles inside this range */}
        {spread.symbol && (
          <div className="mb-3 flex items-center gap-2 flex-wrap text-xs">
            {dataStatus?.earliest_date ? (
              <span className="text-slate-500 bg-slate-50 border border-slate-200 rounded-full px-2.5 py-1">
                Option data available: <span className="font-semibold text-slate-700">{dataStatus.earliest_date} → {dataStatus.latest_date}</span> ({dataStatus.total_days} days)
              </span>
            ) : (
              <span className="text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2.5 py-1">
                No option data synced yet for {spread.symbol}
              </span>
            )}
            <button onClick={() => setShowFetchPanel((v) => !v)}
              className="text-blue-600 hover:underline font-medium">
              {showFetchPanel ? "Hide fetch panel" : "Fetch / extend this range"}
            </button>
          </div>
        )}

        {showFetchPanel && spread.symbol && (
          <div className="mb-4">
            <FnoFetchPanel
              symbol={spread.symbol}
              isIndex={INDEX_SYMBOLS.includes(spread.symbol)}
              onDone={() => { loadDataStatus(); setShowFetchPanel(false); }}
            />
          </div>
        )}

        <AtmDeltaSnapshot symbol={spread.symbol} hasData={!!dataStatus?.earliest_date} />
      </section>

      <section className="bg-white border border-slate-200 rounded-xl shadow-sm p-4">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-5 h-5 rounded-full bg-blue-500 text-white text-xs flex items-center justify-center font-bold shrink-0">2</div>
          <span className="text-sm font-semibold text-slate-700">Strategy Builder</span>
          <span className="text-xs text-slate-400 ml-1">— defined-risk multi-leg strategies, one trade per expiry cycle</span>
        </div>

        <div className="grid grid-cols-2 gap-3 mb-3">
          <div>
            <label className="text-xs text-slate-500 mb-1 block">Capital / Trade (₹)</label>
            <input type="number" value={spread.capital_per_trade}
              onChange={(e) => onChange({ capital_per_trade: parseFloat(e.target.value) })}
              className="w-full text-sm px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:border-blue-400" />
          </div>
        </div>

        <div className="mb-3">
          <label className="text-xs text-slate-500 mb-1.5 block">Strategy</label>
          <div className="flex flex-wrap gap-1.5">
            {SPREAD_STRATEGIES.map((s) => (
              <button key={s.key} title={s.tip} onClick={() => onChange({ strategy: s.key })}
                className={`px-2.5 py-1.5 text-xs font-medium border rounded-lg transition-colors ${
                  spread.strategy === s.key
                    ? "bg-blue-500 text-white border-blue-500"
                    : "bg-slate-50 text-slate-600 border-slate-200 hover:border-blue-300 hover:bg-blue-50"
                }`}>
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {isCondor ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
            <div>
              <label className="text-xs text-slate-500 mb-1 block" title="OTM distance for the short call (closer to spot)">Short Call OTM %</label>
              <input type="number" step="0.5" value={spread.condor_call_short_pct}
                onChange={(e) => onChange({ condor_call_short_pct: parseFloat(e.target.value) })}
                className="w-full text-sm px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:border-blue-400" />
            </div>
            <div>
              <label className="text-xs text-slate-500 mb-1 block" title="OTM distance for the protective long call (further out)">Long Call OTM %</label>
              <input type="number" step="0.5" value={spread.condor_call_long_pct}
                onChange={(e) => onChange({ condor_call_long_pct: parseFloat(e.target.value) })}
                className="w-full text-sm px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:border-blue-400" />
            </div>
            <div>
              <label className="text-xs text-slate-500 mb-1 block" title="OTM distance for the short put (closer to spot)">Short Put OTM %</label>
              <input type="number" step="0.5" value={spread.condor_put_short_pct}
                onChange={(e) => onChange({ condor_put_short_pct: parseFloat(e.target.value) })}
                className="w-full text-sm px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:border-blue-400" />
            </div>
            <div>
              <label className="text-xs text-slate-500 mb-1 block" title="OTM distance for the protective long put (further out)">Long Put OTM %</label>
              <input type="number" step="0.5" value={spread.condor_put_long_pct}
                onChange={(e) => onChange({ condor_put_long_pct: parseFloat(e.target.value) })}
                className="w-full text-sm px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:border-blue-400" />
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
            <div>
              <label className="text-xs text-slate-500 mb-1 block" title="ATM/OTM distance for the long (directional) leg">Long Leg Offset %</label>
              <input type="number" step="0.5" value={spread.long_offset_pct}
                onChange={(e) => onChange({ long_offset_pct: parseFloat(e.target.value) })}
                className="w-full text-sm px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:border-blue-400" />
            </div>
            <div>
              <label className="text-xs text-slate-500 mb-1 block" title="OTM distance for the short leg">Short Leg Offset %</label>
              <input type="number" step="0.5" value={spread.short_offset_pct}
                onChange={(e) => onChange({ short_offset_pct: parseFloat(e.target.value) })}
                className="w-full text-sm px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:border-blue-400" />
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          <div>
            <label className="text-xs text-slate-500 mb-1 block" title="Enter once days-to-expiry drops to this many">Entry DTE</label>
            <input type="number" value={spread.entry_dte}
              onChange={(e) => onChange({ entry_dte: parseInt(e.target.value) })}
              className="w-full text-sm px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:border-blue-400" />
          </div>
          <div>
            <label className="text-xs text-slate-500 mb-1 block" title="% of max profit captured before closing">Target % (of max profit)</label>
            <input type="number" step="1" value={spread.target_pct}
              onChange={(e) => onChange({ target_pct: parseFloat(e.target.value) })}
              className="w-full text-sm px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:border-blue-400" />
          </div>
          <div>
            <label className="text-xs text-slate-500 mb-1 block" title="% of max loss incurred before closing">Stop-Loss % (of max loss)</label>
            <input type="number" step="1" value={spread.sl_pct}
              onChange={(e) => onChange({ sl_pct: parseFloat(e.target.value) })}
              className="w-full text-sm px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:border-blue-400" />
          </div>
          <div>
            <label className="text-xs text-slate-500 mb-1 block" title="Force-close once days-to-expiry drops to this many, regardless of P&L">Force Exit DTE</label>
            <input type="number" value={spread.force_exit_dte}
              onChange={(e) => onChange({ force_exit_dte: parseInt(e.target.value) })}
              className="w-full text-sm px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:border-blue-400" />
          </div>
        </div>

        <button onClick={onRun} disabled={!spread.symbol || loading}
          className="flex items-center gap-2 px-5 py-2 bg-blue-500 hover:bg-blue-600 disabled:opacity-40 text-white text-sm font-medium rounded-lg transition-colors">
          {loading
            ? <><span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin shrink-0" /> Running…</>
            : <><Play size={13} /> Run Backtest</>}
        </button>
      </section>

      {error && (
        <div className="flex items-center gap-2 px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
          <AlertCircle size={16} className="shrink-0" />
          {error}
        </div>
      )}

      {results && (
        <section className="bg-white border border-slate-200 rounded-xl shadow-sm p-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            {[
              { label: "Total Trades", value: results.stats.total_trades },
              { label: "Win Rate", value: `${results.stats.win_rate_pct}%` },
              { label: "Total P&L", value: `₹${results.stats.total_pnl.toLocaleString("en-IN")}`, color: results.stats.total_pnl >= 0 ? "text-emerald-600" : "text-red-600" },
              { label: "Avg P&L %", value: `${results.stats.avg_pnl_pct}%`, color: results.stats.avg_pnl_pct >= 0 ? "text-emerald-600" : "text-red-600" },
            ].map((m) => (
              <div key={m.label} className="bg-slate-50 border border-slate-200 rounded-lg p-3">
                <div className="text-[10px] text-slate-400 uppercase tracking-wide font-semibold">{m.label}</div>
                <div className={`text-lg font-bold ${m.color ?? "text-slate-800"}`}>{m.value}</div>
              </div>
            ))}
          </div>

          {results.ohlcv.length > 0 && selectedTrade && (
            <div className="mb-4 border border-slate-200 rounded-lg overflow-hidden">
              <BacktestChart
                symbol={spread.symbol}
                ohlcv={results.ohlcv}
                hLines={false}
                trades={results.trades.map((t) => ({
                  entry_date: t.entry_date, exit_date: t.exit_date,
                  entry_price: 0, target_price: 0, sl_price: 0, exit_price: 0,
                  exit_reason: t.exit_reason === "target" ? "target" : t.exit_reason === "sl" ? "sl" : "timeout",
                  pnl: t.pnl_amount, pnl_pct: t.pnl_pct, shares: 1,
                }))}
                strikeLines={[{
                  entry_date: selectedTrade.entry_date, exit_date: selectedTrade.exit_date,
                  call_strike: Math.max(...selectedTrade.legs.map((l) => l.strike)),
                  put_strike: Math.min(...selectedTrade.legs.map((l) => l.strike)),
                }]}
              />
            </div>
          )}

          <div className="overflow-x-auto mb-4">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-[10px] text-slate-500 uppercase bg-slate-50 border-b border-slate-200">
                  <th className="text-left px-3 py-2 font-semibold">Expiry</th>
                  <th className="text-left px-3 py-2 font-semibold">Entry</th>
                  <th className="text-left px-3 py-2 font-semibold">Exit</th>
                  <th className="text-right px-3 py-2 font-semibold" title="Net debit paid (positive) or credit received (negative)">Entry Value</th>
                  <th className="text-right px-3 py-2 font-semibold">Exit Value</th>
                  <th className="text-right px-3 py-2 font-semibold">Max Profit</th>
                  <th className="text-right px-3 py-2 font-semibold">Max Loss</th>
                  <th className="text-right px-3 py-2 font-semibold">P&L %</th>
                  <th className="text-right px-3 py-2 font-semibold">P&L ₹</th>
                  <th className="text-left px-3 py-2 font-semibold">Reason</th>
                </tr>
              </thead>
              <tbody>
                {results.trades.map((t, i) => (
                  <tr key={i}
                    onClick={() => setSelectedTradeIdx(i)}
                    className={`border-b border-slate-50 cursor-pointer transition-colors ${
                      i === selectedTradeIdx ? "bg-blue-50" : "hover:bg-slate-50/50"
                    }`}>
                    <td className="px-3 py-1.5 font-medium text-slate-700">{t.expiry}</td>
                    <td className="px-3 py-1.5 text-slate-500">{t.entry_date}</td>
                    <td className="px-3 py-1.5 text-slate-500">{t.exit_date}</td>
                    <td className="text-right px-3 py-1.5">{t.entry_value}</td>
                    <td className="text-right px-3 py-1.5">{t.exit_value}</td>
                    <td className="text-right px-3 py-1.5 text-emerald-600">{t.max_profit}</td>
                    <td className="text-right px-3 py-1.5 text-red-600">{t.max_loss}</td>
                    <td className={`text-right px-3 py-1.5 font-medium ${t.pnl_pct >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                      {t.pnl_pct >= 0 ? "+" : ""}{t.pnl_pct}%
                    </td>
                    <td className={`text-right px-3 py-1.5 font-medium ${t.pnl_amount >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                      {t.pnl_amount >= 0 ? "+" : ""}₹{t.pnl_amount.toLocaleString("en-IN")}
                    </td>
                    <td className="px-3 py-1.5 text-slate-500">{EXIT_REASON_LABELS[t.exit_reason] ?? t.exit_reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {selectedTrade && (
            <div className="border border-slate-200 rounded-lg overflow-hidden">
              <div className="px-3 py-2 bg-slate-50 border-b border-slate-100 text-xs font-semibold text-slate-600">
                Legs — {selectedTrade.entry_date} → {selectedTrade.exit_date}
              </div>
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-[10px] text-slate-400 uppercase border-b border-slate-100">
                    <th className="text-left px-3 py-1.5 font-semibold">Leg</th>
                    <th className="text-left px-3 py-1.5 font-semibold">Type</th>
                    <th className="text-left px-3 py-1.5 font-semibold">Direction</th>
                    <th className="text-right px-3 py-1.5 font-semibold">Strike</th>
                    <th className="text-right px-3 py-1.5 font-semibold">Entry Premium</th>
                    <th className="text-right px-3 py-1.5 font-semibold">Exit Premium</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedTrade.legs.map((l, i) => (
                    <tr key={i} className="border-b border-slate-50 last:border-0">
                      <td className="px-3 py-1.5 text-slate-600 capitalize">{l.leg.replace("_", " ")}</td>
                      <td className="px-3 py-1.5 text-slate-600">{l.option_type}</td>
                      <td className={`px-3 py-1.5 font-medium ${l.direction > 0 ? "text-emerald-600" : "text-red-600"}`}>
                        {l.direction > 0 ? "Buy" : "Sell"}
                      </td>
                      <td className="text-right px-3 py-1.5 font-semibold">{l.strike}</td>
                      <td className="text-right px-3 py-1.5">{l.entry_price}</td>
                      <td className="text-right px-3 py-1.5">{l.exit_price}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="text-[10px] text-slate-400 mt-3 leading-relaxed">
            P&L % is relative to max profit for the strategy (a defined-risk trade), not to premium paid/received.
            {" "}IV/premium data is EOD-only (no intraday fills) — real slippage and bid/ask spread aren't modeled.
            {spread.data_source === "futures" && " Reference price for this run: continuous roll-adjusted futures close, not spot."}
          </div>
        </section>
      )}
    </div>
  );
}

const ORB_INTERVALS = ["1m", "5m", "15m", "30m", "60m"] as const;
const ORB_DIRECTIONS = ["long_only", "short_only", "both"] as const;

function OrbPanel({
  orb, results, loading, error, onChange, onRun,
}: {
  orb: ORBConfig;
  results: ORBResult | null;
  loading: boolean;
  error: string | null;
  onChange: (p: Partial<ORBConfig>) => void;
  onRun: () => void;
}) {
  const [dataStatus, setDataStatus] = useState<{ earliest_datetime: string | null; latest_datetime: string | null; total_bars: number } | null>(null);
  const [showFetchPanel, setShowFetchPanel] = useState(false);
  const [selectedTradeIdx, setSelectedTradeIdx] = useState(0);

  const loadDataStatus = useCallback(() => {
    if (!orb.symbol) return;
    api.intradayDataStatus(orb.symbol, orb.interval).then(setDataStatus).catch(() => setDataStatus(null));
  }, [orb.symbol, orb.interval]);

  useEffect(() => { loadDataStatus(); }, [loadDataStatus]);
  useEffect(() => { setSelectedTradeIdx(0); }, [results]);

  const selectedTrade = results?.trades[selectedTradeIdx] ?? results?.trades[0];

  return (
    <div className="flex flex-col gap-4">
      <section className="bg-white border border-slate-200 rounded-xl shadow-sm p-4">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-5 h-5 rounded-full bg-blue-500 text-white text-xs flex items-center justify-center font-bold shrink-0">1</div>
          <span className="text-sm font-semibold text-slate-700">Pick Symbol & Data</span>
          <span className="text-xs text-slate-400 ml-1">— choose a symbol/interval, confirm intraday coverage, and set your backtest window</span>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-2">
          <div>
            <label className="text-xs text-slate-500 mb-1 block">Symbol</label>
            <SymbolCombobox value={orb.symbol} onChange={(sym) => onChange({ symbol: sym })} placeholder="RELIANCE, NIFTY…" />
          </div>
          <div>
            <label className="text-xs text-slate-500 mb-1 block">Interval</label>
            <select value={orb.interval} onChange={(e) => onChange({ interval: e.target.value as ORBConfig["interval"] })}
              className="w-full text-sm px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:border-blue-400">
              {ORB_INTERVALS.map((iv) => <option key={iv} value={iv}>{iv}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-slate-500 mb-1 block">From Date</label>
            <input type="date" value={orb.from_date} onChange={(e) => onChange({ from_date: e.target.value })}
              className="w-full text-sm px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:border-blue-400" />
          </div>
          <div>
            <label className="text-xs text-slate-500 mb-1 block">To Date</label>
            <input type="date" value={orb.to_date} onChange={(e) => onChange({ to_date: e.target.value })}
              className="w-full text-sm px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:border-blue-400" />
          </div>
        </div>

        <div className="mb-3">
          <TimelinePresetButtons onPick={(f, t) => onChange({ from_date: f, to_date: t })} />
        </div>

        {/* Intraday data coverage for this symbol/interval */}
        {orb.symbol && (
          <div className="mb-3 flex items-center gap-2 flex-wrap text-xs">
            {dataStatus?.earliest_datetime ? (
              <span className="text-slate-500 bg-slate-50 border border-slate-200 rounded-full px-2.5 py-1">
                Intraday data available: <span className="font-semibold text-slate-700">{dataStatus.earliest_datetime} → {dataStatus.latest_datetime}</span> ({dataStatus.total_bars} bars)
              </span>
            ) : (
              <span className="text-amber-600 bg-amber-50 border border-amber-200 rounded-full px-2.5 py-1">No intraday data synced yet for {orb.symbol} ({orb.interval})</span>
            )}
            <button onClick={() => setShowFetchPanel((s) => !s)}
              className="text-blue-600 hover:text-blue-700 font-medium underline underline-offset-2">
              {showFetchPanel ? "Hide fetch panel" : "Fetch / extend this range"}
            </button>
          </div>
        )}

        {showFetchPanel && orb.symbol && (
          <div className="mb-3">
            <IntradayFetchPanel symbol={orb.symbol} interval={orb.interval} onDone={() => { setShowFetchPanel(false); loadDataStatus(); }} />
          </div>
        )}

        <div className="text-[10px] text-slate-400 leading-relaxed">
          Opening Range Breakout requires intraday data fetched on-demand via Yahoo Finance — lookback is
          limited (~7 days for 1-minute bars, ~60 days for 5/15/30-minute bars). This is a standalone intraday
          backtester, separate from the daily-bar condition-based Backtest engine.
        </div>
      </section>

      <section className="bg-white border border-slate-200 rounded-xl shadow-sm p-4">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-5 h-5 rounded-full bg-blue-500 text-white text-xs flex items-center justify-center font-bold shrink-0">2</div>
          <span className="text-sm font-semibold text-slate-700">Strategy Builder</span>
          <span className="text-xs text-slate-400 ml-1">— intraday, one trade per day max, no overnight holds</span>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
          <div>
            <label className="text-xs text-slate-500 mb-1 block" title="Length of the opening-range window in minutes">OR Minutes</label>
            <input type="number" value={orb.or_minutes} onChange={(e) => onChange({ or_minutes: parseInt(e.target.value) })}
              className="w-full text-sm px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:border-blue-400" />
          </div>
          <div>
            <label className="text-xs text-slate-500 mb-1 block">Direction</label>
            <select value={orb.direction} onChange={(e) => onChange({ direction: e.target.value as ORBConfig["direction"] })}
              className="w-full text-sm px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:border-blue-400">
              {ORB_DIRECTIONS.map((d) => <option key={d} value={d}>{d.replace("_", " ")}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-slate-500 mb-1 block">Target %</label>
            <input type="number" step="0.1" value={orb.target_pct} onChange={(e) => onChange({ target_pct: parseFloat(e.target.value) })}
              className="w-full text-sm px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:border-blue-400" />
          </div>
          <div>
            <label className="text-xs text-slate-500 mb-1 block">Stop Loss %</label>
            <input type="number" step="0.1" value={orb.sl_pct} onChange={(e) => onChange({ sl_pct: parseFloat(e.target.value) })}
              className="w-full text-sm px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:border-blue-400" />
          </div>
          <div>
            <label className="text-xs text-slate-500 mb-1 block" title="Force-flatten time (HH:MM) — no overnight holds">Force Exit</label>
            <input value={orb.force_exit_time} onChange={(e) => onChange({ force_exit_time: e.target.value })}
              placeholder="15:20"
              className="w-full text-sm px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:border-blue-400" />
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          <div>
            <label className="text-xs text-slate-500 mb-1 block">Capital / Trade (₹)</label>
            <input type="number" value={orb.capital_per_trade} onChange={(e) => onChange({ capital_per_trade: parseFloat(e.target.value) })}
              className="w-full text-sm px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:border-blue-400" />
          </div>
        </div>

        <button onClick={onRun} disabled={!orb.symbol || loading}
          className="flex items-center gap-2 px-5 py-2 bg-blue-500 hover:bg-blue-600 disabled:opacity-40 text-white text-sm font-medium rounded-lg transition-colors">
          {loading
            ? <><span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin shrink-0" /> Running…</>
            : <><Play size={13} /> Run ORB Backtest</>}
        </button>
      </section>

      {error && (
        <div className="flex items-center gap-2 px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
          <AlertCircle size={16} className="shrink-0" />
          {error}
        </div>
      )}

      {results && (
        <>
          <section className="bg-white border border-slate-200 rounded-xl shadow-sm p-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div>
                <div className="text-[10px] text-slate-400 uppercase tracking-wide">Total Trades</div>
                <div className="text-lg font-bold text-slate-800">{results.stats.total_trades}</div>
              </div>
              <div>
                <div className="text-[10px] text-slate-400 uppercase tracking-wide">Win Rate</div>
                <div className="text-lg font-bold text-slate-800">{results.stats.win_rate_pct.toFixed(1)}%</div>
              </div>
              <div>
                <div className="text-[10px] text-slate-400 uppercase tracking-wide">Total P&L</div>
                <div className={`text-lg font-bold ${results.stats.total_pnl >= 0 ? "text-emerald-600" : "text-red-500"}`}>
                  ₹{fmt(results.stats.total_pnl, 2)}
                </div>
              </div>
              <div>
                <div className="text-[10px] text-slate-400 uppercase tracking-wide">Avg P&L %</div>
                <div className={`text-lg font-bold ${results.stats.avg_pnl_pct >= 0 ? "text-emerald-600" : "text-red-500"}`}>
                  {results.stats.avg_pnl_pct.toFixed(2)}%
                </div>
              </div>
            </div>
          </section>

          {selectedTrade && selectedTrade.bars.length > 0 && (
            <section className="bg-white border border-slate-200 rounded-xl shadow-sm p-4">
              <div className="text-sm font-semibold text-slate-700 mb-1">
                {selectedTrade.trade_date} — {selectedTrade.direction} trade ({orb.interval} bars)
              </div>
              <div className="text-[10px] text-slate-400 mb-3">Click a row in the table below to view a different trading day</div>
              <div className="border border-slate-200 rounded-lg overflow-hidden">
                <OrbTradeChart
                  bars={selectedTrade.bars}
                  orHigh={selectedTrade.or_high}
                  orLow={selectedTrade.or_low}
                  direction={selectedTrade.direction as "long" | "short"}
                  entryTime={selectedTrade.entry_time}
                  entryPrice={selectedTrade.entry_price}
                  targetPrice={selectedTrade.target_price}
                  slPrice={selectedTrade.sl_price}
                  exitTime={selectedTrade.exit_time}
                  exitPrice={selectedTrade.exit_price}
                  exitReason={selectedTrade.exit_reason}
                />
              </div>
            </section>
          )}

          <section className="bg-white border border-slate-200 rounded-xl shadow-sm p-4">
            <div className="text-sm font-semibold text-slate-700 mb-3">Trades</div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-slate-400 text-left border-b border-slate-100">
                    <th className="py-1.5 pr-3">Date</th>
                    <th className="py-1.5 pr-3">Dir</th>
                    <th className="py-1.5 pr-3 text-right">OR High</th>
                    <th className="py-1.5 pr-3 text-right">OR Low</th>
                    <th className="py-1.5 pr-3">Entry</th>
                    <th className="py-1.5 pr-3 text-right">Entry ₹</th>
                    <th className="py-1.5 pr-3">Exit</th>
                    <th className="py-1.5 pr-3 text-right">Exit ₹</th>
                    <th className="py-1.5 pr-3 text-right">P&L %</th>
                    <th className="py-1.5 pr-3 text-right">P&L ₹</th>
                    <th className="py-1.5 pr-3">Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {results.trades.map((t, i) => (
                    <tr key={i}
                      onClick={() => setSelectedTradeIdx(i)}
                      className={`border-b border-slate-50 cursor-pointer transition-colors ${
                        i === selectedTradeIdx ? "bg-blue-50" : "hover:bg-slate-50/50"
                      }`}>
                      <td className="py-1.5 pr-3 font-semibold text-slate-700">{t.trade_date}</td>
                      <td className="py-1.5 pr-3 capitalize">{t.direction}</td>
                      <td className="py-1.5 pr-3 text-right text-slate-500">{t.or_high}</td>
                      <td className="py-1.5 pr-3 text-right text-slate-500">{t.or_low}</td>
                      <td className="py-1.5 pr-3 text-slate-500">{t.entry_time.slice(11, 16)}</td>
                      <td className="py-1.5 pr-3 text-right">{t.entry_price}</td>
                      <td className="py-1.5 pr-3 text-slate-500">{t.exit_time.slice(11, 16)}</td>
                      <td className="py-1.5 pr-3 text-right">{t.exit_price}</td>
                      <td className={`py-1.5 pr-3 text-right font-medium ${t.pnl_pct >= 0 ? "text-emerald-600" : "text-red-500"}`}>{t.pnl_pct.toFixed(2)}%</td>
                      <td className={`py-1.5 pr-3 text-right font-medium ${t.pnl_amount >= 0 ? "text-emerald-600" : "text-red-500"}`}>₹{fmt(t.pnl_amount, 2)}</td>
                      <td className="py-1.5 pr-3 text-slate-400">{t.exit_reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

// ── Grid Search panel ────────────────────────────────────────────────────────

function isNumericRight(right: string): boolean {
  return right.trim() !== "" && !isNaN(Number(right));
}

function GridSearchPanel() {
  const { pickedSymbols, grid, gridResults, gridLoading, gridError, gridProgress,
          gridSweepables, setGrid, loadGridSweepables, runGridSearch } = useBacktestStore();
  const [activePreset, setActivePreset] = useState<string | null>("RSI Oversold Bounce");
  const [rawVals, setRawVals] = useState<string[]>(() => grid.sweep_dims.map((d) => d.values.join(", ")));
  const [gridView, setGridView] = useState<"table" | "heatmap">("heatmap");
  const [heatMetric, setHeatMetric] = useState<"test_pnl" | "test_wr" | "train_pnl" | "train_wr">("test_pnl");

  useEffect(() => { loadGridSweepables(); }, [loadGridSweepables]);

  const periodCols = gridSweepables?.period_columns ?? [];
  const maxCombos = gridSweepables?.max_combos ?? 500;
  const referencedPeriodCols = periodCols.filter((c) =>
    grid.entry_conditions.some((cnd) => cnd.left === c || cnd.right === c));
  const numericConds = grid.entry_conditions
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => isNumericRight(c.right));

  const comboCount = grid.sweep_dims.reduce((acc, d) => acc * d.values.length, 1);
  const overCap = comboCount > maxCombos;

  const parseVals = (s: string) => s.split(",").map((x) => parseFloat(x.trim())).filter((v) => !isNaN(v));

  const applyPreset = (label: string, conditions: ConditionRow[]) => {
    setActivePreset(label);
    // Reset sweep dims to a single threshold on the first numeric condition, if any.
    const firstNumeric = conditions.findIndex((c) => isNumericRight(c.right));
    const dims: SweepDimLocal[] = firstNumeric >= 0
      ? [{ kind: "threshold", condition_index: firstNumeric, column: "", values: [25, 30, 35, 40] }]
      : [{ kind: "indicator_period", condition_index: 0, column: "rsi_14", values: [10, 14, 21] }];
    setGrid({ entry_conditions: conditions, sweep_dims: dims });
    setRawVals(dims.map((d) => d.values.join(", ")));
  };

  const updateDim = (idx: number, patch: Partial<SweepDimLocal>) => {
    const dims = grid.sweep_dims.map((d, i) => i === idx ? { ...d, ...patch } : d);
    setGrid({ sweep_dims: dims });
  };
  const setDimRaw = (idx: number, str: string) => {
    setRawVals((rv) => rv.map((v, i) => i === idx ? str : v));
    updateDim(idx, { values: parseVals(str) });
  };
  const addDim = () => {
    const nd: SweepDimLocal = numericConds.length
      ? { kind: "threshold", condition_index: numericConds[0].i, column: "", values: [10, 20, 30] }
      : { kind: "indicator_period", condition_index: 0, column: referencedPeriodCols[0] ?? "rsi_14", values: [10, 14, 21] };
    setGrid({ sweep_dims: [...grid.sweep_dims, nd] });
    setRawVals([...rawVals, nd.values.join(", ")]);
  };
  const removeDim = (idx: number) => {
    setGrid({ sweep_dims: grid.sweep_dims.filter((_, i) => i !== idx) });
    setRawVals(rawVals.filter((_, i) => i !== idx));
  };
  // Switching a dimension's kind must seed a valid column / condition_index — otherwise
  // an indicator_period dim keeps an empty column (the <select> just *shows* the first
  // option) and the run fails with "Invalid period column ''".
  const changeDimKind = (idx: number, kind: SweepDimLocal["kind"]) => {
    if (kind === "indicator_period") {
      updateDim(idx, { kind, column: referencedPeriodCols[0] ?? "" });
    } else {
      updateDim(idx, { kind, condition_index: numericConds[0]?.i ?? 0 });
    }
  };

  const gapClass = (gap: number) =>
    gap > 20 ? "text-red-600 bg-red-50" : gap > 10 ? "text-amber-600 bg-amber-50" : "text-slate-500";

  const dimsValid = grid.sweep_dims.every((d) =>
    d.values.length > 0 && (
      d.kind === "threshold"
        ? numericConds.some((nc) => nc.i === d.condition_index)
        : d.column !== "" && referencedPeriodCols.includes(d.column)
    ));
  const canRun = pickedSymbols.length > 0 && comboCount > 0 && !overCap && dimsValid && !gridLoading;

  return (
    <section className="bg-white border border-slate-200 rounded-xl shadow-sm p-4 flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <div className="w-5 h-5 rounded-full bg-blue-500 text-white text-xs flex items-center justify-center font-bold shrink-0">2</div>
        <span className="text-sm font-semibold text-slate-700">Grid Search — hyperparameter sweep</span>
        <span className="text-xs text-slate-400 ml-1">tune indicator thresholds &amp; periods, validate on held-out data</span>
      </div>

      {/* Base strategy presets */}
      <div>
        <div className="text-xs text-slate-400 mb-2 font-medium">Base strategy — pick one, then sweep its parameters below</div>
        <div className="flex flex-wrap gap-1.5">
          {PRESETS.map((p) => (
            <button key={p.label} onClick={() => applyPreset(p.label, p.conditions)}
              className={`px-2.5 py-1 rounded-lg border text-xs font-medium transition-colors ${
                activePreset === p.label ? "bg-blue-500 text-white border-blue-500" : "border-slate-200 text-slate-600 hover:border-blue-300 hover:bg-blue-50"}`}>
              {p.label}
            </button>
          ))}
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {grid.entry_conditions.map((c, i) => (
            <span key={i} className="text-[11px] font-mono bg-slate-100 text-slate-600 px-2 py-0.5 rounded">
              {c.left} {c.operator} {c.right}
            </span>
          ))}
        </div>
      </div>

      {/* Sweep dimensions */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <div className="text-xs text-slate-400 font-medium">Sweep dimensions</div>
          <button onClick={addDim} disabled={grid.sweep_dims.length >= 4}
            className="text-xs text-blue-600 hover:text-blue-700 disabled:text-slate-300 font-medium">+ Add dimension</button>
        </div>
        <div className="flex flex-col gap-2">
          {grid.sweep_dims.map((d, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2 bg-slate-50 border border-slate-200 rounded-lg p-2">
              <select value={d.kind} onChange={(e) => changeDimKind(i, e.target.value as SweepDimLocal["kind"])}
                className="text-xs border border-slate-200 rounded px-2 py-1 bg-white">
                <option value="threshold">Threshold</option>
                <option value="indicator_period">Indicator period</option>
              </select>
              {d.kind === "threshold" ? (
                <select value={d.condition_index} onChange={(e) => updateDim(i, { condition_index: parseInt(e.target.value) })}
                  className="text-xs border border-slate-200 rounded px-2 py-1 bg-white">
                  {numericConds.length === 0 && <option>(no numeric conditions)</option>}
                  {numericConds.map(({ c, i: ci }) => (
                    <option key={ci} value={ci}>{c.left} {c.operator} ({c.right})</option>
                  ))}
                </select>
              ) : (
                <select value={d.column} onChange={(e) => updateDim(i, { column: e.target.value })}
                  className="text-xs border border-slate-200 rounded px-2 py-1 bg-white">
                  {referencedPeriodCols.length === 0 && <option value="">(condition uses no sweepable column)</option>}
                  {referencedPeriodCols.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              )}
              <input value={rawVals[i] ?? ""} onChange={(e) => setDimRaw(i, e.target.value)}
                placeholder="e.g. 10, 20, 30"
                className="flex-1 min-w-32 text-xs border border-slate-200 rounded px-2 py-1 bg-white font-mono" />
              <span className="text-[10px] text-slate-400">{d.values.length} val{d.values.length === 1 ? "" : "s"}</span>
              {grid.sweep_dims.length > 1 && (
                <button onClick={() => removeDim(i)} className="text-slate-300 hover:text-red-500 text-xs">✕</button>
              )}
            </div>
          ))}
        </div>
        <div className={`mt-2 text-xs font-medium ${overCap ? "text-red-600" : "text-slate-500"}`}>
          {comboCount} combination{comboCount === 1 ? "" : "s"}{overCap ? ` — exceeds limit of ${maxCombos}, reduce values` : ""}
        </div>
      </div>

      {/* Controls: split / top-N / TP / SL / bars */}
      <div className="flex flex-wrap gap-4 items-end">
        <label className="text-xs text-slate-500">
          <div className="mb-1">Train split: <span className="font-semibold text-slate-700">{Math.round(grid.train_ratio * 100)}%</span></div>
          <input type="range" min={0.5} max={0.9} step={0.05} value={grid.train_ratio}
            onChange={(e) => setGrid({ train_ratio: parseFloat(e.target.value) })} className="w-36" />
        </label>
        <label className="text-xs text-slate-500">
          <div className="mb-1">Validate top-N</div>
          <input type="number" min={1} max={50} value={grid.top_n}
            onChange={(e) => setGrid({ top_n: parseInt(e.target.value) || 20 })}
            className="w-20 text-xs border border-slate-200 rounded px-2 py-1" />
        </label>
        <label className="text-xs text-slate-500">
          <div className="mb-1">Target %</div>
          <input type="number" step={0.5} value={grid.target_pct}
            onChange={(e) => setGrid({ target_pct: parseFloat(e.target.value) })}
            className="w-20 text-xs border border-slate-200 rounded px-2 py-1" />
        </label>
        <label className="text-xs text-slate-500">
          <div className="mb-1">Stop-loss %</div>
          <input type="number" step={0.5} value={grid.sl_pct}
            onChange={(e) => setGrid({ sl_pct: parseFloat(e.target.value) })}
            className="w-20 text-xs border border-slate-200 rounded px-2 py-1" />
        </label>
        <label className="text-xs text-slate-500">
          <div className="mb-1">Max bars</div>
          <input type="number" min={1} max={252} value={grid.max_bars}
            onChange={(e) => setGrid({ max_bars: parseInt(e.target.value) || 30 })}
            className="w-20 text-xs border border-slate-200 rounded px-2 py-1" />
        </label>
        <button onClick={runGridSearch} disabled={!canRun}
          className="ml-auto px-4 py-2 rounded-lg bg-blue-500 text-white text-sm font-semibold hover:bg-blue-600 disabled:bg-slate-200 disabled:text-slate-400 transition-colors">
          {gridLoading ? "Running…" : `Run ${comboCount} combos`}
        </button>
      </div>

      {gridError && <div className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg p-2">{gridError}</div>}
      {gridProgress && (
        <div>
          <div className="text-[11px] text-slate-500 mb-1 capitalize">{gridProgress.phase} · {gridProgress.done}/{gridProgress.total}</div>
          <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
            <div className="h-full bg-blue-500 transition-all" style={{ width: `${gridProgress.total ? (gridProgress.done / gridProgress.total) * 100 : 0}%` }} />
          </div>
        </div>
      )}

      {/* Leaderboard */}
      {gridResults && (() => {
        const is2D = gridResults.dims.length === 2;
        const showHeat = is2D && gridView === "heatmap";
        const metricVal = (r: typeof gridResults.leaderboard[number]): number | null =>
          heatMetric === "test_pnl"  ? (r.test ? r.test.total_pnl : null) :
          heatMetric === "test_wr"   ? (r.test ? r.test.win_rate_pct : null) :
          heatMetric === "train_pnl" ? r.train.total_pnl : r.train.win_rate_pct;
        const isPnl = heatMetric.endsWith("pnl");
        const cellVals = gridResults.leaderboard.map(metricVal).filter((v): v is number => v !== null);
        const maxAbs = Math.max(1, ...cellVals.map((v) => Math.abs(v)));
        const wrMin = Math.min(...cellVals), wrMax = Math.max(...cellVals);
        const cellColor = (v: number | null): string => {
          if (v === null) return "transparent";
          if (isPnl) return v >= 0 ? `rgba(16,185,129,${0.1 + 0.6 * v / maxAbs})` : `rgba(239,68,68,${0.1 + 0.6 * Math.abs(v) / maxAbs})`;
          const t = wrMax > wrMin ? (v - wrMin) / (wrMax - wrMin) : 0.5;
          return `rgba(16,185,129,${0.08 + 0.6 * t})`;
        };
        const lookup = new Map(gridResults.leaderboard.map((r) => [`${r.dim_values[0]}|${r.dim_values[1]}`, r]));
        const [dimY, dimX] = gridResults.dims; // rows, cols

        return (
          <div className="overflow-x-auto">
            <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
              <div className="text-xs text-slate-500">
                {gridResults.total_combos} combos on {gridResults.symbols_used.length} symbols · split{" "}
                {Object.values(gridResults.split.boundary_dates)[0] ? `~${Object.values(gridResults.split.boundary_dates)[0]}` : ""}.
                {showHeat
                  ? " A stable green block = robust; an isolated green cell = likely overfit."
                  : <> Ranked by train PnL; large <span className="text-amber-600 font-medium">win-rate gap</span> = overfit.</>}
              </div>
              <div className="flex items-center gap-2">
                {showHeat && (
                  <select value={heatMetric} onChange={(e) => setHeatMetric(e.target.value as typeof heatMetric)}
                    className="text-xs border border-slate-200 rounded px-2 py-1 bg-white">
                    <option value="test_pnl">Test PnL</option>
                    <option value="test_wr">Test Win-rate</option>
                    <option value="train_pnl">Train PnL</option>
                    <option value="train_wr">Train Win-rate</option>
                  </select>
                )}
                {is2D && (
                  <div className="flex rounded-lg border border-slate-200 overflow-hidden">
                    {(["heatmap", "table"] as const).map((v) => (
                      <button key={v} onClick={() => setGridView(v)}
                        className={`px-2.5 py-1 text-xs font-medium capitalize ${gridView === v ? "bg-blue-500 text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}>{v}</button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {showHeat ? (
              <div className="inline-block">
                <table className="text-xs border-separate" style={{ borderSpacing: "3px" }}>
                  <thead>
                    <tr>
                      <th className="text-[10px] text-slate-400 font-medium text-right pr-2 align-bottom">{dimY.label} ↓ / {dimX.label} →</th>
                      {dimX.values.map((cv) => <th key={cv} className="text-[11px] font-mono text-slate-500 px-2 pb-1">{cv}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {dimY.values.map((rv) => (
                      <tr key={rv}>
                        <th className="text-[11px] font-mono text-slate-500 text-right pr-2">{rv}</th>
                        {dimX.values.map((cv) => {
                          const r = lookup.get(`${rv}|${cv}`);
                          const v = r ? metricVal(r) : null;
                          return (
                            <td key={cv} style={{ backgroundColor: cellColor(v) }}
                              title={r ? `${dimY.label}=${rv}, ${dimX.label}=${cv}\nTrain PnL ₹${fmt(r.train.total_pnl,0)} · WR ${r.train.win_rate_pct}%\nTest PnL ₹${r.test ? fmt(r.test.total_pnl,0) : "—"} · WR ${r.test ? r.test.win_rate_pct : "—"}%` : ""}
                              className="w-20 h-11 text-center rounded align-middle border border-slate-100">
                              <div className="text-[11px] font-semibold text-slate-700">{v === null ? "—" : isPnl ? `₹${fmt(v,0)}` : `${v}%`}</div>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-slate-400 border-b border-slate-200">
                    <th className="text-left py-1.5 pr-3">#</th>
                    <th className="text-left py-1.5 pr-3">Params</th>
                    <th className="text-right py-1.5 pr-3">Train PnL</th>
                    <th className="text-right py-1.5 pr-3">Train WR</th>
                    <th className="text-right py-1.5 pr-3">Train n</th>
                    <th className="text-right py-1.5 pr-3">Test PnL</th>
                    <th className="text-right py-1.5 pr-3">Test WR</th>
                    <th className="text-right py-1.5 pr-3">Test n</th>
                    <th className="text-right py-1.5 pr-3">WR gap</th>
                  </tr>
                </thead>
                <tbody>
                  {gridResults.leaderboard.slice(0, gridResults.top_n).map((r, idx) => (
                    <tr key={r.combo_id} className="border-b border-slate-50 hover:bg-slate-50/50">
                      <td className="py-1.5 pr-3 text-slate-400">{idx + 1}</td>
                      <td className="py-1.5 pr-3">
                        {Object.entries(r.params).map(([k, v]) => (
                          <span key={k} className="inline-block mr-1 font-mono bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded text-[10px]">{k}={v}</span>
                        ))}
                      </td>
                      <td className={`py-1.5 pr-3 text-right font-medium ${r.train.total_pnl >= 0 ? "text-emerald-600" : "text-red-500"}`}>₹{fmt(r.train.total_pnl, 0)}</td>
                      <td className="py-1.5 pr-3 text-right text-slate-500">{r.train.win_rate_pct}%</td>
                      <td className="py-1.5 pr-3 text-right text-slate-400">{r.train.total_trades}</td>
                      <td className={`py-1.5 pr-3 text-right font-medium ${r.test ? (r.test.total_pnl >= 0 ? "text-emerald-600" : "text-red-500") : "text-slate-300"}`}>{r.test ? `₹${fmt(r.test.total_pnl, 0)}` : "—"}</td>
                      <td className="py-1.5 pr-3 text-right text-slate-500">{r.test ? `${r.test.win_rate_pct}%` : "—"}</td>
                      <td className="py-1.5 pr-3 text-right text-slate-400">{r.test ? r.test.total_trades : "—"}</td>
                      <td className="py-1.5 pr-3 text-right">
                        {r.gap ? <span className={`px-1.5 py-0.5 rounded font-medium ${gapClass(Math.abs(r.gap.win_rate_gap))}`}>{r.gap.win_rate_gap > 0 ? "+" : ""}{r.gap.win_rate_gap}</span> : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {!showHeat && gridResults.leaderboard.length > gridResults.top_n && (
              <div className="text-[10px] text-slate-400 mt-1">Showing top {gridResults.top_n} of {gridResults.leaderboard.length} combos (ranked by train PnL).</div>
            )}
          </div>
        );
      })()}
    </section>
  );
}

type SweepDimLocal = SweepDim;

// ── ML Models panel ──────────────────────────────────────────────────────────

function MlPanel() {
  const { pickedSymbols, ml, mlResults, mlLoading, mlError, mlProgress, mlModelList,
          setMl, loadMlModels, runMl } = useBacktestStore();
  const [activePreset, setActivePreset] = useState<string | null>("RSI Midline Surge");
  const [activeModel, setActiveModel] = useState<string | null>(null);
  const [activeSym, setActiveSym] = useState<string | null>(null);

  useEffect(() => { loadMlModels(); }, [loadMlModels]);
  useEffect(() => {
    if (mlResults) {
      const ids = Object.keys(mlResults.models);
      setActiveModel((m) => m && ids.includes(m) ? m : ids[0] ?? null);
      const syms = Object.keys(mlResults.ohlcv);
      setActiveSym((s) => s && syms.includes(s) ? s : syms[0] ?? null);
    }
  }, [mlResults]);

  const toggleModel = (id: string) => {
    setMl({ models: ml.models.includes(id) ? ml.models.filter((m) => m !== id) : [...ml.models, id] });
  };
  const applyPreset = (label: string, conditions: ConditionRow[]) => {
    setActivePreset(label);
    setMl({ entry_conditions: conditions });
  };

  const canRun = pickedSymbols.length > 0 && ml.models.length > 0 && !mlLoading &&
    (ml.sample_mode === "all_bars" || ml.entry_conditions.length > 0);

  const rows = mlResults ? [
    { id: "__baseline__", label: "Baseline (no ML)", ml_metrics: null, stats: mlResults.baseline.stats, error: null },
    ...Object.entries(mlResults.models).map(([id, m]) => ({ id, label: m.label, ml_metrics: m.test_metrics, stats: m.stats, error: m.error })),
  ] : [];
  const bestPnl = mlResults ? Math.max(...rows.filter((r) => r.stats).map((r) => r.stats!.total_pnl)) : 0;

  const selModel = mlResults && activeModel ? mlResults.models[activeModel] : null;
  const symTrades = selModel && activeSym ? (selModel.per_symbol[activeSym]?.trades ?? []) : [];
  const symOhlcv = mlResults && activeSym ? (mlResults.ohlcv[activeSym] ?? []) : [];

  return (
    <section className="bg-white border border-slate-200 rounded-xl shadow-sm p-4 flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <div className="w-5 h-5 rounded-full bg-blue-500 text-white text-xs flex items-center justify-center font-bold shrink-0">2</div>
        <span className="text-sm font-semibold text-slate-700">ML Models — learned entry filter</span>
        <span className="text-xs text-slate-400 ml-1">classify each setup: does it hit target before stop? (triple-barrier)</span>
      </div>

      {/* Sample mode + base setup */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <span className="text-xs text-slate-400 font-medium">Sample bars from:</span>
          {(["entry_signals", "all_bars"] as const).map((sm) => (
            <button key={sm} onClick={() => setMl({ sample_mode: sm })}
              className={`px-2.5 py-1 rounded-lg border text-xs font-medium transition-colors ${
                ml.sample_mode === sm ? "bg-blue-500 text-white border-blue-500" : "border-slate-200 text-slate-600 hover:border-blue-300"}`}>
              {sm === "entry_signals" ? "Base setup signals (meta-labeling)" : "Every bar"}
            </button>
          ))}
        </div>
        {ml.sample_mode === "entry_signals" && (
          <>
            <div className="flex flex-wrap gap-1.5">
              {PRESETS.map((p) => (
                <button key={p.label} onClick={() => applyPreset(p.label, p.conditions)}
                  className={`px-2.5 py-1 rounded-lg border text-xs font-medium transition-colors ${
                    activePreset === p.label ? "bg-blue-500 text-white border-blue-500" : "border-slate-200 text-slate-600 hover:border-blue-300 hover:bg-blue-50"}`}>
                  {p.label}
                </button>
              ))}
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {ml.entry_conditions.map((c, i) => (
                <span key={i} className="text-[11px] font-mono bg-slate-100 text-slate-600 px-2 py-0.5 rounded">{c.left} {c.operator} {c.right}</span>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Models */}
      <div>
        <div className="text-xs text-slate-400 mb-2 font-medium">Models</div>
        <div className="flex flex-wrap gap-2">
          {mlModelList.map((m) => (
            <label key={m.id}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs font-medium cursor-pointer transition-colors ${
                !m.available ? "opacity-40 cursor-not-allowed border-slate-200" :
                ml.models.includes(m.id) ? "bg-blue-50 border-blue-300 text-blue-700" : "border-slate-200 text-slate-600 hover:border-blue-300"}`}>
              <input type="checkbox" disabled={!m.available} checked={ml.models.includes(m.id)}
                onChange={() => toggleModel(m.id)} className="accent-blue-500" />
              {m.label}{!m.available && <span className="text-[10px] text-slate-400">(not installed)</span>}
            </label>
          ))}
        </div>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap gap-4 items-end">
        <label className="text-xs text-slate-500">
          <div className="mb-1">P(win) threshold: <span className="font-semibold text-slate-700">{ml.prob_threshold.toFixed(2)}</span></div>
          <input type="range" min={0.5} max={0.95} step={0.05} value={ml.prob_threshold}
            onChange={(e) => setMl({ prob_threshold: parseFloat(e.target.value) })} className="w-36" />
        </label>
        <label className="text-xs text-slate-500">
          <div className="mb-1">Train split: <span className="font-semibold text-slate-700">{Math.round(ml.train_ratio * 100)}%</span></div>
          <input type="range" min={0.5} max={0.9} step={0.05} value={ml.train_ratio}
            onChange={(e) => setMl({ train_ratio: parseFloat(e.target.value) })} className="w-36" />
        </label>
        <label className="text-xs text-slate-500">
          <div className="mb-1">Target %</div>
          <input type="number" step={0.5} value={ml.target_pct}
            onChange={(e) => setMl({ target_pct: parseFloat(e.target.value) })}
            className="w-20 text-xs border border-slate-200 rounded px-2 py-1" />
        </label>
        <label className="text-xs text-slate-500">
          <div className="mb-1">Stop-loss %</div>
          <input type="number" step={0.5} value={ml.sl_pct}
            onChange={(e) => setMl({ sl_pct: parseFloat(e.target.value) })}
            className="w-20 text-xs border border-slate-200 rounded px-2 py-1" />
        </label>
        <label className="text-xs text-slate-500">
          <div className="mb-1">Max bars</div>
          <input type="number" min={1} max={252} value={ml.max_bars}
            onChange={(e) => setMl({ max_bars: parseInt(e.target.value) || 25 })}
            className="w-20 text-xs border border-slate-200 rounded px-2 py-1" />
        </label>
        <button onClick={runMl} disabled={!canRun}
          className="ml-auto px-4 py-2 rounded-lg bg-blue-500 text-white text-sm font-semibold hover:bg-blue-600 disabled:bg-slate-200 disabled:text-slate-400 transition-colors">
          {mlLoading ? "Training…" : "Train & evaluate"}
        </button>
      </div>

      {mlError && <div className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg p-2">{mlError}</div>}
      {mlProgress && (
        <div className="text-[11px] text-slate-500">
          {mlProgress.phase === "dataset" ? `Building dataset… ${mlProgress.done}/${mlProgress.total}` :
           `Training ${mlResults?.models?.[mlProgress.model ?? ""]?.label ?? mlProgress.model ?? "model"}… ${mlProgress.done}/${mlProgress.total}`}
        </div>
      )}

      {/* Results */}
      {mlResults && (
        <>
          <div className="text-[11px] text-slate-500 flex flex-wrap gap-x-4 gap-y-1 bg-slate-50 rounded-lg p-2">
            <span>Train samples: <b className="text-slate-700">{mlResults.dataset.n_train}</b></span>
            <span>Test samples: <b className="text-slate-700">{mlResults.dataset.n_test}</b></span>
            <span>Features: <b className="text-slate-700">{mlResults.dataset.n_features}</b></span>
            <span>Win-rate (train): <b className="text-slate-700">{Math.round(mlResults.dataset.pos_rate_train * 100)}%</b></span>
            <span>Win-rate (test): <b className="text-slate-700">{Math.round(mlResults.dataset.pos_rate_test * 100)}%</b></span>
          </div>
          {(mlResults.dataset.train_period || mlResults.dataset.test_period) && (
            <div className="text-[11px] flex flex-wrap gap-x-4 gap-y-1 -mt-2">
              {mlResults.dataset.train_period && (
                <span className="inline-flex items-center gap-1.5 bg-blue-50 text-blue-700 rounded-md px-2 py-1">
                  <span className="font-semibold">Train window</span>
                  <span className="font-mono">{mlResults.dataset.train_period.start} → {mlResults.dataset.train_period.end}</span>
                </span>
              )}
              {mlResults.dataset.test_period && (
                <span className="inline-flex items-center gap-1.5 bg-emerald-50 text-emerald-700 rounded-md px-2 py-1">
                  <span className="font-semibold">Test window</span>
                  <span className="font-mono">{mlResults.dataset.test_period.start} → {mlResults.dataset.test_period.end}</span>
                </span>
              )}
              <span className="text-slate-400 self-center">chronological 70/30-style split · windows span all selected stocks</span>
            </div>
          )}

          {/* Comparison table */}
          <div className="overflow-x-auto">
            <div className="text-[11px] text-slate-400 mb-1">Classification metrics below are on the <b className="text-slate-500">held-out test set</b>. See per-model train-vs-test breakdown lower down.</div>
            <table className="w-full text-xs">
              <thead>
                <tr className="text-slate-400 border-b border-slate-200">
                  <th className="text-left py-1.5 pr-3">Model</th>
                  <th className="text-right py-1.5 pr-3">Accuracy</th>
                  <th className="text-right py-1.5 pr-3">Precision</th>
                  <th className="text-right py-1.5 pr-3">Recall</th>
                  <th className="text-right py-1.5 pr-3">AUC</th>
                  <th className="text-right py-1.5 pr-3 border-l border-slate-100">Trades</th>
                  <th className="text-right py-1.5 pr-3">Win rate</th>
                  <th className="text-right py-1.5 pr-3">PnL</th>
                  <th className="text-right py-1.5 pr-3">Avg %</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className={`border-b border-slate-50 ${r.id === "__baseline__" ? "bg-slate-50/60 font-medium" : ""} ${r.stats && r.stats.total_pnl === bestPnl && r.id !== "__baseline__" ? "bg-emerald-50/60" : ""}`}>
                    <td className="py-1.5 pr-3 text-slate-700">{r.label}{r.error && <span className="text-[10px] text-red-500 ml-1">{r.error}</span>}</td>
                    <td className="py-1.5 pr-3 text-right text-slate-500">{r.ml_metrics ? r.ml_metrics.accuracy.toFixed(2) : "—"}</td>
                    <td className="py-1.5 pr-3 text-right text-slate-500">{r.ml_metrics ? r.ml_metrics.precision.toFixed(2) : "—"}</td>
                    <td className="py-1.5 pr-3 text-right text-slate-500">{r.ml_metrics ? r.ml_metrics.recall.toFixed(2) : "—"}</td>
                    <td className="py-1.5 pr-3 text-right text-slate-500">{r.ml_metrics ? (r.ml_metrics.roc_auc === null ? "—" : r.ml_metrics.roc_auc.toFixed(2)) : "—"}</td>
                    <td className="py-1.5 pr-3 text-right text-slate-400 border-l border-slate-100">{r.stats ? r.stats.total_trades : "—"}</td>
                    <td className="py-1.5 pr-3 text-right text-slate-500">{r.stats ? `${r.stats.win_rate_pct}%` : "—"}</td>
                    <td className={`py-1.5 pr-3 text-right font-medium ${r.stats ? (r.stats.total_pnl >= 0 ? "text-emerald-600" : "text-red-500") : "text-slate-300"}`}>{r.stats ? `₹${fmt(r.stats.total_pnl, 0)}` : "—"}</td>
                    <td className="py-1.5 pr-3 text-right text-slate-500">{r.stats ? `${r.stats.avg_pnl_pct}%` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Per-model detail: feature importance + chart */}
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(mlResults.models).map(([id, m]) => (
              <button key={id} onClick={() => setActiveModel(id)}
                className={`px-2.5 py-1 rounded-lg border text-xs font-medium transition-colors ${
                  activeModel === id ? "bg-slate-700 text-white border-slate-700" : "border-slate-200 text-slate-600 hover:border-slate-400"}`}>
                {m.label}
              </button>
            ))}
          </div>

          {selModel && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div>
                <div className="text-xs text-slate-400 mb-2 font-medium">Feature importance — {selModel.label}</div>
                {selModel.feature_importance ? (
                  <div className="flex flex-col gap-1">
                    {selModel.feature_importance.slice(0, 10).map((f) => (
                      <div key={f.feature} className="flex items-center gap-2">
                        <span className="text-[10px] font-mono text-slate-500 w-28 shrink-0 text-right">{f.feature}</span>
                        <div className="flex-1 h-3 bg-slate-100 rounded overflow-hidden">
                          <div className="h-full bg-blue-400" style={{ width: `${Math.min(100, f.importance * 100 / (selModel.feature_importance![0]?.importance || 1))}%` }} />
                        </div>
                        <span className="text-[10px] text-slate-400 w-10">{(f.importance * 100).toFixed(0)}%</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-xs text-slate-400 italic">Not available for this model (e.g. RBF SVM).</div>
                )}
              </div>
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs text-slate-400 font-medium">Test-period trades</span>
                  <select value={activeSym ?? ""} onChange={(e) => setActiveSym(e.target.value)}
                    className="text-xs border border-slate-200 rounded px-2 py-0.5 bg-white">
                    {Object.keys(mlResults.ohlcv).map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                  <span className="text-[10px] text-slate-400">{symTrades.length} trade{symTrades.length === 1 ? "" : "s"}</span>
                </div>
                {symOhlcv.length > 0 && activeSym && (
                  <BacktestChart symbol={activeSym} ohlcv={symOhlcv} trades={symTrades} boxZones={tradeBoxZones(symTrades)} />
                )}
              </div>
            </div>
          )}

          {/* Train vs Test metrics + confusion matrices for the selected model */}
          {selModel && selModel.train_metrics && selModel.test_metrics && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div>
                <div className="text-xs text-slate-400 mb-2 font-medium">Train vs Test — {selModel.label}</div>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-slate-400 border-b border-slate-200">
                      <th className="text-left py-1.5 pr-3">Metric</th>
                      <th className="text-right py-1.5 pr-3">Train</th>
                      <th className="text-right py-1.5 pr-3">Test</th>
                      <th className="text-right py-1.5 pr-3">Gap</th>
                    </tr>
                  </thead>
                  <tbody>
                    {([
                      ["Accuracy",  "accuracy"],
                      ["Precision", "precision"],
                      ["Recall",    "recall"],
                      ["F1",        "f1"],
                      ["AUC",       "roc_auc"],
                    ] as const).map(([lbl, key]) => {
                      const tr = selModel.train_metrics![key];
                      const te = selModel.test_metrics![key];
                      const gap = (tr !== null && te !== null) ? tr - te : null;
                      const gapCls = gap === null ? "text-slate-300"
                        : gap > 0.2 ? "text-red-600 bg-red-50" : gap > 0.1 ? "text-amber-600 bg-amber-50" : "text-slate-500";
                      return (
                        <tr key={key} className="border-b border-slate-50">
                          <td className="py-1.5 pr-3 text-slate-600">{lbl}</td>
                          <td className="py-1.5 pr-3 text-right text-slate-500">{tr === null ? "—" : tr.toFixed(2)}</td>
                          <td className="py-1.5 pr-3 text-right font-medium text-slate-700">{te === null ? "—" : te.toFixed(2)}</td>
                          <td className="py-1.5 pr-3 text-right"><span className={`px-1.5 py-0.5 rounded ${gapCls}`}>{gap === null ? "—" : (gap > 0 ? "+" : "") + gap.toFixed(2)}</span></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <div className="text-[10px] text-slate-400 mt-1">A large train→test gap (amber/red) = the model overfit the training period.</div>
              </div>

              {selModel.confusion && (
                <div>
                  <div className="text-xs text-slate-400 mb-2 font-medium">Confusion matrices — actual (rows) × predicted (cols)</div>
                  <div className="flex flex-wrap gap-4">
                    {([["Train", selModel.confusion.train], ["Test", selModel.confusion.test]] as const).map(([lbl, cm]) => (
                      <div key={lbl}>
                        <div className="text-[11px] font-semibold text-slate-500 mb-1">{lbl}</div>
                        <div className="grid grid-cols-[auto_auto_auto] gap-px text-[11px]">
                          <div className="w-14" />
                          <div className="w-16 text-center text-slate-400 pb-1">Pred Loss</div>
                          <div className="w-16 text-center text-slate-400 pb-1">Pred Win</div>
                          <div className="w-14 text-right text-slate-400 pr-1 self-center">Act Loss</div>
                          <div className="h-10 flex items-center justify-center rounded bg-emerald-50 text-emerald-700 font-semibold" title="True Negative">{cm.tn}</div>
                          <div className="h-10 flex items-center justify-center rounded bg-red-50 text-red-600 font-semibold" title="False Positive">{cm.fp}</div>
                          <div className="w-14 text-right text-slate-400 pr-1 self-center">Act Win</div>
                          <div className="h-10 flex items-center justify-center rounded bg-red-50 text-red-600 font-semibold" title="False Negative">{cm.fn}</div>
                          <div className="h-10 flex items-center justify-center rounded bg-emerald-50 text-emerald-700 font-semibold" title="True Positive">{cm.tp}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="text-[10px] text-slate-400 mt-1">Green = correct (TN/TP), red = errors (FP = false buy signal, FN = missed winner).</div>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}

// ── Quant Signals panel ──────────────────────────────────────────────────────

const QUANT_TIER_COLORS: Record<string, string> = {
  "STRONG BUY": "bg-emerald-600 text-white", "BUY": "bg-emerald-400 text-white",
  "STRONG SHORT": "bg-red-600 text-white", "SHORT": "bg-red-400 text-white",
  "WATCH": "bg-amber-400 text-white", "WEAK": "bg-slate-300 text-slate-600",
};

function QuantSignalPanel() {
  const { pickedSymbols, quant, quantResults, quantLoading, quantError, quantProgress, quantAlgoMeta,
          setQuant, loadQuantAlgoMeta, runQuantSignals, strategy, setStrategy } = useBacktestStore();
  const [activeSym, setActiveSym] = useState<string | null>(null);

  useEffect(() => { loadQuantAlgoMeta(); }, [loadQuantAlgoMeta]);
  useEffect(() => {
    if (quantResults) {
      const syms = Object.keys(quantResults.symbols).filter((s) => (quantResults.symbols[s].trades.length ?? 0) > 0);
      const fallback = Object.keys(quantResults.symbols);
      setActiveSym((s) => s && quantResults.symbols[s] ? s : (syms[0] ?? fallback[0] ?? null));
    }
  }, [quantResults]);

  const meta = quantAlgoMeta.find((a) => a.id === quant.algo) ?? null;
  const canRun = pickedSymbols.length > 0 && !quantLoading;
  const symResult = activeSym && quantResults ? quantResults.symbols[activeSym] : null;
  const allQuantTrades = quantResults ? Object.values(quantResults.symbols).flatMap((r) => r.trades) : [];
  const quantAggStats = tradeStats(allQuantTrades as unknown as BacktestTradeV2[]);

  return (
    <section className="bg-white border border-slate-200 rounded-xl shadow-sm p-4 flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <div className="w-5 h-5 rounded-full bg-blue-500 text-white text-xs flex items-center justify-center font-bold shrink-0">2</div>
        <span className="text-sm font-semibold text-slate-700">Quant Signals — weighted-score algorithms</span>
        <span className="text-xs text-slate-400 ml-1">hard gates + factor score + ATR stops + risk-% sizing</span>
      </div>

      {/* Algo selector */}
      <div className="flex flex-wrap gap-1.5">
        {quantAlgoMeta.map((a) => (
          <button key={a.id} onClick={() => setQuant({ algo: a.id })}
            className={`px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
              quant.algo === a.id ? "bg-blue-500 text-white border-blue-500" : "border-slate-200 text-slate-600 hover:border-blue-300 hover:bg-blue-50"}`}>
            {a.label}
            <span className={`ml-1.5 text-[10px] ${quant.algo === a.id ? "text-blue-100" : "text-slate-400"}`}>
              {a.universe === "fno_only" ? "F&O only" : "any"}
            </span>
          </button>
        ))}
      </div>

      {/* Read-only algo description */}
      {meta && (
        <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-xs text-slate-600 flex flex-col gap-2">
          <div>{meta.description}</div>
          <div>
            <span className="font-semibold text-slate-500">Gates: </span>
            {meta.gates.join(" · ")}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(meta.weights).map(([k, v]) => (
              <span key={k} className="font-mono bg-white border border-slate-200 text-slate-500 px-1.5 py-0.5 rounded text-[10px]">
                {k} {Math.round(v * 100)}%
              </span>
            ))}
          </div>
          <div><span className="font-semibold text-slate-500">Entry: </span>{meta.entry}</div>
          <div><span className="font-semibold text-slate-500">Trade: </span>{meta.trade}</div>
        </div>
      )}

      {/* Controls */}
      <div className="flex flex-wrap gap-4 items-end">
        <label className="text-xs text-slate-500">
          <div className="mb-1">From date</div>
          <input type="date" value={strategy.from_date} onChange={(e) => setStrategy({ from_date: e.target.value })}
            className="text-xs border border-slate-200 rounded px-2 py-1" />
        </label>
        <label className="text-xs text-slate-500">
          <div className="mb-1">To date</div>
          <input type="date" value={strategy.to_date} onChange={(e) => setStrategy({ to_date: e.target.value })}
            className="text-xs border border-slate-200 rounded px-2 py-1" />
        </label>
        <label className="text-xs text-slate-500">
          <div className="mb-1">Account capital (₹)</div>
          <input type="number" step={10000} value={quant.account_capital}
            onChange={(e) => setQuant({ account_capital: parseFloat(e.target.value) || 1_000_000 })}
            className="w-32 text-xs border border-slate-200 rounded px-2 py-1" />
        </label>
        <button onClick={runQuantSignals} disabled={!canRun}
          className="ml-auto px-4 py-2 rounded-lg bg-blue-500 text-white text-sm font-semibold hover:bg-blue-600 disabled:bg-slate-200 disabled:text-slate-400 transition-colors">
          {quantLoading ? "Running…" : `Run ${meta?.label ?? ""}`}
        </button>
      </div>

      {quantError && <div className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg p-2">{quantError}</div>}
      {quantProgress && (
        <div>
          <div className="text-[11px] text-slate-500 mb-1">{quantProgress.symbol ?? "…"} · {quantProgress.done}/{quantProgress.total}</div>
          <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
            <div className="h-full bg-blue-500 transition-all" style={{ width: `${quantProgress.total ? (quantProgress.done / quantProgress.total) * 100 : 0}%` }} />
          </div>
        </div>
      )}

      {/* Results */}
      {quantResults && (
        <>
          {quantResults.excluded_symbols.length > 0 && (
            <div className="text-[11px] text-amber-600 bg-amber-50 border border-amber-100 rounded-lg p-2">
              Excluded: {quantResults.excluded_symbols.map((e) => `${e.symbol} (${e.reason})`).join(", ")}
            </div>
          )}

          <div className="flex" style={{ height: 640 }}>

            {/* Left panel: summary + stock list (mirrors Multi-Stock mode) */}
            <div className="w-52 shrink-0 border-r border-slate-100 flex flex-col">
              <div className="p-3 border-b border-slate-100 bg-slate-50/60">
                <div className="text-[10px] text-slate-400 font-semibold uppercase tracking-wide mb-1">Quant Results</div>
                <div className={`text-base font-bold ${pnlClass(quantResults.pooled_stats.total_pnl)}`}>
                  {quantResults.pooled_stats.total_pnl >= 0 ? "+" : ""}₹{fmt(quantResults.pooled_stats.total_pnl)}
                </div>
                <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 mt-1.5 text-[10px]">
                  <span className="text-slate-400">{quantResults.pooled_stats.total_trades} entries</span>
                  <span className={quantResults.pooled_stats.win_rate_pct >= 50 ? "text-emerald-500" : "text-red-400"}>
                    {quantResults.pooled_stats.win_rate_pct}% win rate
                  </span>
                  <span className={quantAggStats.profitFactor >= 1.5 ? "text-emerald-500" : quantAggStats.profitFactor >= 1 ? "text-amber-500" : "text-red-400"}>
                    PF {isFinite(quantAggStats.profitFactor) ? quantAggStats.profitFactor.toFixed(2) : "∞"}×
                  </span>
                  <span className={quantAggStats.expectancy >= 0 ? "text-emerald-500" : "text-red-400"}>
                    {quantAggStats.expectancy >= 0 ? "+" : ""}{quantAggStats.expectancy.toFixed(1)}% exp
                  </span>
                </div>
                {/* Target / Stop / Time outcome bars */}
                {allQuantTrades.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {[
                      { label: "🎯 Target", count: quantAggStats.targetHits, color: "bg-emerald-400" },
                      { label: "🛑 Stop", count: quantAggStats.slHits, color: "bg-red-400" },
                      { label: "⏱ Time", count: quantAggStats.timeStops, color: "bg-slate-300" },
                    ].map(({ label, count, color }) => {
                      const pct = (count / allQuantTrades.length) * 100;
                      return (
                        <div key={label}>
                          <div className="flex justify-between text-[9px] text-slate-400 mb-0.5">
                            <span>{label}</span>
                            <span>{pct.toFixed(0)}% ({count})</span>
                          </div>
                          <div className="h-1 bg-slate-100 rounded-full overflow-hidden">
                            <div className={`h-full ${color} rounded-full`} style={{ width: `${pct}%` }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
                {quantResults.excluded_symbols.length > 0 && (
                  <div className="mt-2 text-[9px] text-amber-600">
                    Excluded: {quantResults.excluded_symbols.map((e) => e.symbol).join(", ")}
                  </div>
                )}
              </div>

              <div className="overflow-y-auto flex-1">
                {Object.entries(quantResults.symbols).map(([sym, r]) => {
                  const isActive = sym === activeSym;
                  return (
                    <button key={sym} onClick={() => setActiveSym(sym)}
                      className={`w-full text-left px-3 py-2.5 border-b border-slate-50 transition-colors ${
                        isActive ? "bg-blue-50 border-l-2 border-l-blue-500" : "hover:bg-slate-50"
                      }`}>
                      <div className="flex items-center justify-between gap-1">
                        <span className={`text-xs font-semibold ${isActive ? "text-blue-700" : "text-slate-700"}`}>{sym}</span>
                        {!r.error && (
                          <span className={`text-[10px] font-semibold ${pnlClass(r.stats.total_pnl)}`}>
                            {r.stats.total_pnl >= 0 ? "+" : ""}₹{fmt(r.stats.total_pnl)}
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] text-slate-400 mt-0.5">
                        {r.error ? <span className="text-amber-500">no data</span>
                          : `${r.trades.length} trade${r.trades.length === 1 ? "" : "s"}${r.armed_not_triggered.length ? ` · ${r.armed_not_triggered.length} watched` : ""}`}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Right panel: chart + trade log for the selected symbol */}
            <div className="flex-1 overflow-y-auto pl-4 flex flex-col gap-3">
              {symResult?.error && <div className="text-xs text-amber-600 bg-amber-50 border border-amber-100 rounded-lg p-2">{symResult.error}</div>}

              {symResult && !symResult.error && (
                <>
                  {symResult.ohlcv.length > 0 && activeSym && (
                    <BacktestChart symbol={activeSym} ohlcv={symResult.ohlcv}
                      trades={symResult.trades as unknown as BacktestTradeV2[]}
                      boxZones={tradeBoxZones(symResult.trades as unknown as BacktestTradeV2[])} />
                  )}

                  {/* Trade log with score/tier or arm→trigger timeline */}
                  {symResult.trades.length > 0 && (
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-slate-400 border-b border-slate-200">
                            <th className="text-left py-1.5 pr-3">Entry</th>
                            <th className="text-left py-1.5 pr-3">Exit</th>
                            <th className="text-right py-1.5 pr-3">Entry ₹</th>
                            <th className="text-right py-1.5 pr-3">Stop</th>
                            <th className="text-right py-1.5 pr-3">Target</th>
                            <th className="text-right py-1.5 pr-3">Exit ₹</th>
                            <th className="text-left py-1.5 pr-3">Reason</th>
                            <th className="text-right py-1.5 pr-3">PnL</th>
                            <th className="text-right py-1.5 pr-3">PnL %</th>
                            <th className="text-left py-1.5 pr-3">Signal</th>
                          </tr>
                        </thead>
                        <tbody>
                          {symResult.trades.map((t, i) => (
                            <tr key={i} className="border-b border-slate-50">
                              <td className="py-1.5 pr-3 text-slate-500">{t.entry_date.slice(0, 10)}</td>
                              <td className="py-1.5 pr-3 text-slate-500">{t.exit_date.slice(0, 10)}</td>
                              <td className="py-1.5 pr-3 text-right">{t.entry_price}</td>
                              <td className="py-1.5 pr-3 text-right text-red-400">{t.stop_price}</td>
                              <td className="py-1.5 pr-3 text-right text-emerald-500">{t.target_price}</td>
                              <td className="py-1.5 pr-3 text-right">{t.exit_price}</td>
                              <td className="py-1.5 pr-3 text-slate-400">{t.exit_reason}</td>
                              <td className={`py-1.5 pr-3 text-right font-medium ${t.pnl >= 0 ? "text-emerald-600" : "text-red-500"}`}>₹{fmt(t.pnl, 0)}</td>
                              <td className="py-1.5 pr-3 text-right text-slate-500">{t.pnl_pct.toFixed(2)}%</td>
                              <td className="py-1.5 pr-3">
                                {t.tier ? (
                                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${QUANT_TIER_COLORS[t.tier] ?? "bg-slate-200"}`}>
                                    {t.tier} ({t.score?.toFixed(2)})
                                  </span>
                                ) : t.arm_date ? (
                                  <span className="text-[10px] text-slate-500">
                                    Armed {t.arm_date.slice(0, 10)} (score {t.arm_score?.toFixed(2)}) → Triggered {t.trigger_date?.slice(0, 10)}
                                  </span>
                                ) : null}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {/* Armed but never triggered (accumulation/distribution only) */}
                  {symResult.armed_not_triggered.length > 0 && (
                    <div className="text-[11px] text-slate-400 bg-slate-50 rounded-lg p-2 flex flex-col gap-1">
                      <div className="font-semibold text-slate-500">Watched but never triggered (not counted in stats):</div>
                      {symResult.armed_not_triggered.map((a, i) => (
                        <div key={i}>Armed {a.arm_date.slice(0, 10)} (score {a.arm_score.toFixed(2)}), expired {a.expired_date.slice(0, 10)} — no breakout within 20 trading days.</div>
                      ))}
                    </div>
                  )}

                  {symResult.trades.length === 0 && symResult.armed_not_triggered.length === 0 && (
                    <div className="text-xs text-slate-400 italic py-3 text-center border border-dashed border-slate-200 rounded-lg">
                      No qualifying setups for {activeSym} in this date range.
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </>
      )}
    </section>
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
    // multi-algo
    mode, algoSlots, multiAlgoSymbol, activeAlgoId,
    setMode, addAlgoSlot, addCustomAlgoSlot, removeAlgoSlot, updateAlgoSlot,
    setActiveAlgo, setMultiAlgoSymbol, runAllAlgos,
    // matrix
    matrixAlgos, matrixResults, matrixLoading, matrixError, matrixProgress,
    addMatrixAlgo, removeMatrixAlgo, updateMatrixAlgo, runMatrix,
    // options straddle/strangle
    straddle, straddleResults, straddleLoading, straddleError,
    setStraddle, runStraddle,
    // options spreads
    optionsFamily, setOptionsFamily,
    spread, spreadResults, spreadLoading, spreadError,
    setSpread, runSpread,
    // ORB
    orb, orbResults, orbLoading, orbError, setOrb, runOrb,
  } = store;

  const [algoSymbolSearch, setAlgoSymbolSearch] = useState("");
  const [algoSymbolSuggestions, setAlgoSymbolSuggestions] = useState<{symbol:string;name:string}[]>([]);
  const [expandedAlgoId, setExpandedAlgoId] = useState<string | null>(null);
  const prevAlgoCountRef = useRef(algoSlots.length);
  useEffect(() => {
    if (algoSlots.length > prevAlgoCountRef.current) {
      const newest = algoSlots[algoSlots.length - 1];
      if (newest.strategy.entry_conditions.length === 0) setExpandedAlgoId(newest.id);
    }
    prevAlgoCountRef.current = algoSlots.length;
  }, [algoSlots.length]);

  const [showExitConditions, setShowExitConditions] = useState(false);
  const [activePreset, setActivePreset] = useState<string | null>("MACD Cross");
  const [compareMode, setCompareMode] = useState(false);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [loadingPct, setLoadingPct] = useState(0);
  const loadingTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const [showCustomSave, setShowCustomSave] = useState(false);
  const [customSaveLabel, setCustomSaveLabel] = useState("");
  const [matrixView, setMatrixView] = useState<"heatmap" | "table" | "compare">("heatmap");
  const [matrixMetric, setMatrixMetric] = useState<"win_rate" | "pnl" | "trades">("win_rate");
  const [selectedCell, setSelectedCell] = useState<{ symbol: string; algoId: string } | null>(null);
  const [matrixExpandedAlgoId, setMatrixExpandedAlgoId] = useState<string | null>(matrixAlgos[0]?.id ?? null);
  const [patternCache, setPatternCache] = useState<Record<string, PatternHit[]>>({});
  const [outlookCache, setOutlookCache] = useState<Record<string, Record<string, unknown> | null>>({});
  const [outlookLoading, setOutlookLoading] = useState<Record<string, boolean>>({});
  const prevLoadingRef = useRef(false);

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

  // Auto-save when run completes
  useEffect(() => {
    const wasLoading = prevLoadingRef.current;
    prevLoadingRef.current = v2Loading;
    if (wasLoading && !v2Loading && v2Results) {
      if (activePreset && activePreset !== "Custom") {
        // Preset run — auto-save with preset name, open compare
        saveCurrentRun(activePreset);
        setCompareMode(true);
        setActiveRunId(null);
      } else {
        // Custom run — prompt user to name it
        setShowCustomSave(true);
        setCustomSaveLabel("");
      }
    }
  }, [v2Loading]);

  const canRun = pickedSymbols.length > 0 && strategy.entry_conditions.length > 0 && !v2Loading;

  // Risk:Reward computed vars
  const rr      = strategy.sl_pct > 0 ? strategy.target_pct / strategy.sl_pct : 0;
  const rrColor = rr >= 2 ? "text-emerald-600" : rr >= 1.5 ? "text-amber-500" : "text-red-500";
  const minWin  = rr > 0 ? Math.ceil((1 / (1 + rr)) * 100) : 0;
  const randomPTarget = strategy.sl_pct > 0
    ? (strategy.sl_pct / (strategy.target_pct + strategy.sl_pct)) * 100
    : 0;

  // In compare mode, show saved run data; otherwise show current run
  const displayResults: typeof v2Results = compareMode && activeRunId
    ? savedRuns.find((r) => r.id === activeRunId)?.results ?? v2Results
    : v2Results;
  const symbolsWithResults = displayResults ? Object.keys(displayResults.per_symbol) : [];
  const activeData = activeSymbol && displayResults?.per_symbol[activeSymbol];

  // Aggregate trader stats across all symbols in displayed results
  const allTrades = displayResults
    ? Object.values(displayResults.per_symbol).flatMap((s) => s.trades)
    : [];
  const aggStats = tradeStats(allTrades);
  const edge = allTrades.length
    ? (aggStats.targetHits / allTrades.length) * 100 - randomPTarget
    : 0;

  // Fetch TA-Lib patterns + outlook when active symbol changes
  useEffect(() => {
    const sym = mode === "multi_algo" ? multiAlgoSymbol : activeSymbol;
    if (!sym || patternCache[sym] !== undefined) return;
    api.getCandlePatterns(sym).then((hits) => setPatternCache((c) => ({ ...c, [sym]: hits }))).catch(() => {});
    setOutlookLoading((o) => ({ ...o, [sym]: true }));
    api.getOutlook(sym)
      .then((out) => setOutlookCache((c) => ({ ...c, [sym]: out as Record<string, unknown> })))
      .catch(() => {})
      .finally(() => setOutlookLoading((o) => ({ ...o, [sym]: false })));
  }, [activeSymbol, multiAlgoSymbol, mode]);

  const _activePatternSym = mode === "multi_algo" ? multiAlgoSymbol : (activeSymbol ?? "");
  const _last10Dates = new Set(
    (activeData && typeof activeData === "object" && "ohlcv" in activeData ? activeData.ohlcv : [])
      .slice(-10).map((r: { date: string }) => r.date.slice(0, 10))
  );
  const activePatternHits = (patternCache[_activePatternSym] ?? [])
    .filter(h => _last10Dates.has(h.date));
  const activeOutlook = outlookCache[_activePatternSym] ?? null;
  const activeOutlookLoading = outlookLoading[_activePatternSym] ?? false;

  return (
    <div className="flex flex-col gap-4">

      {/* ── Mode Toggle ── */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-3">
        <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-[0.08em] mb-2.5 px-1">Backtest Mode</div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 gap-2">
          {([
            { key: "multi_stock" as const, Icon: Shuffle,          label: "Multi-Stock", desc: "1 algo · N stocks" },
            { key: "multi_algo"  as const, Icon: Zap,              label: "Multi-Algo",  desc: "N algos · 1 stock" },
            { key: "matrix"      as const, Icon: LayoutGrid,       label: "Matrix",      desc: "M algos · N stocks" },
            { key: "options"     as const, Icon: Sigma,            label: "Options",     desc: "straddle / strangle" },
            { key: "orb"         as const, Icon: Sunrise,          label: "ORB",         desc: "opening-range breakout" },
            { key: "grid"        as const, Icon: SlidersHorizontal, label: "Grid Search", desc: "tune thresholds & periods" },
            { key: "ml"          as const, Icon: BrainCircuit,     label: "ML Models",   desc: "learned entry filter" },
            { key: "quant"       as const, Icon: Radar,            label: "Quant Signals", desc: "pullback/bounce/accum/distrib" },
          ]).map((m) => {
            const active = mode === m.key;
            return (
              <button key={m.key} onClick={() => setMode(m.key)} title={m.desc}
                className={`group flex items-center gap-2.5 p-2.5 rounded-xl border text-left transition-all duration-150 ${
                  active
                    ? "border-blue-500 bg-blue-50/70 ring-1 ring-blue-500/15 shadow-sm"
                    : "border-slate-200 bg-white hover:border-blue-300 hover:bg-blue-50/40"
                }`}>
                <span className={`flex items-center justify-center w-8 h-8 rounded-lg shrink-0 transition-colors ${
                  active ? "bg-blue-500 text-white" : "bg-slate-100 text-slate-500 group-hover:bg-blue-100 group-hover:text-blue-600"
                }`}>
                  <m.Icon size={16} strokeWidth={2.2} />
                </span>
                <span className="min-w-0">
                  <span className={`block text-xs font-semibold leading-tight truncate ${active ? "text-blue-700" : "text-slate-700"}`}>{m.label}</span>
                  <span className={`block text-[10px] leading-tight mt-0.5 truncate ${active ? "text-blue-500/80" : "text-slate-400"}`}>{m.desc}</span>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Section 1: Universe (Multi-Stock, Matrix, Grid, ML modes) ── */}
      {(mode === "multi_stock" || mode === "matrix" || mode === "grid" || mode === "ml" || mode === "quant") && <section className="bg-white border border-slate-200 rounded-xl shadow-sm p-4">
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
      </section>}

      {/* ── Multi-Algo mode: stock picker + algo stack ── */}
      {mode === "multi_algo" && (
        <MultiAlgoPanel
          symbol={multiAlgoSymbol}
          algoSlots={algoSlots}
          activeAlgoId={activeAlgoId}
          indicators={indicators}
          operators={operators}
          onSymbolChange={setMultiAlgoSymbol}
          onAddAlgo={addAlgoSlot}
          onAddCustomAlgo={addCustomAlgoSlot}
          onRemoveAlgo={removeAlgoSlot}
          onUpdateAlgo={updateAlgoSlot}
          onSetActive={setActiveAlgo}
          onRunAll={runAllAlgos}
          expandedAlgoId={expandedAlgoId}
          setExpandedAlgoId={setExpandedAlgoId}
        />
      )}

      {/* ── Options mode: straddle/strangle or spread backtest ── */}
      {mode === "options" && (
        <>
          <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-xl shadow-sm px-4 py-3">
            <span className="text-xs font-semibold text-slate-500 mr-1">Options Strategy Family</span>
            {([
              { key: "straddle" as const, label: "Straddle / Strangle" },
              { key: "spread" as const, label: "Spreads" },
            ]).map((f) => (
              <button key={f.key} onClick={() => setOptionsFamily(f.key)}
                className={`px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
                  optionsFamily === f.key
                    ? "bg-blue-500 text-white border-blue-500"
                    : "border-slate-200 text-slate-600 hover:border-blue-300 hover:bg-blue-50"
                }`}>
                {f.label}
              </button>
            ))}
          </div>

          {optionsFamily === "straddle" ? (
            <OptionsStraddlePanel
              straddle={straddle}
              results={straddleResults}
              loading={straddleLoading}
              error={straddleError}
              onChange={setStraddle}
              onRun={runStraddle}
            />
          ) : (
            <OptionsSpreadPanel
              spread={spread}
              results={spreadResults}
              loading={spreadLoading}
              error={spreadError}
              onChange={setSpread}
              onRun={runSpread}
            />
          )}
        </>
      )}

      {/* ── ORB mode ── */}
      {mode === "orb" && (
        <OrbPanel
          orb={orb}
          results={orbResults}
          loading={orbLoading}
          error={orbError}
          onChange={setOrb}
          onRun={runOrb}
        />
      )}

      {/* ── Grid Search mode ── */}
      {mode === "grid" && <GridSearchPanel />}

      {/* ── ML Models mode ── */}
      {mode === "ml" && <MlPanel />}

      {/* ── Quant Signals mode ── */}
      {mode === "quant" && <QuantSignalPanel />}

      {/* ── Section 2: Strategy (Multi-Stock mode only) ── */}
      {mode === "multi_stock" && <section className={`bg-white border border-slate-200 rounded-xl shadow-sm p-4 transition-opacity ${pickedSymbols.length === 0 ? "opacity-40 pointer-events-none" : ""}`}>
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
            <label className="text-xs text-slate-500 mb-1 block">
              Max Hold ({strategy.timeframe === "1W" ? "weeks" : "days"})
            </label>
            <input type="number" value={strategy.max_bars}
              onChange={(e) => setStrategy({ max_bars: parseInt(e.target.value) })}
              className="w-full text-sm px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:border-blue-400" />
          </div>
          <div>
            <label className="text-xs text-slate-500 mb-1 block">Position Size (₹)</label>
            <input type="number" value={strategy.capital_per_trade}
              onChange={(e) => setStrategy({ capital_per_trade: parseFloat(e.target.value) })}
              className="w-full text-sm px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:border-blue-400" />
          </div>
        </div>

        {/* Risk : Reward display */}
        <div className="flex items-center gap-5 px-3 py-2 rounded-lg bg-slate-50 border border-slate-100 mb-3">
          <div>
            <div className="text-[10px] text-slate-400 font-medium">Risk : Reward</div>
            <div className={`text-lg font-bold leading-tight ${rrColor}`}>1 : {rr.toFixed(2)}</div>
          </div>
          <div className="border-l border-slate-200 pl-5">
            <div className="text-[10px] text-slate-400">Min win rate to profit</div>
            <div className="text-sm font-semibold text-slate-600">{minWin}%</div>
          </div>
          <div className="border-l border-slate-200 pl-5 text-[10px] text-slate-400 leading-relaxed">
            {rr >= 2 ? "✓ Excellent — even 32% wins are profitable"
              : rr >= 1.5 ? "~ Good ratio — solid risk management"
              : "⚠ Low R:R — need very high win rate to profit"}
          </div>
        </div>

        <div className="grid grid-cols-4 gap-3 mb-4">
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
          <div>
            <label className="text-xs text-slate-500 mb-1 block" title="Cash = stock price. Futures = continuous roll-adjusted near-month futures series (needs futures data fetched on the F&O page first).">
              Data Source
            </label>
            <div className="flex rounded-lg overflow-hidden border border-slate-200 text-xs h-[34px]">
              {(["cash", "futures"] as const).map((ds) => (
                <button key={ds}
                  onClick={() => setStrategy({ data_source: ds })}
                  className={`flex-1 font-medium transition-colors ${
                    strategy.data_source === ds
                      ? "bg-blue-500 text-white"
                      : "text-slate-500 bg-slate-50 hover:bg-slate-100"
                  }`}>
                  {ds === "cash" ? "Cash" : "Futures"}
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
      </section>}

      {/* ── Matrix: Algo Builder + Shared Settings ── */}
      {mode === "matrix" && (
        <section className={`bg-white border border-slate-200 rounded-xl shadow-sm p-4 transition-opacity ${pickedSymbols.length === 0 ? "opacity-40 pointer-events-none" : ""}`}>
          <div className="flex items-center gap-2 mb-4">
            <div className="w-5 h-5 rounded-full bg-blue-500 text-white text-xs flex items-center justify-center font-bold shrink-0">2</div>
            <span className="text-sm font-semibold text-slate-700">Define Algos</span>
            <span className="text-xs text-slate-400 ml-1">— up to 4 algos, each with its own entry conditions</span>
          </div>

          {/* Algo tab buttons */}
          <div className="flex items-center gap-2 flex-wrap mb-3">
            {matrixAlgos.map((algo) => (
              <button key={algo.id}
                onClick={() => setMatrixExpandedAlgoId(matrixExpandedAlgoId === algo.id ? null : algo.id)}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
                  matrixExpandedAlgoId === algo.id
                    ? "border-blue-400 bg-blue-50 text-blue-700"
                    : "border-slate-200 text-slate-600 hover:border-blue-300 hover:bg-blue-50"
                }`}>
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: algo.color }} />
                {algo.label}
              </button>
            ))}
            {matrixAlgos.length < 4 && (
              <button onClick={addMatrixAlgo}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-dashed border-slate-300 text-xs text-slate-400 hover:text-blue-500 hover:border-blue-300 transition-colors">
                <Plus size={12} /> Add Algo
              </button>
            )}
          </div>

          {/* Expanded algo card */}
          {matrixExpandedAlgoId && (() => {
            const algo = matrixAlgos.find((a) => a.id === matrixExpandedAlgoId);
            if (!algo) return null;
            return (
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 mb-4">
                <div className="flex items-center gap-3 mb-4">
                  <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: algo.color }} />
                  <input value={algo.label}
                    onChange={(e) => updateMatrixAlgo(algo.id, { label: e.target.value })}
                    className="flex-1 text-sm font-semibold bg-transparent border-b border-slate-300 focus:border-blue-400 outline-none py-0.5"
                    placeholder="Algo name…" />
                  {matrixAlgos.length > 1 && (
                    <button onClick={() => { removeMatrixAlgo(algo.id); setMatrixExpandedAlgoId(matrixAlgos.find(a => a.id !== algo.id)?.id ?? null); }}
                      className="text-slate-300 hover:text-red-400 transition-colors">
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>

                <div className="mb-3">
                  <div className="text-[10px] text-slate-400 mb-1.5">Load a strategy template into this slot →</div>
                  <div className="flex flex-wrap gap-1.5">
                    {PRESETS.slice(0, 7).map((p) => (
                      <button key={p.label} title={`Load "${p.label}" conditions into this algo slot`}
                        onClick={() => updateMatrixAlgo(algo.id, { label: p.label, strategy: { ...algo.strategy, entry_conditions: p.conditions } })}
                        className="px-2 py-0.5 text-xs border rounded-full bg-slate-100 text-slate-600 border-slate-200 hover:bg-blue-50 hover:text-blue-700 hover:border-blue-300 transition-all">
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="mb-3">
                  <div className="text-xs text-slate-500 font-semibold mb-2">Entry Conditions</div>
                  {indicators.length > 0 ? (
                    <ConditionBuilder
                      conditions={algo.strategy.entry_conditions.length ? algo.strategy.entry_conditions : [{ left: "close", operator: "crosses_above", right: "sma_50" }]}
                      onChange={(rows) => updateMatrixAlgo(algo.id, { strategy: { ...algo.strategy, entry_conditions: rows } })}
                      indicators={indicators}
                      operators={operators}
                    />
                  ) : <div className="text-xs text-slate-400 animate-pulse">Loading indicators…</div>}
                </div>

                <div className="grid grid-cols-3 gap-3 pt-3 border-t border-slate-200">
                  <div>
                    <label className="text-xs text-slate-400 mb-1 block">Target %</label>
                    <input type="number" step="0.5" value={algo.strategy.target_pct}
                      onChange={(e) => updateMatrixAlgo(algo.id, { strategy: { ...algo.strategy, target_pct: parseFloat(e.target.value) } })}
                      className="w-full text-xs px-2 py-1.5 bg-white border border-slate-200 rounded-lg outline-none focus:border-blue-400" />
                  </div>
                  <div>
                    <label className="text-xs text-slate-400 mb-1 block">SL %</label>
                    <input type="number" step="0.5" value={algo.strategy.sl_pct}
                      onChange={(e) => updateMatrixAlgo(algo.id, { strategy: { ...algo.strategy, sl_pct: parseFloat(e.target.value) } })}
                      className="w-full text-xs px-2 py-1.5 bg-white border border-slate-200 rounded-lg outline-none focus:border-blue-400" />
                  </div>
                  <div>
                    <label className="text-xs text-slate-400 mb-1 block">Max Hold (days)</label>
                    <input type="number" value={algo.strategy.max_bars}
                      onChange={(e) => updateMatrixAlgo(algo.id, { strategy: { ...algo.strategy, max_bars: parseInt(e.target.value) } })}
                      className="w-full text-xs px-2 py-1.5 bg-white border border-slate-200 rounded-lg outline-none focus:border-blue-400" />
                  </div>
                </div>
              </div>
            );
          })()}

          {/* Shared date / capital / timeframe */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-3">
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
              <label className="text-xs text-slate-500 mb-1 block">Position Size (₹)</label>
              <input type="number" value={strategy.capital_per_trade}
                onChange={(e) => setStrategy({ capital_per_trade: parseFloat(e.target.value) })}
                className="w-full text-sm px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:border-blue-400" />
            </div>
            <div>
              <label className="text-xs text-slate-500 mb-1 block">Timeframe</label>
              <div className="flex rounded-lg overflow-hidden border border-slate-200 text-xs h-[34px]">
                {(["1D", "1W"] as const).map((tf) => (
                  <button key={tf} onClick={() => setStrategy({ timeframe: tf })}
                    className={`flex-1 font-medium transition-colors ${
                      strategy.timeframe === tf ? "bg-blue-500 text-white" : "text-slate-500 bg-slate-50 hover:bg-slate-100"
                    }`}>
                    {tf === "1D" ? "Daily" : "Weekly"}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-xs text-slate-500 mb-1 block" title="Cash = stock price. Futures = continuous roll-adjusted near-month futures series (needs futures data fetched on the F&O page first).">
                Data Source
              </label>
              <div className="flex rounded-lg overflow-hidden border border-slate-200 text-xs h-[34px]">
                {(["cash", "futures"] as const).map((ds) => (
                  <button key={ds} onClick={() => setStrategy({ data_source: ds })}
                    className={`flex-1 font-medium transition-colors ${
                      strategy.data_source === ds ? "bg-blue-500 text-white" : "text-slate-500 bg-slate-50 hover:bg-slate-100"
                    }`}>
                    {ds === "cash" ? "Cash" : "Futures"}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <button onClick={runMatrix}
            disabled={pickedSymbols.length === 0 || matrixAlgos.every((a) => a.strategy.entry_conditions.length === 0) || matrixLoading}
            className="flex items-center gap-2 px-5 py-2 bg-blue-500 hover:bg-blue-600 disabled:opacity-40 text-white text-sm font-medium rounded-lg transition-colors">
            {matrixLoading
              ? <><span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin shrink-0" /> {matrixProgress ? `Running… ${matrixProgress.done}/${matrixProgress.total}` : "Starting…"}</>
              : <><Play size={13} /> Run Matrix · {pickedSymbols.length} stocks × {matrixAlgos.length} algo{matrixAlgos.length !== 1 ? "s" : ""}</>
            }
          </button>

          {matrixLoading && (
            <div className="mt-3 w-full max-w-sm">
              <div className="flex justify-between text-xs text-slate-500 mb-1">
                <span>{matrixProgress ? `${matrixProgress.done} / ${matrixProgress.total} combinations` : "Fetching data…"}</span>
                <span className="font-semibold text-blue-500">
                  {matrixProgress ? `${Math.round(matrixProgress.done / matrixProgress.total * 100)}%` : "0%"}
                </span>
              </div>
              <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-blue-500 rounded-full transition-all duration-300"
                  style={{ width: matrixProgress ? `${(matrixProgress.done / matrixProgress.total) * 100}%` : "0%" }}
                />
              </div>
            </div>
          )}

          {matrixError && (
            <div className="mt-3 flex items-center gap-2 text-sm text-red-500">
              <AlertCircle size={14} /> {matrixError.replace("Error: ", "")}
            </div>
          )}
        </section>
      )}

      {/* ── Multi-Algo Results ── */}
      {mode === "multi_algo" && <MultiAlgoResults
        symbol={multiAlgoSymbol}
        algoSlots={algoSlots}
        activeAlgoId={activeAlgoId}
        onSetActive={setActiveAlgo}
        patternHits={activePatternHits}
        outlook={activeOutlook as Parameters<typeof TrendOutlook>[0]["data"]}
        outlookLoading={activeOutlookLoading}
      />}

      {/* ── Section 3: Results — left panel + right panel (Multi-Stock mode) ── */}
      {mode === "multi_stock" && (v2Results || v2Loading) && (
        <section className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">

          {/* Toolbar */}
          {v2Results && (
            <div className="flex items-center gap-2 px-4 py-2 border-b border-slate-100 bg-slate-50/60 flex-wrap">
              <span className="text-xs font-semibold text-slate-500">Results</span>
              {savedRuns.length > 0 && (
                <>
                  <button onClick={() => { setCompareMode((m) => !m); setActiveRunId(null); }}
                    className={`flex items-center gap-1.5 px-2.5 py-1 text-xs border rounded-lg font-medium transition-colors ${
                      compareMode ? "bg-blue-500 text-white border-blue-500" : "border-slate-200 text-slate-600 hover:border-blue-300 hover:bg-blue-50"
                    }`}>
                    <BarChart2 size={12} /> Compare ({savedRuns.length} saved)
                  </button>
                  <button onClick={clearSavedRuns} className="text-xs text-slate-400 hover:text-red-400 transition-colors ml-auto">Clear all</button>
                </>
              )}
            </div>
          )}

          {/* Custom-run save banner */}
          {showCustomSave && v2Results && (
            <div className="flex items-center gap-2 px-4 py-2 border-b border-blue-100 bg-blue-50/60 flex-wrap">
              <BookmarkPlus size={13} className="text-blue-500 shrink-0" />
              <span className="text-xs text-blue-700 font-medium">Custom run complete — save to compare later:</span>
              <input autoFocus value={customSaveLabel} onChange={(e) => setCustomSaveLabel(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && customSaveLabel.trim()) { saveCurrentRun(customSaveLabel.trim()); setShowCustomSave(false); setCompareMode(true); }
                  if (e.key === "Escape") setShowCustomSave(false);
                }}
                placeholder="Name this run…"
                className="text-xs px-2 py-1 border border-blue-200 rounded-lg outline-none focus:border-blue-400 bg-white w-40" />
              <button disabled={!customSaveLabel.trim()}
                onClick={() => { saveCurrentRun(customSaveLabel.trim()); setShowCustomSave(false); setCompareMode(true); }}
                className="text-xs px-2.5 py-1 bg-blue-500 text-white rounded-lg disabled:opacity-40 hover:bg-blue-600 font-medium">Save</button>
              <button onClick={() => setShowCustomSave(false)} className="text-xs text-slate-400 hover:text-slate-600">Skip</button>
            </div>
          )}

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
                <div className="text-[10px] text-slate-400 font-semibold uppercase tracking-wide mb-1">Strategy Results</div>
                {displayResults ? (
                  <>
                    <div className={`text-base font-bold ${pnlClass(displayResults.aggregate.total_pnl)}`}>
                      {displayResults.aggregate.total_pnl >= 0 ? "+" : ""}₹{fmt(displayResults.aggregate.total_pnl)}
                    </div>
                    <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 mt-1.5 text-[10px]">
                      <span className="text-slate-400">{displayResults.aggregate.total_trades} trades</span>
                      <span className={displayResults.aggregate.win_rate_pct >= 50 ? "text-emerald-500" : "text-red-400"}>
                        {displayResults.aggregate.win_rate_pct}% win rate
                      </span>
                      <span className={aggStats.profitFactor >= 1.5 ? "text-emerald-500" : aggStats.profitFactor >= 1 ? "text-amber-500" : "text-red-400"}>
                        PF {isFinite(aggStats.profitFactor) ? aggStats.profitFactor.toFixed(2) : "∞"}×
                      </span>
                      <span className={aggStats.expectancy >= 0 ? "text-emerald-500" : "text-red-400"}>
                        {aggStats.expectancy >= 0 ? "+" : ""}{aggStats.expectancy.toFixed(1)}% exp
                      </span>
                    </div>
                    {/* Outcome probability bars */}
                    {allTrades.length > 0 && (
                      <div className="mt-2 space-y-1">
                        {[
                          { label: "🎯 Target", count: aggStats.targetHits, color: "bg-emerald-400" },
                          { label: "🛑 Stop", count: aggStats.slHits, color: "bg-red-400" },
                          { label: "⏱ Time", count: aggStats.timeStops, color: "bg-slate-300" },
                        ].map(({ label, count, color }) => {
                          const pct = (count / allTrades.length) * 100;
                          return (
                            <div key={label}>
                              <div className="flex justify-between text-[9px] text-slate-400 mb-0.5">
                                <span>{label}</span>
                                <span>{pct.toFixed(0)}% ({count})</span>
                              </div>
                              <div className="h-1 bg-slate-100 rounded-full overflow-hidden">
                                <div className={`h-full ${color} rounded-full`} style={{ width: `${pct}%` }} />
                              </div>
                            </div>
                          );
                        })}
                        <div className={`text-[9px] font-semibold mt-1 ${edge >= 0 ? "text-emerald-600" : "text-red-500"}`}>
                          {edge >= 0 ? "+" : ""}{edge.toFixed(1)}% edge vs random walk ({randomPTarget.toFixed(0)}% baseline)
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="text-slate-300 text-sm animate-pulse">—</div>
                )}
              </div>

              <div className="overflow-y-auto flex-1">
                {symbolsWithResults.map((sym) => {
                  const symStats  = displayResults!.per_symbol[sym].stats;
                  const symTrades = displayResults!.per_symbol[sym].trades;
                  const symPF     = tradeStats(symTrades).profitFactor;
                  const isActive  = sym === activeSymbol;
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
                        {symStats.total_trades} trades · {symStats.win_rate_pct}% win rate
                        {symTrades.length > 0 && (
                          <span className={`ml-1 ${symPF >= 1.5 ? "text-emerald-500" : symPF >= 1 ? "text-amber-500" : "text-red-400"}`}>
                            · PF {isFinite(symPF) ? symPF.toFixed(1) : "∞"}×
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Center: chart + trade log */}
            <div className="flex-1 min-w-0 flex flex-col border-r border-slate-100">
              {activeData ? (
                <>
                  <div className="px-4 pt-3 pb-1.5 flex items-center gap-3 border-b border-slate-100 flex-wrap">
                    <span className="text-sm font-semibold text-slate-800">{activeSymbol}</span>
                    <div className="flex items-center gap-3 text-xs text-slate-400">
                      <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full bg-blue-500" /> Entry</span>
                      <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full bg-emerald-500" /> Target</span>
                      <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full bg-red-400" /> SL</span>
                    </div>
                    <div className="ml-auto">
                      <span className="text-xs text-slate-400">
                        {activeData.trades.length} trade{activeData.trades.length !== 1 ? "s" : ""}
                        {activeData.stats.total_pnl !== 0 && (
                          <span className={`ml-2 font-semibold ${pnlClass(activeData.stats.total_pnl)}`}>
                            {activeData.stats.total_pnl >= 0 ? "+" : ""}₹{fmt(activeData.stats.total_pnl)}
                          </span>
                        )}
                      </span>
                    </div>
                  </div>

                  <BacktestChart
                    symbol={activeSymbol!}
                    ohlcv={activeData.ohlcv}
                    trades={activeData.trades}
                    patternHits={activePatternHits}
                    boxZones={tradeBoxZones(activeData.trades)}
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

            {/* Right sidebar: recent patterns + trend outlook */}
            <div className="w-72 shrink-0 flex flex-col overflow-y-auto bg-slate-50/30">
              <div className="px-3 pt-3 pb-2 border-b border-slate-100">
                <div className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">
                  Recent Patterns · Last 10 Days
                </div>
              </div>
              <div className="flex-1 px-2 py-2 space-y-1.5">
                {activePatternHits.length === 0 ? (
                  <div className="text-[10px] text-slate-400 text-center py-6">No patterns in last 10 trading days</div>
                ) : (
                  activePatternHits.map((p, i) => {
                    const bars = CANDLE_BARS[p.label] ?? 1;
                    return (
                      <div key={i} className={`px-2 py-1.5 rounded-lg border ${
                        p.bias === "bullish" ? "bg-purple-50 border-purple-100" : "bg-fuchsia-50 border-fuchsia-100"
                      }`}>
                        <div className="flex items-center gap-1.5 mb-0.5">
                          <span className={`font-bold text-[11px] ${p.bias === "bullish" ? "text-purple-600" : "text-fuchsia-600"}`}>{p.label}</span>
                          <span className="text-[9px] text-slate-400 bg-slate-100 rounded px-1">{bars}-bar</span>
                          <span className={`ml-auto text-xs ${p.bias === "bullish" ? "text-purple-400" : "text-fuchsia-400"}`}>
                            {p.bias === "bullish" ? "↑" : "↓"}
                          </span>
                        </div>
                        <div className={`text-[10px] font-semibold ${p.bias === "bullish" ? "text-purple-700" : "text-fuchsia-700"}`}>{p.date}</div>
                        <div className="text-slate-500 text-[9px] leading-tight mt-0.5">{p.tip}</div>
                      </div>
                    );
                  })
                )}
              </div>
              <div className="border-t border-slate-100 px-3 pt-3 pb-4">
                <div className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mb-2">Trend Outlook</div>
                <TrendOutlook
                  symbol={activeSymbol ?? ""}
                  data={activeOutlook as Parameters<typeof TrendOutlook>[0]["data"]}
                  loading={activeOutlookLoading}
                  sidebar
                />
              </div>
            </div>

          </div>
        </section>
      )}

      {/* ── Matrix Results ── */}
      {mode === "matrix" && matrixResults && (
        <section className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
          {/* Summary bar */}
          <div className="px-4 py-3 border-b border-slate-100 bg-slate-50 flex flex-wrap items-center gap-3 text-sm">
            <span className="font-semibold text-slate-700">
              {matrixAlgos.length} algo{matrixAlgos.length !== 1 ? "s" : ""} × {Object.keys(matrixResults.matrix).length} stocks
            </span>
            <span className="text-slate-300">|</span>
            <span className="text-slate-600">{matrixResults.aggregate.total_trades} trades</span>
            <span className={matrixResults.aggregate.win_rate_pct >= 55 ? "font-semibold text-emerald-600" : "font-semibold text-red-500"}>
              {matrixResults.aggregate.win_rate_pct}% win
            </span>
            <span className={`font-semibold ${pnlClass(matrixResults.aggregate.total_pnl)}`}>
              ₹{fmt(matrixResults.aggregate.total_pnl)}
            </span>
            {matrixResults.aggregate.best_combo && (
              <span className="text-xs text-slate-500 hidden lg:inline">
                Best: <span className="text-emerald-600 font-semibold">
                  {matrixResults.aggregate.best_combo.symbol} + {matrixAlgos.find((a) => a.id === matrixResults.aggregate.best_combo!.algo_id)?.label}
                </span> ({matrixResults.aggregate.best_combo.win_rate_pct}% win, ₹{fmt(matrixResults.aggregate.best_combo.total_pnl)})
              </span>
            )}
            {matrixResults.aggregate.worst_combo && (
              <span className="text-xs text-slate-500 hidden lg:inline">
                · Worst: <span className="text-red-500 font-semibold">
                  {matrixResults.aggregate.worst_combo.symbol} + {matrixAlgos.find((a) => a.id === matrixResults.aggregate.worst_combo!.algo_id)?.label}
                </span> ({matrixResults.aggregate.worst_combo.win_rate_pct}% win)
              </span>
            )}
          </div>

          {/* View tabs + metric selector */}
          <div className="flex items-center gap-3 px-4 py-2 border-b border-slate-100 flex-wrap">
            <div className="flex gap-1">
              {([
                { key: "heatmap" as const, label: "Heatmap" },
                { key: "table"   as const, label: "Ranked Table" },
                { key: "compare" as const, label: "Algo Compare" },
              ]).map((v) => (
                <button key={v.key} onClick={() => setMatrixView(v.key)}
                  className={`px-3 py-1 text-xs rounded-lg font-medium transition-colors ${
                    matrixView === v.key ? "bg-blue-500 text-white" : "text-slate-500 hover:bg-slate-100"
                  }`}>
                  {v.label}
                </button>
              ))}
            </div>
            {matrixView === "heatmap" && (
              <div className="ml-auto flex gap-1">
                {([
                  { key: "win_rate" as const, label: "Win %" },
                  { key: "pnl"      as const, label: "PnL ₹" },
                  { key: "trades"   as const, label: "Trades" },
                ]).map((m) => (
                  <button key={m.key} onClick={() => setMatrixMetric(m.key)}
                    className={`px-2.5 py-0.5 text-xs rounded-full border font-medium transition-colors ${
                      matrixMetric === m.key
                        ? "bg-slate-700 text-white border-slate-700"
                        : "border-slate-200 text-slate-500 hover:border-slate-400"
                    }`}>
                    {m.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Main content area */}
          <div className={`flex ${selectedCell ? "divide-x divide-slate-100" : ""}`}>
            <div className={`${selectedCell ? "w-1/2 min-w-0" : "w-full"} overflow-auto`}>

              {/* Heatmap View */}
              {matrixView === "heatmap" && (() => {
                const syms = Object.keys(matrixResults.matrix);
                const getCellValue = (sym: string, algoId: string): number | null => {
                  const stats = matrixResults.matrix[sym]?.[algoId]?.stats;
                  if (!stats || stats.total_trades === 0) return null;
                  return matrixMetric === "win_rate" ? stats.win_rate_pct
                       : matrixMetric === "pnl"      ? stats.total_pnl
                       : stats.total_trades;
                };
                const cellColor = (sym: string, algoId: string) => {
                  const stats = matrixResults.matrix[sym]?.[algoId]?.stats;
                  if (!stats || stats.total_trades === 0) return "bg-slate-50 text-slate-300 cursor-default";
                  const wr = stats.win_rate_pct;
                  if (wr >= 70) return "bg-emerald-50 text-emerald-700 hover:bg-emerald-100";
                  if (wr >= 55) return "bg-amber-50 text-amber-700 hover:bg-amber-100";
                  return "bg-red-50 text-red-600 hover:bg-red-100";
                };
                return (
                  <div className="p-4">
                    <div className="overflow-auto max-h-[420px]">
                    <table className="border-collapse text-sm w-full">
                      <thead>
                        <tr>
                          <th className="w-32 pr-4 pb-2 text-left text-xs text-slate-400 font-medium">Stock ↓ Algo →</th>
                          {matrixAlgos.map((algo) => (
                            <th key={algo.id} className="px-3 pb-2 text-center min-w-28">
                              <div className="flex items-center justify-center gap-1.5">
                                <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: algo.color }} />
                                <span className="text-xs font-semibold text-slate-600 truncate max-w-24">{algo.label}</span>
                              </div>
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {syms.map((sym) => (
                          <tr key={sym}>
                            <td className="pr-4 py-1.5 text-xs font-semibold text-slate-700">{sym}</td>
                            {matrixAlgos.map((algo) => {
                              const val = getCellValue(sym, algo.id);
                              const sel = selectedCell?.symbol === sym && selectedCell?.algoId === algo.id;
                              return (
                                <td key={algo.id} className="px-2 py-1.5">
                                  <button
                                    onClick={() => val !== null && setSelectedCell(sel ? null : { symbol: sym, algoId: algo.id })}
                                    className={`w-full px-3 py-2 rounded-lg text-xs font-semibold transition-all ${cellColor(sym, algo.id)} ${
                                      sel ? "ring-2 ring-blue-500 ring-offset-1" : ""
                                    }`}>
                                    {val === null ? "—"
                                      : matrixMetric === "pnl"      ? `₹${fmt(val)}`
                                      : matrixMetric === "win_rate" ? `${val}%`
                                      : String(val)
                                    }
                                  </button>
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    </div>
                    <div className="mt-3 flex gap-4 text-[10px] text-slate-400">
                      <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-emerald-100 inline-block" /> ≥ 70% win</span>
                      <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-amber-100 inline-block" /> 55–70%</span>
                      <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-red-100 inline-block" /> &lt; 55%</span>
                      <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-slate-100 inline-block" /> no trades</span>
                    </div>
                  </div>
                );
              })()}

              {/* Ranked Table View */}
              {matrixView === "table" && (() => {
                const rows: { sym: string; algoId: string; algoLabel: string; algoColor: string; trades: number; winRate: number; pnl: number; avgPct: number }[] = [];
                for (const sym of Object.keys(matrixResults.matrix)) {
                  for (const algo of matrixAlgos) {
                    const stats = matrixResults.matrix[sym]?.[algo.id]?.stats;
                    if (stats && stats.total_trades > 0) {
                      rows.push({ sym, algoId: algo.id, algoLabel: algo.label, algoColor: algo.color,
                        trades: stats.total_trades, winRate: stats.win_rate_pct, pnl: stats.total_pnl, avgPct: stats.avg_pnl_pct });
                    }
                  }
                }
                rows.sort((a, b) => b.pnl - a.pnl);
                return (
                  <div className="overflow-auto max-h-[500px]">
                    <table className="w-full text-xs">
                      <thead className="sticky top-0 bg-slate-50 z-10 border-b border-slate-100">
                        <tr className="text-slate-400 font-semibold">
                          <th className="text-left px-4 py-2">#</th>
                          <th className="text-left px-4 py-2">Algo</th>
                          <th className="text-left px-4 py-2">Stock</th>
                          <th className="text-right px-4 py-2">Trades</th>
                          <th className="text-right px-4 py-2">Win %</th>
                          <th className="text-right px-4 py-2">Total PnL</th>
                          <th className="text-right px-4 py-2">Avg %</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((r, i) => {
                          const sel = selectedCell?.symbol === r.sym && selectedCell?.algoId === r.algoId;
                          return (
                            <tr key={`${r.sym}-${r.algoId}`}
                              onClick={() => setSelectedCell(sel ? null : { symbol: r.sym, algoId: r.algoId })}
                              className={`border-b border-slate-50 cursor-pointer transition-colors ${sel ? "bg-blue-50" : "hover:bg-slate-50"}`}>
                              <td className="px-4 py-2 text-slate-400">{i + 1}</td>
                              <td className="px-4 py-2">
                                <div className="flex items-center gap-1.5">
                                  <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: r.algoColor }} />
                                  <span className="font-medium text-slate-700">{r.algoLabel}</span>
                                </div>
                              </td>
                              <td className="px-4 py-2 font-semibold text-slate-700">{r.sym}</td>
                              <td className="px-4 py-2 text-right text-slate-600">{r.trades}</td>
                              <td className={`px-4 py-2 text-right font-semibold ${r.winRate >= 55 ? "text-emerald-600" : "text-red-500"}`}>{r.winRate}%</td>
                              <td className={`px-4 py-2 text-right font-semibold ${pnlClass(r.pnl)}`}>₹{fmt(r.pnl)}</td>
                              <td className={`px-4 py-2 text-right ${pnlClass(r.avgPct)}`}>{r.avgPct > 0 ? "+" : ""}{r.avgPct.toFixed(1)}%</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                );
              })()}

              {/* Algo Compare View */}
              {matrixView === "compare" && (
                <div className="p-4 overflow-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-slate-100 text-slate-400 font-semibold">
                        <th className="text-left px-3 py-2">Algo</th>
                        <th className="text-right px-3 py-2">Stocks</th>
                        <th className="text-right px-3 py-2">Trades</th>
                        <th className="text-right px-3 py-2">Win %</th>
                        <th className="text-right px-3 py-2">Total PnL</th>
                        <th className="text-right px-3 py-2">Avg %</th>
                        <th className="text-left px-3 py-2">Best Stock</th>
                      </tr>
                    </thead>
                    <tbody>
                      {matrixAlgos.map((algo) => {
                        const agg = matrixResults.per_algo[algo.id];
                        if (!agg) return null;
                        const symPnls = Object.keys(matrixResults.matrix)
                          .map((sym) => ({
                            sym,
                            pnl: matrixResults.matrix[sym]?.[algo.id]?.stats?.total_pnl ?? 0,
                            wr: matrixResults.matrix[sym]?.[algo.id]?.stats?.win_rate_pct ?? 0,
                            trades: matrixResults.matrix[sym]?.[algo.id]?.stats?.total_trades ?? 0,
                          }))
                          .filter((x) => x.trades > 0);
                        const best = symPnls.length ? symPnls.reduce((a, b) => b.pnl > a.pnl ? b : a) : null;
                        return (
                          <tr key={algo.id} className="border-b border-slate-50">
                            <td className="px-3 py-2.5">
                              <div className="flex items-center gap-2">
                                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: algo.color }} />
                                <span className="font-semibold text-slate-700">{algo.label}</span>
                              </div>
                            </td>
                            <td className="px-3 py-2.5 text-right text-slate-600">{symPnls.length}</td>
                            <td className="px-3 py-2.5 text-right text-slate-600">{agg.total_trades}</td>
                            <td className={`px-3 py-2.5 text-right font-semibold ${agg.win_rate_pct >= 55 ? "text-emerald-600" : "text-red-500"}`}>{agg.win_rate_pct}%</td>
                            <td className={`px-3 py-2.5 text-right font-semibold ${pnlClass(agg.total_pnl)}`}>₹{fmt(agg.total_pnl)}</td>
                            <td className={`px-3 py-2.5 text-right ${pnlClass(agg.avg_pnl_pct)}`}>{agg.avg_pnl_pct > 0 ? "+" : ""}{agg.avg_pnl_pct.toFixed(1)}%</td>
                            <td className="px-3 py-2.5">
                              {best ? (
                                <button onClick={() => { setSelectedCell({ symbol: best.sym, algoId: algo.id }); setMatrixView("heatmap"); }}
                                  className="text-blue-600 hover:underline font-medium">
                                  {best.sym} ({best.wr}% win)
                                </button>
                              ) : <span className="text-slate-300">—</span>}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Drill-down Panel */}
            {selectedCell && (() => {
              const { symbol, algoId } = selectedCell;
              const algo = matrixAlgos.find((a) => a.id === algoId);
              const combo = matrixResults.matrix[symbol]?.[algoId];
              if (!combo || !algo) return null;
              const { trades, stats, ohlcv } = combo;
              return (
                <div className="w-1/2 shrink-0 flex flex-col" style={{ maxHeight: "calc(100vh - 180px)" }}>
                  <div className="px-4 py-2.5 border-b border-slate-100 flex items-center gap-2 shrink-0">
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: algo.color }} />
                    <span className="font-semibold text-sm text-slate-700">{symbol}</span>
                    <span className="text-slate-400 text-xs">·</span>
                    <span className="text-sm text-slate-600 truncate">{algo.label}</span>
                    <button onClick={() => setSelectedCell(null)} className="ml-auto text-slate-300 hover:text-slate-500 shrink-0">
                      <X size={14} />
                    </button>
                  </div>
                  <div className="flex gap-4 px-4 py-2 bg-slate-50 border-b border-slate-100 text-xs shrink-0">
                    <span className="text-slate-500">{stats.total_trades} trades</span>
                    <span className={stats.win_rate_pct >= 55 ? "text-emerald-600 font-semibold" : "text-red-500 font-semibold"}>
                      {stats.win_rate_pct}% win
                    </span>
                    <span className={`font-semibold ${pnlClass(stats.total_pnl)}`}>₹{fmt(stats.total_pnl)}</span>
                    <span className={pnlClass(stats.avg_pnl_pct)}>avg {stats.avg_pnl_pct > 0 ? "+" : ""}{stats.avg_pnl_pct.toFixed(1)}%</span>
                  </div>
                  <div className="h-96 shrink-0 border-b border-slate-100 overflow-hidden">
                    {ohlcv.length > 0
                      ? <BacktestChart symbol={symbol} ohlcv={ohlcv} trades={trades} boxZones={tradeBoxZones(trades)} />
                      : <div className="flex items-center justify-center h-full text-slate-400 text-sm">No chart data</div>
                    }
                  </div>
                  <div className="flex-1 min-h-0 overflow-y-auto">
                    <table className="w-full text-xs">
                      <thead className="sticky top-0 bg-white border-b border-slate-100 z-10">
                        <tr className="text-slate-400 font-semibold">
                          <th className="text-left px-3 py-2">Entry</th>
                          <th className="text-left px-3 py-2">Exit</th>
                          <th className="text-right px-3 py-2">PnL</th>
                          <th className="px-3 py-2">Reason</th>
                        </tr>
                      </thead>
                      <tbody>
                        {trades.map((t, i) => (
                          <tr key={i} className="border-b border-slate-50">
                            <td className="px-3 py-1.5 text-slate-600">{t.entry_date.slice(0, 10)}</td>
                            <td className="px-3 py-1.5 text-slate-600">{t.exit_date.slice(0, 10)}</td>
                            <td className={`px-3 py-1.5 text-right font-semibold ${pnlClass(t.pnl)}`}>
                              {t.pnl >= 0 ? "+" : ""}₹{fmt(t.pnl)}
                            </td>
                            <td className="px-3 py-1.5 text-center"><ReasonChip reason={t.exit_reason} /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })()}
          </div>
        </section>
      )}

    </div>
  );
}
