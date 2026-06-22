import { useState, useRef, useEffect } from "react";
import { X, Plus, Play, TrendingUp, TrendingDown, BarChart2, RefreshCw, Star,
         Search, BookmarkPlus, Trash2, CheckCircle2, ChevronDown } from "lucide-react";
import { ScreenerCondition } from "../lib/api";
import { useScreenerStore } from "../store/useScreenerStore";

// ── Indicator catalogue ────────────────────────────────────────────────────

interface FilterDef {
  label: string;
  metric: string;
  category: string;
  defaultOp: "gt" | "lt" | "gte" | "lte";
  defaultValue: number;
  unit?: string;
  hint?: string;
}

const ALL_FILTERS: FilterDef[] = [
  // Price / OHLCV
  { category: "Price", label: "Close",          metric: "close",       defaultOp: "gt", defaultValue: 100,      unit: "₹" },
  { category: "Price", label: "Open",            metric: "open",        defaultOp: "gt", defaultValue: 100,      unit: "₹" },
  { category: "Price", label: "High",            metric: "high",        defaultOp: "gt", defaultValue: 100,      unit: "₹" },
  { category: "Price", label: "Low",             metric: "low",         defaultOp: "lt", defaultValue: 500,      unit: "₹" },
  { category: "Price", label: "Volume",          metric: "volume",      defaultOp: "gt", defaultValue: 500000    },
  { category: "Price", label: "1D Change %",     metric: "change_1d",   defaultOp: "gt", defaultValue: 2,        unit: "%" },
  { category: "Price", label: "5D Change %",     metric: "change_5d",   defaultOp: "gt", defaultValue: 5,        unit: "%" },
  { category: "Price", label: "20D Change %",    metric: "change_20d",  defaultOp: "gt", defaultValue: 10,       unit: "%" },
  { category: "Price", label: "52W High",        metric: "high_52w",    defaultOp: "gt", defaultValue: 100,      unit: "₹" },
  { category: "Price", label: "52W Low",         metric: "low_52w",     defaultOp: "lt", defaultValue: 500,      unit: "₹" },
  { category: "Price", label: "% from 52W High", metric: "pct_from_52w_high", defaultOp: "gt", defaultValue: -10, unit: "%", hint: "Negative = below 52W high" },
  { category: "Price", label: "% from 52W Low",  metric: "pct_from_52w_low",  defaultOp: "gt", defaultValue: 20,  unit: "%" },

  // Moving Averages
  { category: "Moving Avg", label: "SMA 5",    metric: "sma_5",    defaultOp: "gt", defaultValue: 100, unit: "₹" },
  { category: "Moving Avg", label: "SMA 10",   metric: "sma_10",   defaultOp: "gt", defaultValue: 100, unit: "₹" },
  { category: "Moving Avg", label: "SMA 20",   metric: "sma_20",   defaultOp: "gt", defaultValue: 100, unit: "₹" },
  { category: "Moving Avg", label: "SMA 50",   metric: "sma_50",   defaultOp: "gt", defaultValue: 100, unit: "₹" },
  { category: "Moving Avg", label: "SMA 100",  metric: "sma_100",  defaultOp: "gt", defaultValue: 100, unit: "₹" },
  { category: "Moving Avg", label: "SMA 200",  metric: "sma_200",  defaultOp: "gt", defaultValue: 100, unit: "₹" },
  { category: "Moving Avg", label: "EMA 9",    metric: "ema_9",    defaultOp: "gt", defaultValue: 100, unit: "₹" },
  { category: "Moving Avg", label: "EMA 12",   metric: "ema_12",   defaultOp: "gt", defaultValue: 100, unit: "₹" },
  { category: "Moving Avg", label: "EMA 20",   metric: "ema_20",   defaultOp: "gt", defaultValue: 100, unit: "₹" },
  { category: "Moving Avg", label: "EMA 26",   metric: "ema_26",   defaultOp: "gt", defaultValue: 100, unit: "₹" },
  { category: "Moving Avg", label: "EMA 50",   metric: "ema_50",   defaultOp: "gt", defaultValue: 100, unit: "₹" },
  { category: "Moving Avg", label: "EMA 100",  metric: "ema_100",  defaultOp: "gt", defaultValue: 100, unit: "₹" },
  { category: "Moving Avg", label: "EMA 200",  metric: "ema_200",  defaultOp: "gt", defaultValue: 100, unit: "₹" },
  { category: "Moving Avg", label: "WMA 20",   metric: "wma_20",   defaultOp: "gt", defaultValue: 100, unit: "₹" },
  { category: "Moving Avg", label: "VWMA 20",  metric: "vwma_20",  defaultOp: "gt", defaultValue: 100, unit: "₹" },
  { category: "Moving Avg", label: "Volume SMA 20", metric: "volume_sma_20", defaultOp: "gt", defaultValue: 500000 },
  { category: "Moving Avg", label: "Volume Ratio",  metric: "volume_ratio",  defaultOp: "gt", defaultValue: 1.5, hint: "vs 20-day avg volume" },

  // Momentum
  { category: "Momentum", label: "RSI 9",         metric: "rsi_9",      defaultOp: "lt", defaultValue: 40, hint: "<30 oversold, >70 overbought" },
  { category: "Momentum", label: "RSI 14",         metric: "rsi_14",     defaultOp: "lt", defaultValue: 40 },
  { category: "Momentum", label: "RSI 21",         metric: "rsi_21",     defaultOp: "lt", defaultValue: 40 },
  { category: "Momentum", label: "MACD",           metric: "macd",       defaultOp: "gt", defaultValue: 0 },
  { category: "Momentum", label: "MACD Signal",    metric: "macd_signal", defaultOp: "gt", defaultValue: 0 },
  { category: "Momentum", label: "MACD Histogram", metric: "macd_hist",  defaultOp: "gt", defaultValue: 0 },
  { category: "Momentum", label: "PPO %",          metric: "ppo",        defaultOp: "gt", defaultValue: 0, unit: "%" },
  { category: "Momentum", label: "TRIX 15",        metric: "trix_15",    defaultOp: "gt", defaultValue: 0 },
  { category: "Momentum", label: "Stoch %K",       metric: "stoch_k",    defaultOp: "lt", defaultValue: 20, hint: "<20 oversold, >80 overbought" },
  { category: "Momentum", label: "Stoch %D",       metric: "stoch_d",    defaultOp: "lt", defaultValue: 20 },
  { category: "Momentum", label: "Williams %R",    metric: "willr",      defaultOp: "gt", defaultValue: -50, hint: "-100 to 0; above -20 overbought" },
  { category: "Momentum", label: "CCI 20",         metric: "cci_20",     defaultOp: "gt", defaultValue: 100, hint: ">100 overbought, <-100 oversold" },
  { category: "Momentum", label: "ROC 10 %",       metric: "roc_10",     defaultOp: "gt", defaultValue: 5,   unit: "%" },
  { category: "Momentum", label: "ROC 20 %",       metric: "roc_20",     defaultOp: "gt", defaultValue: 10,  unit: "%" },
  { category: "Momentum", label: "MFI 14",         metric: "mfi_14",     defaultOp: "lt", defaultValue: 30, hint: "<20 oversold, >80 overbought" },

  // Volatility
  { category: "Volatility", label: "ATR 7",         metric: "atr_7",    defaultOp: "gt", defaultValue: 5,  unit: "₹" },
  { category: "Volatility", label: "ATR 14",        metric: "atr_14",   defaultOp: "gt", defaultValue: 5,  unit: "₹" },
  { category: "Volatility", label: "ATR 21",        metric: "atr_21",   defaultOp: "gt", defaultValue: 5,  unit: "₹" },
  { category: "Volatility", label: "BB Upper",      metric: "bb_upper", defaultOp: "lt", defaultValue: 1000, unit: "₹" },
  { category: "Volatility", label: "BB Lower",      metric: "bb_lower", defaultOp: "gt", defaultValue: 100,  unit: "₹" },
  { category: "Volatility", label: "BB Width %",    metric: "bb_width", defaultOp: "gt", defaultValue: 5,   unit: "%", hint: "High = high volatility" },
  { category: "Volatility", label: "BB %B",         metric: "bb_pct",   defaultOp: "gt", defaultValue: 0.8, hint: ">1 above upper, <0 below lower" },
  { category: "Volatility", label: "Std Dev 20",    metric: "std_20",   defaultOp: "gt", defaultValue: 10,  unit: "₹" },

  // Trend
  { category: "Trend", label: "ADX 14",    metric: "adx_14",  defaultOp: "gt", defaultValue: 25, hint: ">25 = strong trend" },
  { category: "Trend", label: "ADX DI+",   metric: "adx_pos", defaultOp: "gt", defaultValue: 20 },
  { category: "Trend", label: "ADX DI-",   metric: "adx_neg", defaultOp: "lt", defaultValue: 20 },
  { category: "Trend", label: "CMF 20",    metric: "cmf_20",  defaultOp: "gt", defaultValue: 0,  hint: ">0 = accumulation" },

  // Fundamentals
  { category: "Fundamental", label: "P/E Ratio",     metric: "pe_ratio",       defaultOp: "lt", defaultValue: 30,   unit: "×" },
  { category: "Fundamental", label: "Debt / Equity", metric: "debt_to_equity",  defaultOp: "lt", defaultValue: 1.0,  unit: "×" },
  { category: "Fundamental", label: "EPS Basic",     metric: "eps_basic",       defaultOp: "gt", defaultValue: 0,    unit: "₹" },
  { category: "Fundamental", label: "EPS Diluted",   metric: "eps_diluted",     defaultOp: "gt", defaultValue: 0,    unit: "₹" },
  { category: "Fundamental", label: "EBITDA",        metric: "ebitda",          defaultOp: "gt", defaultValue: 500,  unit: "Cr" },
  { category: "Fundamental", label: "PAT",           metric: "pat",             defaultOp: "gt", defaultValue: 100,  unit: "Cr" },
  { category: "Fundamental", label: "Revenue",       metric: "revenue",         defaultOp: "gt", defaultValue: 1000, unit: "Cr" },
  { category: "Fundamental", label: "Total Debt",    metric: "total_debt",      defaultOp: "lt", defaultValue: 10000, unit: "Cr" },
  { category: "Fundamental", label: "Total Assets",  metric: "total_assets",    defaultOp: "gt", defaultValue: 1000, unit: "Cr" },
  { category: "Fundamental", label: "Total Equity",  metric: "total_equity",    defaultOp: "gt", defaultValue: 500,  unit: "Cr" },

  // Ownership
  { category: "Ownership", label: "Promoter %",   metric: "promoter_pct",  defaultOp: "gt", defaultValue: 50, unit: "%" },
  { category: "Ownership", label: "FII %",         metric: "fii_pct",       defaultOp: "gt", defaultValue: 5,  unit: "%" },
  { category: "Ownership", label: "Delivery %",    metric: "delivery_pct",  defaultOp: "gt", defaultValue: 40, unit: "%" },
];

