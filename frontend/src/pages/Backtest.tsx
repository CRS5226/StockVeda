import { useEffect, useRef, useState, useCallback } from "react";
import { Search, X, ChevronDown, Play, AlertCircle, Plus, Trash2 } from "lucide-react";
import { api, ConditionRow } from "../lib/api";
import { useBacktestStore } from "../store/useBacktestStore";
import BacktestChart from "../components/BacktestChart";

// ── helpers ────────────────────────────────────────────────────────────────

function fmt(n: number, dec = 0) {
  return n.toLocaleString("en-IN", { maximumFractionDigits: dec });
}

function pnlClass(n: number) {
  return n >= 0 ? "text-emerald-600" : "text-red-500";
}

// ── Quick-start presets ────────────────────────────────────────────────────

const PRESETS: { label: string; conditions: ConditionRow[] }[] = [
  {
    label: "MACD Cross",
    conditions: [{ left: "macd", operator: "crosses_above", right: "macd_signal" }],
  },
  {
    label: "RSI Bounce",
    conditions: [{ left: "rsi_14", operator: "crosses_above", right: "30" }],
  },
  {
    label: "Golden Cross",
    conditions: [{ left: "sma_50", operator: "crosses_above", right: "sma_200" }],
  },
  {
    label: "EMA Cross",
    conditions: [{ left: "ema_20", operator: "crosses_above", right: "ema_50" }],
  },
  {
    label: "Price > SMA50",
    conditions: [{ left: "close", operator: "crosses_above", right: "sma_50" }],
  },
  {
    label: "52W Breakout",
    conditions: [
      { left: "close", operator: "crosses_above", right: "sma_200" },
      { left: "rsi_14", operator: "above", right: "50" },
    ],
  },
];

const INDICATOR_LABELS: Record<string, string> = {
  close: "Close Price", open: "Open", high: "High", low: "Low", volume: "Volume",
  rsi_14: "RSI (14)", sma_20: "SMA 20", sma_50: "SMA 50", sma_200: "SMA 200",
  ema_20: "EMA 20", ema_50: "EMA 50",
  macd: "MACD", macd_signal: "MACD Signal", macd_hist: "MACD Histogram",
  bb_upper: "BB Upper", bb_lower: "BB Lower", atr_14: "ATR (14)",
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

export default function Backtest() {
  const store = useBacktestStore();
  const {
    pickedSymbols, indicators, operators, strategy,
    v2Results, v2Loading, v2Error, activeSymbol,
    addSymbol, removeSymbol, clearSymbols,
    setStrategy, runBacktestV2, setActiveSymbol,
  } = store;

  const [showExitConditions, setShowExitConditions] = useState(false);

  useEffect(() => {
    store.loadEntryConditions();
    store.loadWatchlists();
    store.loadIndicators();
  }, []);

  const canRun = pickedSymbols.length > 0 && strategy.entry_conditions.length > 0 && !v2Loading;

  const symbolsWithResults = v2Results ? Object.keys(v2Results.per_symbol) : [];
  const activeData = activeSymbol && v2Results?.per_symbol[activeSymbol];

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
          <>
            <div className="flex flex-wrap gap-1.5">
              {pickedSymbols.map((sym) => (
                <span key={sym} className="inline-flex items-center gap-1 px-2 py-0.5 bg-blue-50 border border-blue-200 text-blue-700 text-xs font-semibold rounded-full">
                  {sym}
                  <button onClick={() => removeSymbol(sym)} className="hover:text-red-500 transition-colors ml-0.5"><X size={10} /></button>
                </span>
              ))}
            </div>
            <div className="mt-2 text-xs text-slate-500">{pickedSymbols.length} stock{pickedSymbols.length !== 1 ? "s" : ""} selected</div>
          </>
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

        {/* Quick-start presets */}
        <div className="mb-4">
          <div className="text-xs text-slate-400 mb-2 font-medium">Quick-start presets</div>
          <div className="flex flex-wrap gap-1.5">
            {PRESETS.map((p) => (
              <button key={p.label}
                onClick={() => setStrategy({ entry_conditions: p.conditions })}
                className="px-2.5 py-1 text-xs bg-slate-100 hover:bg-blue-50 hover:text-blue-700 hover:border-blue-300 border border-slate-200 rounded-full transition-all font-medium">
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {/* Entry conditions */}
        <div className="mb-4">
          <div className="text-xs text-slate-500 font-semibold mb-2 uppercase tracking-wide">Entry Conditions</div>
          {indicators.length > 0 ? (
            <ConditionBuilder
              conditions={strategy.entry_conditions}
              onChange={(rows) => setStrategy({ entry_conditions: rows })}
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

        <div className="grid grid-cols-2 gap-3 mb-4">
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
        </div>

        <button onClick={runBacktestV2} disabled={!canRun}
          className="flex items-center gap-2 px-5 py-2 bg-blue-500 hover:bg-blue-600 disabled:opacity-40 text-white text-sm font-medium rounded-lg transition-colors">
          <Play size={13} className={v2Loading ? "animate-pulse" : ""} />
          {v2Loading ? `Running on ${pickedSymbols.length} stocks…` : `Run Backtest on ${pickedSymbols.length} stock${pickedSymbols.length !== 1 ? "s" : ""}`}
        </button>

        {v2Error && (
          <div className="mt-3 flex items-center gap-2 text-sm text-red-500">
            <AlertCircle size={14} /> {v2Error.replace("Error: ", "")}
          </div>
        )}
      </section>

      {/* ── Section 3: Results — left panel + right panel ── */}
      {v2Results && (
        <section className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
          <div className="flex" style={{ minHeight: 520 }}>

            {/* Left panel: stock list */}
            <div className="w-52 shrink-0 border-r border-slate-100 flex flex-col">
              <div className="p-3 border-b border-slate-100 bg-slate-50/60">
                <div className="text-[10px] text-slate-400 font-semibold uppercase tracking-wide mb-1">Combined Results</div>
                <div className={`text-base font-bold ${pnlClass(v2Results.aggregate.total_pnl)}`}>
                  {v2Results.aggregate.total_pnl >= 0 ? "+" : ""}₹{fmt(v2Results.aggregate.total_pnl)}
                </div>
                <div className="flex gap-3 mt-1 text-[10px] text-slate-400">
                  <span>{v2Results.aggregate.total_trades} trades</span>
                  <span className={v2Results.aggregate.win_rate_pct >= 50 ? "text-emerald-500" : "text-red-400"}>
                    {v2Results.aggregate.win_rate_pct}% win
                  </span>
                </div>
              </div>

              <div className="overflow-y-auto flex-1">
                {symbolsWithResults.map((sym) => {
                  const symStats = v2Results.per_symbol[sym].stats;
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