const CATEGORIES = Array.from(new Set(ALL_FILTERS.map((f) => f.category)));
const OP_LABELS: Record<string, string> = { gt: ">", lt: "<", gte: "≥", lte: "≤", eq: "=" };
const OPS = ["gt", "lt", "gte", "lte"] as const;

// ── Strategy presets ───────────────────────────────────────────────────────

interface PresetFilter { metric: string; label: string; why: string }

interface ScreenerPreset {
  id: string;
  label: string;
  icon: React.ElementType;
  description: string;
  conditions: ScreenerCondition[];
  filters: PresetFilter[];
}

const SCREENER_PRESETS: ScreenerPreset[] = [
  {
    id: "breakout", label: "Breakout", icon: TrendingUp,
    description: "Price near 52W high + volume surge + fresh MACD histogram cross + ADX trend confirmation",
    conditions: [
      { metric: "rsi_14",            op: "gte", value: 55 },
      { metric: "volume_ratio",      op: "gt",  value: 2 },
      { metric: "adx_14",            op: "gt",  value: 20 },
      { metric: "pct_from_52w_high", op: "gt",  value: -5 },
      { metric: "macd_hist",         op: "gt",  value: 0 },
    ],
    filters: [
      { metric: "rsi_14",            label: "RSI 14 ≥ 55",             why: "Momentum building, not yet overbought. RSI < 50 = no trend." },
      { metric: "volume_ratio",      label: "Volume Ratio > 2×",       why: "Volume ≥ 2× its own 20-day avg. Breakouts on low volume usually fail." },
      { metric: "adx_14",            label: "ADX 14 > 20",             why: "Trend strength exists. ADX < 20 = choppy range, not a real breakout." },
      { metric: "pct_from_52w_high", label: "Within 5% of 52W High",  why: "Stock is near its breakout zone. Further away = still in base." },
      { metric: "macd_hist",         label: "MACD Histogram > 0",     why: "Histogram crossing above zero = fresh momentum shift (better than MACD line which lags)." },
    ],
  },
  {
    id: "buy_dip", label: "Buy the Dip", icon: TrendingDown,
    description: "Oversold pullback within an uptrend + institutional hands holding + profitable company",
    conditions: [
      { metric: "rsi_14",            op: "lt",  value: 40 },
      { metric: "stoch_k",           op: "lt",  value: 30 },
      { metric: "pct_from_52w_low",  op: "gt",  value: 30 },
      { metric: "delivery_pct",      op: "gt",  value: 50 },
      { metric: "eps_basic",         op: "gt",  value: 0 },
    ],
    filters: [
      { metric: "rsi_14",           label: "RSI 14 < 40",           why: "Oversold territory. Not extreme panic — a healthy pullback." },
      { metric: "stoch_k",          label: "Stoch %K < 30",         why: "Second oscillator confirmation. RSI + Stoch both oversold = stronger signal." },
      { metric: "pct_from_52w_low", label: "> 30% from 52W Low",    why: "KEY: Confirms prior uptrend. If near 52W lows = collapse, not a dip." },
      { metric: "delivery_pct",     label: "Delivery % > 50%",      why: "Institutional hands not selling. High delivery on a dip = smart money holding." },
      { metric: "eps_basic",        label: "EPS > 0",               why: "Only dip in profitable companies. Loss-makers in downtrends rarely recover." },
    ],
  },
  {
    id: "volume_accum", label: "Volume Accum", icon: BarChart2,
    description: "Abnormal volume + high delivery (institutional) + money flowing in (CMF) + price holding up",
    conditions: [
      { metric: "volume_ratio",  op: "gt",  value: 2.5 },
      { metric: "delivery_pct", op: "gt",  value: 60 },
      { metric: "cmf_20",       op: "gt",  value: 0 },
      { metric: "change_1d",    op: "gt",  value: 0 },
      { metric: "rsi_14",       op: "gte", value: 40 },
    ],
    filters: [
      { metric: "volume_ratio",  label: "Volume Ratio > 2.5×",  why: "2.5× own average = significant institutional event. Not just a busy day." },
      { metric: "delivery_pct", label: "Delivery % > 60%",      why: "Majority is delivery-based = institutional buying, not intraday noise." },
      { metric: "cmf_20",       label: "CMF 20 > 0",            why: "Chaikin Money Flow positive = money flowing in. Separates buying from distribution." },
      { metric: "change_1d",    label: "1D Change > 0%",        why: "Volume WITH price up = accumulation. Volume with price down = distribution (sell)." },
      { metric: "rsi_14",       label: "RSI 14 ≥ 40",           why: "Not deeply oversold — accumulation in a base or early uptrend phase." },
    ],
  },
  {
    id: "mean_reversal", label: "Mean Reversal", icon: RefreshCw,
    description: "Statistical extreme across 3 oscillators + weak trend (ADX) — strong downtrends don't revert",
    conditions: [
      { metric: "rsi_14",           op: "lt", value: 28 },
      { metric: "bb_pct",           op: "lt", value: 0.15 },
      { metric: "stoch_k",          op: "lt", value: 20 },
      { metric: "pct_from_52w_low", op: "gt", value: 20 },
      { metric: "adx_14",           op: "lt", value: 25 },
    ],
    filters: [
      { metric: "rsi_14",           label: "RSI 14 < 28",              why: "Deeply oversold. Below 30 = historically high reversal probability on NSE." },
      { metric: "bb_pct",           label: "BB %B < 0.15",             why: "Price near/below lower Bollinger Band = statistical outlier. Mean reversion expected." },
      { metric: "stoch_k",          label: "Stoch %K < 20",            why: "Third signal. RSI + Stoch + BB all oversold = strong mean reversion setup." },
      { metric: "pct_from_52w_low", label: "> 20% from 52W Low",       why: "Had prior strength. If at 52W lows WITH all oversold = downtrend, not reversal." },
      { metric: "adx_14",           label: "ADX 14 < 25",              why: "CRITICAL: Weak trend only. Strong downtrends (ADX>25) continue — they don't revert." },
    ],
  },
  {
    id: "quality_value", label: "Quality & Value", icon: Star,
    description: "Low PE + conservative debt + real earnings + promoter-backed + market price agreeing",
    conditions: [
      { metric: "pe_ratio",       op: "lt", value: 18 },
      { metric: "debt_to_equity", op: "lt", value: 0.4 },
      { metric: "eps_basic",      op: "gt", value: 5 },
      { metric: "promoter_pct",   op: "gt", value: 55 },
      { metric: "roc_20",         op: "gt", value: 5 },
    ],
    filters: [
      { metric: "pe_ratio",       label: "P/E < 18",          why: "Genuinely cheap — below market avg PE of ~22. Not just sector-relative cheap." },
      { metric: "debt_to_equity", label: "D/E < 0.4",         why: "Conservative balance sheet. High debt destroys quality companies in rate cycles." },
      { metric: "eps_basic",      label: "EPS > ₹5",          why: "Meaningfully profitable. EPS > 0 is too easy — ₹5+ means real earnings power." },
      { metric: "promoter_pct",   label: "Promoter > 55%",    why: "Strong alignment. >55% promoters rarely dilute aggressively and have skin in the game." },
      { metric: "roc_20",         label: "ROC 20D > 5%",      why: "Market agreeing — price up 5%+ in 20 days. Value without price action = value trap." },
    ],
  },
];

// ── Indicator search dropdown ───────────────────────────────────────────────

function IndicatorSearch({ onAdd }: { onAdd: (c: ScreenerCondition) => void }) {
  const [q, setQ] = useState("");
  const [cursor, setCursor] = useState(0);
  const [op, setOp] = useState<string>("gt");
  const [val, setVal] = useState("100");
  const [selectedFilter, setSelectedFilter] = useState<FilterDef>(ALL_FILTERS[0]);
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const filtered = q.length === 0
    ? ALL_FILTERS
    : ALL_FILTERS.filter(
        (f) =>
          f.label.toLowerCase().includes(q.toLowerCase()) ||
          f.metric.toLowerCase().includes(q.toLowerCase()) ||
          f.category.toLowerCase().includes(q.toLowerCase())
      );

  useEffect(() => { setCursor(0); }, [q]);

  useEffect(() => {
    if (cursor >= 0 && listRef.current) {
      const item = listRef.current.children[cursor] as HTMLElement;
      item?.scrollIntoView({ block: "nearest" });
    }
  }, [cursor]);

  const pick = (f: FilterDef) => {
    setSelectedFilter(f);
    setOp(f.defaultOp);
    setVal(String(f.defaultValue));
    setQ("");
    setOpen(false);
  };

  const add = () => {
    const v = parseFloat(val);
    if (isNaN(v)) return;
    onAdd({ metric: selectedFilter.metric, op, value: v });
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open) { if (e.key === "ArrowDown") { setOpen(true); return; } }
    if (e.key === "ArrowDown") { e.preventDefault(); setCursor((c) => Math.min(c + 1, filtered.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); if (filtered[cursor]) pick(filtered[cursor]); }
    else if (e.key === "Escape") { setOpen(false); }
  };

  // Group by category for display
  const grouped: { cat: string; items: FilterDef[] }[] = [];
  let lastCat = "";
  let flatIdx = 0;
  const flatItems: { f: FilterDef; idx: number }[] = [];
  for (const f of filtered) {
    flatItems.push({ f, idx: flatIdx++ });
  }

  const catGroups: Record<string, FilterDef[]> = {};
  for (const f of filtered) {
    if (!catGroups[f.category]) catGroups[f.category] = [];
    catGroups[f.category].push(f);
  }

  return (
    <div className="flex flex-col gap-2 pt-2 border-t border-slate-100 mt-2">
      <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-0.5">Add Indicator</div>

      {/* Search + dropdown */}
      <div className="relative">
        <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 focus-within:border-blue-400 focus-within:bg-white transition-all">
          <Search size={11} className="text-slate-400 shrink-0" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => { setQ(e.target.value); setOpen(true); }}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
            onKeyDown={onKeyDown}
            placeholder={selectedFilter.label}
            className="flex-1 text-xs bg-transparent outline-none text-slate-700 placeholder-slate-400"
          />
          {q && <button onMouseDown={() => { setQ(""); inputRef.current?.focus(); }} className="text-slate-300 hover:text-slate-500"><X size={10} /></button>}
        </div>
        {open && (
          <ul
            ref={listRef}
            className="absolute top-full mt-1 left-0 right-0 z-50 bg-white border border-slate-200 rounded-xl shadow-xl max-h-56 overflow-y-auto"
          >
            {filtered.length === 0 ? (
              <li className="px-3 py-2 text-xs text-slate-400">No indicators found</li>
            ) : (
              (() => {
                let flatI = 0;
                return CATEGORIES.filter((cat) => catGroups[cat]?.length).map((cat) => (
                  <div key={cat}>
                    <div className="px-2 py-0.5 text-[9px] font-bold text-slate-400 uppercase tracking-widest bg-slate-50 sticky top-0">{cat}</div>
                    {catGroups[cat].map((f) => {
                      const i = flatI++;
                      return (
                        <li key={f.metric}>
                          <button
                            onMouseDown={() => pick(f)}
                            className={`w-full text-left px-3 py-1.5 text-xs flex items-center justify-between gap-2 transition-colors ${i === cursor ? "bg-blue-50 text-blue-700" : "hover:bg-slate-50 text-slate-700"}`}
                          >
                            <span className="font-medium">{f.label}</span>
                            <span className="text-[10px] text-slate-400 font-mono shrink-0">{f.metric}</span>
                          </button>
                        </li>
                      );
                    })}
                  </div>
                ));
              })()
            )}
          </ul>
        )}
      </div>

      {/* Op + value row */}
      <div className="flex gap-1.5 items-center">
        <select value={op} onChange={(e) => setOp(e.target.value)}
          className="text-xs px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:border-blue-400 w-14 shrink-0">
          {OPS.map((o) => <option key={o} value={o}>{OP_LABELS[o]}</option>)}
        </select>
        <input
          type="number" value={val}
          onChange={(e) => setVal(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          className="flex-1 min-w-0 text-xs px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:border-blue-400"
        />
        {selectedFilter.unit && <span className="text-xs text-slate-400 shrink-0">{selectedFilter.unit}</span>}
      </div>
      {selectedFilter.hint && <div className="text-[10px] text-slate-400 leading-tight">{selectedFilter.hint}</div>}
      <button onClick={add}
        className="flex items-center justify-center gap-1 w-full py-1.5 text-xs bg-slate-100 hover:bg-blue-50 text-slate-600 hover:text-blue-600 rounded-lg transition-colors font-medium border border-slate-200">
        <Plus size={11} /> Add Filter
      </button>
    </div>
  );
}

// ── Active condition chip ──────────────────────────────────────────────────

function ConditionChip({ c, idx, onRemove }: { c: ScreenerCondition; idx: number; onRemove: () => void }) {
  const def = ALL_FILTERS.find((f) => f.metric === c.metric);
  const label = def?.label ?? c.metric;
  const unit  = def?.unit ?? "";
  return (
    <div className="flex items-center justify-between gap-2 px-2 py-1 bg-blue-50 border border-blue-200 rounded-lg text-xs">
      <span className="text-blue-700 font-medium truncate">
        {label} {OP_LABELS[c.op] ?? c.op} {c.value}{unit}
      </span>
      <button onClick={onRemove} className="text-blue-300 hover:text-red-400 shrink-0 transition-colors">
        <X size={10} />
      </button>
    </div>
  );
}

// ── Save custom screener form ──────────────────────────────────────────────

function SaveScreenerForm({ onSaved }: { onSaved: () => void }) {
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const { saveScreener } = useScreenerStore();

  const save = async () => {
    const n = name.trim();
    if (!n) return;
    setSaving(true);
    try {
      await saveScreener(n);
      setDone(true);
      setName("");
      setTimeout(() => { setDone(false); onSaved(); }, 1200);
    } catch {}
    finally { setSaving(false); }
  };

  if (done) return <div className="flex items-center gap-1.5 text-emerald-600 text-xs font-medium"><CheckCircle2 size={12} /> Saved!</div>;

  return (
    <div className="flex items-center gap-1.5">
      <input
        value={name} onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && save()}
        placeholder="Screener name…"
        className="flex-1 min-w-0 bg-slate-100 text-xs rounded-lg px-2.5 py-1.5 outline-none focus:ring-2 focus:ring-blue-500 border border-transparent focus:border-blue-300"
      />
      <button onClick={save} disabled={saving || !name.trim()}
        className="flex items-center gap-1 px-2.5 py-1.5 bg-blue-500 text-white text-xs rounded-lg hover:bg-blue-600 disabled:opacity-40 transition-colors font-medium shrink-0">
        <BookmarkPlus size={11} /> {saving ? "…" : "Save"}
      </button>
    </div>
  );
}

// ── Saved screeners panel ─────────────────────────────────────────────────

function SavedScreenersPanel({
  onLoad, onActiveChange,
}: {
  onLoad: (conditions: ScreenerCondition[], name: string) => void;
  onActiveChange: (name: string | null) => void;
}) {
  const { savedScreeners, deleteSavedScreener } = useScreenerStore();
  const [expanded, setExpanded] = useState<number | null>(null);

  if (savedScreeners.length === 0) return null;

  return (
    <div>
      <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5">My Screeners</div>
      <div className="flex flex-col gap-1">
        {savedScreeners.map((s) => (
          <div key={s.id} className="border border-slate-200 rounded-lg overflow-hidden">
            <div className="flex items-center gap-1.5 px-2.5 py-1.5 bg-slate-50">
              <button
                onClick={() => setExpanded(expanded === s.id ? null : s.id)}
                className="flex-1 flex items-center gap-1.5 text-left min-w-0"
              >
                <ChevronDown size={11} className={`text-slate-400 shrink-0 transition-transform ${expanded === s.id ? "rotate-180" : ""}`} />
                <span className="text-xs font-semibold text-slate-700 truncate">{s.name}</span>
                <span className="text-[10px] text-slate-400 shrink-0">{s.conditions.length} filters</span>
              </button>
              <button onClick={() => { onLoad(s.conditions, s.name); onActiveChange(s.name); }}
                className="text-xs px-2 py-0.5 bg-blue-500 text-white rounded-md hover:bg-blue-600 transition-colors font-medium shrink-0">
                Load
              </button>
              <button onClick={() => deleteSavedScreener(s.id)} className="text-slate-300 hover:text-red-400 transition-colors shrink-0">
                <Trash2 size={11} />
              </button>
            </div>
            {expanded === s.id && (
              <div className="px-2.5 py-1.5 bg-white border-t border-slate-100 flex flex-col gap-0.5">
                {s.conditions.map((c, i) => {
                  const def = ALL_FILTERS.find((f) => f.metric === c.metric);
                  return (
                    <span key={i} className="text-[10px] text-slate-500">
                      {def?.label ?? c.metric} {OP_LABELS[c.op]} {c.value}{def?.unit ?? ""}
                    </span>
                  );
                })}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

import React from "react";

export default function ScreenerFilters() {
  const {
    conditions, addCondition, removeCondition, clearConditions, setConditions,
    runScreen, loading, loadSavedScreeners,
  } = useScreenerStore();

  const [activePreset, setActivePreset] = useState<string | null>(null);
  const [showSaveForm, setShowSaveForm] = useState(false);

  const applyPreset = (preset: ScreenerPreset) => {
    if (activePreset === preset.id) {
      clearConditions();
      setActivePreset(null);
    } else {
      setConditions(preset.conditions);
      setActivePreset(preset.id);
    }
  };

  const handleAddCondition = (c: ScreenerCondition) => {
    addCondition(c);
    setActivePreset(null);
  };

  const handleRemoveCondition = (idx: number) => {
    removeCondition(idx);
    setActivePreset(null);
  };

  const handleClearConditions = () => {
    clearConditions();
    setActivePreset(null);
  };

  const activePresetDef = SCREENER_PRESETS.find((p) => p.id === activePreset);

  return (
    <div className="flex flex-col gap-3">

      {/* ── Strategy presets ── */}
      <div>
        <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Strategy Presets</div>
        <div className="flex flex-col gap-1">
          {SCREENER_PRESETS.map((preset) => {
            const isActive = activePreset === preset.id;
            const Icon = preset.icon;
            return (
              <button key={preset.id} onClick={() => applyPreset(preset)}
                className={`flex items-center gap-2 text-left px-2.5 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                  isActive ? "bg-blue-500 text-white border-blue-500 shadow-sm" : "bg-white text-slate-600 border-slate-200 hover:border-blue-300 hover:bg-blue-50"
                }`}>
                <Icon size={12} className="shrink-0" />
                {preset.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="border-t border-slate-100" />

      {/* ── Saved screeners ── */}
      <SavedScreenersPanel
        onLoad={(conds) => setConditions(conds)}
        onActiveChange={() => setActivePreset(null)}
      />

      {/* ── Active conditions ── */}
      {conditions.length > 0 && (
        <div className="flex flex-col gap-1">
          <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Active Filters</div>
          {conditions.map((c, i) => (
            <ConditionChip key={i} c={c} idx={i} onRemove={() => handleRemoveCondition(i)} />
          ))}
          <div className="flex items-center justify-between mt-0.5">
            <button onClick={handleClearConditions} className="text-[10px] text-slate-400 hover:text-red-400 transition-colors">
              Clear all
            </button>
            {!showSaveForm && (
              <button onClick={() => setShowSaveForm(true)}
                className="flex items-center gap-1 text-[10px] text-blue-500 hover:text-blue-600 font-medium transition-colors">
                <BookmarkPlus size={10} /> Save as screener
              </button>
            )}
          </div>
          {showSaveForm && (
            <SaveScreenerForm onSaved={() => { setShowSaveForm(false); loadSavedScreeners(); }} />
          )}
        </div>
      )}

      {/* ── Indicator search + add ── */}
      <IndicatorSearch onAdd={handleAddCondition} />

      {/* ── Run ── */}
      <button onClick={runScreen} disabled={loading}
        className="flex items-center justify-center gap-1.5 w-full py-2 bg-blue-500 hover:bg-blue-600 disabled:opacity-40 text-white text-sm rounded-lg font-medium transition-colors mt-1">
        <Play size={12} />
        {loading ? "Running…" : "Run Screen"}
      </button>

      {conditions.length === 0 && (
        <div className="text-[10px] text-slate-400 text-center">
          No filters → returns all synced stocks
        </div>
      )}
    </div>
  );
}
