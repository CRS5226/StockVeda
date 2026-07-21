import { create } from "zustand";
import { api, BacktestResult, Strategy, BacktestV2Response, BacktestSymbolResult, EntryCondition, Watchlist, ConditionRow, CandleStat, SyncJob, MatrixResponse, SweepDim, GridSearchResult, MlModelInfo, MlResult, QuantAlgoId, QuantAlgoMeta, QuantSignalResult } from "../lib/api";

// ── V1 (kept intact) ───────────────────────────────────────────────────────

interface BacktestParams {
  symbol: string;
  from_date: string;
  to_date: string;
  initial_capital: number;
  entry_col: string;
  entry_op: string;
  entry_threshold_col: string;
  exit_bars?: number;
  exit_col?: string;
  exit_op?: string;
  exit_threshold_col?: string;
  position_pct: number;
}

// ── V2 strategy shape ──────────────────────────────────────────────────────

interface StrategyV2 {
  entry_conditions: ConditionRow[];
  exit_conditions: ConditionRow[];
  target_pct: number;
  sl_pct: number;
  max_bars: number;
  from_date: string;
  to_date: string;
  capital_per_trade: number;
  timeframe: "1D" | "1W";
  // "cash" = stock_ohlcv (default). "futures" = continuous roll-adjusted near-month
  // futures series (Phase 2) — lets RSI/MACD/SMA-style conditions run on futures
  // price action instead of the cash price.
  data_source: "cash" | "futures";
}

// ── Options straddle/strangle mode ─────────────────────────────────────────

export interface StraddleConfig {
  symbol: string;
  from_date: string;
  to_date: string;
  strategy: "short_straddle" | "long_straddle" | "short_strangle" | "long_strangle";
  strangle_width_pct: number;
  entry_dte: number;
  target_pct: number;
  sl_pct: number;
  force_exit_dte: number;
  capital_per_trade: number;
  data_source: "cash" | "futures";
}

export type StraddleResult = Awaited<ReturnType<typeof api.runStraddleBacktest>>;

// ── Options spreads mode (bull call / bear put / iron condor) ──────────────

export interface SpreadConfig {
  symbol: string;
  from_date: string;
  to_date: string;
  strategy: "bull_call_spread" | "bear_put_spread" | "iron_condor";
  long_offset_pct: number;
  short_offset_pct: number;
  condor_call_short_pct: number;
  condor_call_long_pct: number;
  condor_put_short_pct: number;
  condor_put_long_pct: number;
  entry_dte: number;
  target_pct: number;
  sl_pct: number;
  force_exit_dte: number;
  capital_per_trade: number;
  data_source: "cash" | "futures";
}

export type SpreadResult = Awaited<ReturnType<typeof api.runSpreadBacktest>>;

// ── Opening Range Breakout (ORB) mode ───────────────────────────────────────

export interface ORBConfig {
  symbol: string;
  interval: "1m" | "5m" | "15m" | "30m" | "60m";
  from_date: string;
  to_date: string;
  or_minutes: number;
  direction: "long_only" | "short_only" | "both";
  target_pct: number;
  sl_pct: number;
  force_exit_time: string;
  capital_per_trade: number;
}

export type ORBResult = Awaited<ReturnType<typeof api.runOrbBacktest>>;

// ── Grid Search mode ─────────────────────────────────────────────────────────

export interface GridConfig {
  entry_conditions: ConditionRow[];
  sweep_dims: SweepDim[];
  train_ratio: number;   // 0.5–0.9
  top_n: number;
  target_pct: number;
  sl_pct: number;
  max_bars: number;
}

// ── ML Models mode ───────────────────────────────────────────────────────────

export interface MlConfig {
  entry_conditions: ConditionRow[];
  sample_mode: "entry_signals" | "all_bars";
  models: string[];
  prob_threshold: number;   // 0.5–0.95
  train_ratio: number;
  target_pct: number;
  sl_pct: number;
  max_bars: number;
}

// ── Quant Signals mode ───────────────────────────────────────────────────────

export interface QuantConfig {
  algo: QuantAlgoId;
  account_capital: number;
  data_source: "cash" | "futures";
}

// 5 perceptually distinct colours — blue, orange, teal, violet, rose
export const ALGO_COLORS = ["#3b82f6", "#f97316", "#14b8a6", "#8b5cf6", "#f43f5e"];

export interface AlgoSlot {
  id: string;
  label: string;
  color: string;
  strategy: StrategyV2;
  results: BacktestSymbolResult | null;
  loading: boolean;
  error: string | null;
}

export interface SavedRun {
  id: string;
  label: string;
  timeframe: string;
  results: BacktestV2Response;
}

const TWO_YEARS_AGO = new Date(Date.now() - 2 * 365 * 86400_000).toISOString().slice(0, 10);
const TODAY = new Date().toISOString().slice(0, 10);

const DEFAULT_STRADDLE: StraddleConfig = {
  symbol: "NIFTY",
  from_date: TWO_YEARS_AGO,
  to_date: TODAY,
  strategy: "short_straddle",
  strangle_width_pct: 2,
  entry_dte: 7,
  target_pct: 30,
  sl_pct: 50,
  force_exit_dte: 0,
  capital_per_trade: 50000,
  data_source: "cash",
};

const DEFAULT_SPREAD: SpreadConfig = {
  symbol: "NIFTY",
  from_date: TWO_YEARS_AGO,
  to_date: TODAY,
  strategy: "bull_call_spread",
  long_offset_pct: 0,
  short_offset_pct: 3,
  condor_call_short_pct: 3,
  condor_call_long_pct: 6,
  condor_put_short_pct: 3,
  condor_put_long_pct: 6,
  entry_dte: 20,
  target_pct: 50,
  sl_pct: 100,
  force_exit_dte: 1,
  capital_per_trade: 50000,
  data_source: "cash",
};

const DEFAULT_ORB: ORBConfig = {
  symbol: "RELIANCE",
  interval: "5m",
  from_date: new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10),
  to_date: TODAY,
  or_minutes: 15,
  direction: "long_only",
  target_pct: 1.0,
  sl_pct: 0.5,
  force_exit_time: "15:20",
  capital_per_trade: 50000,
};

const DEFAULT_STRATEGY: StrategyV2 = {
  entry_conditions: [{ left: "macd", operator: "crosses_above", right: "macd_signal" }],
  exit_conditions: [],
  target_pct: 15,
  sl_pct: 7,
  max_bars: 30,
  from_date: TWO_YEARS_AGO,
  to_date: TODAY,
  capital_per_trade: 10000,
  timeframe: "1D",
  data_source: "cash",
};

const DEFAULT_GRID: GridConfig = {
  entry_conditions: [{ left: "rsi_14", operator: "crosses_above", right: "30" }],
  sweep_dims: [{ kind: "threshold", condition_index: 0, column: "", values: [25, 30, 35, 40] }],
  train_ratio: 0.7,
  top_n: 20,
  target_pct: 15,
  sl_pct: 7,
  max_bars: 30,
};

// Balanced barriers (6%/4%/25) keep the triple-barrier labels from collapsing to
// all-loss the way 15%/7%/30 does — a more useful default for the ML demo.
const DEFAULT_ML: MlConfig = {
  entry_conditions: [{ left: "rsi_14", operator: "above", right: "50" }],
  sample_mode: "entry_signals",
  models: ["logreg", "rf", "xgb"],
  prob_threshold: 0.6,
  train_ratio: 0.7,
  target_pct: 6,
  sl_pct: 4,
  max_bars: 25,
};

const DEFAULT_QUANT: QuantConfig = {
  algo: "long_pullback",
  account_capital: 1_000_000,
  data_source: "cash",
};

// ── Combined store ─────────────────────────────────────────────────────────

interface BacktestState {
  // v1
  params: BacktestParams;
  results: BacktestResult | null;
  strategies: Strategy[];
  loading: boolean;
  error: string | null;
  setParams: (p: Partial<BacktestParams>) => void;
  applyStrategy: (s: Strategy) => void;
  runBacktest: () => Promise<void>;
  loadStrategies: () => Promise<void>;

  // v2
  pickedSymbols: string[];
  watchlists: Watchlist[];
  entryConditions: EntryCondition[];
  indicators: string[];
  operators: string[];
  strategy: StrategyV2;
  v2Results: BacktestV2Response | null;
  v2Loading: boolean;
  v2Error: string | null;
  activeSymbol: string | null;
  candleStats: CandleStat[];
  syncJob: SyncJob | null;
  syncJobId: string | null;
  syncLoading: boolean;
  savedRuns: SavedRun[];

  // multi-algo mode
  mode: "multi_stock" | "multi_algo" | "matrix" | "options" | "orb" | "grid" | "ml" | "quant";
  algoSlots: AlgoSlot[];
  multiAlgoSymbol: string;
  activeAlgoId: string | null;
  setMode: (mode: "multi_stock" | "multi_algo" | "matrix" | "options" | "orb" | "grid" | "ml" | "quant") => void;
  addAlgoSlot: () => void;
  addCustomAlgoSlot: () => void;
  removeAlgoSlot: (id: string) => void;
  updateAlgoSlot: (id: string, patch: Partial<Pick<AlgoSlot, "label" | "strategy">>) => void;
  setActiveAlgo: (id: string) => void;
  setMultiAlgoSymbol: (sym: string) => void;
  runAllAlgos: () => Promise<void>;

  // matrix mode
  matrixAlgos: AlgoSlot[];
  matrixResults: MatrixResponse | null;
  matrixLoading: boolean;
  matrixError: string | null;
  matrixProgress: { done: number; total: number } | null;
  addMatrixAlgo: () => void;
  removeMatrixAlgo: (id: string) => void;
  updateMatrixAlgo: (id: string, patch: Partial<Pick<AlgoSlot, "label" | "strategy">>) => void;
  runMatrix: () => Promise<void>;

  // options straddle/strangle mode
  straddle: StraddleConfig;
  straddleResults: StraddleResult | null;
  straddleLoading: boolean;
  straddleError: string | null;
  setStraddle: (p: Partial<StraddleConfig>) => void;
  runStraddle: () => Promise<void>;

  // options spreads mode
  optionsFamily: "straddle" | "spread";
  setOptionsFamily: (f: "straddle" | "spread") => void;
  spread: SpreadConfig;
  spreadResults: SpreadResult | null;
  spreadLoading: boolean;
  spreadError: string | null;
  setSpread: (p: Partial<SpreadConfig>) => void;
  runSpread: () => Promise<void>;

  // ORB mode
  orb: ORBConfig;
  orbResults: ORBResult | null;
  orbLoading: boolean;
  orbError: string | null;
  setOrb: (p: Partial<ORBConfig>) => void;
  runOrb: () => Promise<void>;

  // Grid Search mode
  grid: GridConfig;
  gridResults: GridSearchResult | null;
  gridLoading: boolean;
  gridError: string | null;
  gridProgress: { phase: string; done: number; total: number } | null;
  gridSweepables: { period_columns: string[]; max_combos: number } | null;
  setGrid: (p: Partial<GridConfig>) => void;
  loadGridSweepables: () => Promise<void>;
  runGridSearch: () => Promise<void>;

  // ML Models mode
  ml: MlConfig;
  mlResults: MlResult | null;
  mlLoading: boolean;
  mlError: string | null;
  mlProgress: { phase: string; model?: string; done: number; total: number } | null;
  mlModelList: MlModelInfo[];
  setMl: (p: Partial<MlConfig>) => void;
  loadMlModels: () => Promise<void>;
  runMl: () => Promise<void>;

  // Quant Signals mode
  quant: QuantConfig;
  quantResults: QuantSignalResult | null;
  quantLoading: boolean;
  quantError: string | null;
  quantProgress: { phase: string; done: number; total: number; symbol?: string } | null;
  quantAlgoMeta: QuantAlgoMeta[];
  setQuant: (p: Partial<QuantConfig>) => void;
  loadQuantAlgoMeta: () => Promise<void>;
  runQuantSignals: () => Promise<void>;

  addSymbol: (sym: string) => void;
  removeSymbol: (sym: string) => void;
  loadWatchlistSymbols: (symbols: string[]) => void;
  clearSymbols: () => void;
  setStrategy: (p: Partial<StrategyV2>) => void;
  runBacktestV2: () => Promise<void>;
  loadEntryConditions: () => Promise<void>;
  loadIndicators: () => Promise<void>;
  loadWatchlists: () => Promise<void>;
  setActiveSymbol: (sym: string) => void;
  fetchCandleStats: () => Promise<void>;
  startDataSync: (candle_days: number) => Promise<void>;
  saveCurrentRun: (label: string) => void;
  clearSavedRuns: () => void;
}

const DEFAULT_PARAMS: BacktestParams = {
  symbol: "",
  from_date: TWO_YEARS_AGO,
  to_date: TODAY,
  initial_capital: 100000,
  entry_col: "close",
  entry_op: "cross_above",
  entry_threshold_col: "sma_50",
  exit_bars: 20,
  position_pct: 1.0,
};

export const useBacktestStore = create<BacktestState>((set, get) => ({
  // ── V1 ────────────────────────────────────────────────────────────────────
  params: DEFAULT_PARAMS,
  results: null,
  strategies: [],
  loading: false,
  error: null,

  setParams: (p) => set((s) => ({ params: { ...s.params, ...p } })),

  applyStrategy: (s) =>
    set((st) => ({
      params: {
        ...st.params,
        entry_col: s.params.entry_col,
        entry_op: s.params.entry_op,
        entry_threshold_col: s.params.entry_threshold_col,
        exit_bars: s.params.exit_bars,
        exit_col: s.params.exit_col,
        exit_op: s.params.exit_op,
        exit_threshold_col: s.params.exit_threshold_col,
      },
    })),

  runBacktest: async () => {
    const { params } = get();
    if (!params.symbol) return;
    set({ loading: true, error: null, results: null });
    try {
      const results = await api.runBacktest(params);
      set({ results, loading: false });
    } catch (e) {
      set({ loading: false, error: String(e) });
    }
  },

  loadStrategies: async () => {
    try {
      const strategies = await api.getBacktestStrategies();
      set({ strategies });
    } catch {}
  },

  // ── V2 ────────────────────────────────────────────────────────────────────
  pickedSymbols: [],
  watchlists: [],
  entryConditions: [],
  indicators: [],
  operators: [],
  strategy: DEFAULT_STRATEGY,
  v2Results: null,
  v2Loading: false,
  v2Error: null,
  activeSymbol: null,
  candleStats: [],
  syncJob: null,
  syncJobId: null,
  syncLoading: false,
  savedRuns: [],

  // multi-algo mode
  mode: "multi_stock",
  multiAlgoSymbol: "",
  activeAlgoId: null,
  algoSlots: [
    { id: "1", label: "Algo 1", color: ALGO_COLORS[0], strategy: { ...DEFAULT_STRATEGY }, results: null, loading: false, error: null },
    { id: "2", label: "Algo 2", color: ALGO_COLORS[1], strategy: { ...DEFAULT_STRATEGY, entry_conditions: [{ left: "rsi_14", operator: "crosses_above", right: "50" }] }, results: null, loading: false, error: null },
  ],

  // matrix mode
  matrixAlgos: [
    { id: "m1", label: "MACD Cross", color: ALGO_COLORS[0], strategy: { ...DEFAULT_STRATEGY }, results: null, loading: false, error: null },
    { id: "m2", label: "RSI Bounce", color: ALGO_COLORS[1], strategy: { ...DEFAULT_STRATEGY, entry_conditions: [{ left: "rsi_14", operator: "crosses_above", right: "30" }] }, results: null, loading: false, error: null },
  ],
  matrixResults: null,
  matrixLoading: false,
  matrixError: null,
  matrixProgress: null,

  setMode: (mode) => set({ mode }),
  setMultiAlgoSymbol: (sym) => set({ multiAlgoSymbol: sym.toUpperCase().trim() }),
  setActiveAlgo: (id) => set({ activeAlgoId: id }),

  addAlgoSlot: () => set((s) => {
    if (s.algoSlots.length >= 5) return s;
    const usedColors = new Set(s.algoSlots.map((a) => a.color));
    const color = ALGO_COLORS.find((c) => !usedColors.has(c)) ?? ALGO_COLORS[s.algoSlots.length % ALGO_COLORS.length];
    const id = String(Date.now());
    const num = s.algoSlots.length + 1;
    return {
      algoSlots: [...s.algoSlots, {
        id, label: `Algo ${num}`, color,
        strategy: { ...DEFAULT_STRATEGY }, results: null, loading: false, error: null,
      }],
    };
  }),

  addCustomAlgoSlot: () => set((s) => {
    if (s.algoSlots.length >= 5) return s;
    const usedColors = new Set(s.algoSlots.map((a) => a.color));
    const color = ALGO_COLORS.find((c) => !usedColors.has(c)) ?? ALGO_COLORS[s.algoSlots.length % ALGO_COLORS.length];
    const id = String(Date.now());
    return {
      algoSlots: [...s.algoSlots, {
        id, label: "Custom Algo", color,
        strategy: { ...DEFAULT_STRATEGY, entry_conditions: [] },
        results: null, loading: false, error: null,
      }],
    };
  }),

  removeAlgoSlot: (id) => set((s) => ({
    algoSlots: s.algoSlots.length > 1 ? s.algoSlots.filter((a) => a.id !== id) : s.algoSlots,
    activeAlgoId: s.activeAlgoId === id ? null : s.activeAlgoId,
  })),

  updateAlgoSlot: (id, patch) => set((s) => ({
    algoSlots: s.algoSlots.map((a) => a.id === id ? { ...a, ...patch } : a),
  })),

  runAllAlgos: async () => {
    const { algoSlots, multiAlgoSymbol, strategy } = get();
    if (!multiAlgoSymbol) return;
    // Mark all loading
    set((s) => ({ algoSlots: s.algoSlots.map((a) => ({ ...a, loading: true, error: null, results: null })) }));
    const runs = algoSlots.map(async (slot) => {
      try {
        const res = await api.runBacktestV2({
          symbols: [multiAlgoSymbol],
          from_date: slot.strategy.from_date,
          to_date: slot.strategy.to_date,
          entry_conditions: slot.strategy.entry_conditions,
          exit_conditions: slot.strategy.exit_conditions,
          target_pct: slot.strategy.target_pct,
          sl_pct: slot.strategy.sl_pct,
          max_bars: slot.strategy.max_bars,
          capital_per_trade: slot.strategy.capital_per_trade,
          timeframe: slot.strategy.timeframe,
          data_source: slot.strategy.data_source,
        });
        const symResult = res.per_symbol[multiAlgoSymbol] ?? null;
        set((s) => ({
          algoSlots: s.algoSlots.map((a) => a.id === slot.id ? { ...a, loading: false, results: symResult } : a),
        }));
      } catch (e) {
        set((s) => ({
          algoSlots: s.algoSlots.map((a) => a.id === slot.id ? { ...a, loading: false, error: String(e) } : a),
        }));
      }
    });
    await Promise.all(runs);
    // Auto-select first algo
    set((s) => ({ activeAlgoId: s.activeAlgoId ?? s.algoSlots[0]?.id ?? null }));
  },

  addMatrixAlgo: () => set((s) => {
    if (s.matrixAlgos.length >= 4) return s;
    const usedColors = new Set(s.matrixAlgos.map((a) => a.color));
    const color = ALGO_COLORS.find((c) => !usedColors.has(c)) ?? ALGO_COLORS[s.matrixAlgos.length % ALGO_COLORS.length];
    const id = `m${Date.now()}`;
    const num = s.matrixAlgos.length + 1;
    return {
      matrixAlgos: [...s.matrixAlgos, {
        id, label: `Algo ${num}`, color,
        strategy: { ...DEFAULT_STRATEGY }, results: null, loading: false, error: null,
      }],
    };
  }),

  removeMatrixAlgo: (id) => set((s) => ({
    matrixAlgos: s.matrixAlgos.length > 1 ? s.matrixAlgos.filter((a) => a.id !== id) : s.matrixAlgos,
  })),

  updateMatrixAlgo: (id, patch) => set((s) => ({
    matrixAlgos: s.matrixAlgos.map((a) => a.id === id ? { ...a, ...patch } : a),
  })),

  runMatrix: async () => {
    const { pickedSymbols, matrixAlgos, strategy } = get();
    if (!pickedSymbols.length || !matrixAlgos.length) return;
    set({ matrixLoading: true, matrixError: null, matrixResults: null, matrixProgress: null });
    try {
      const BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? "/api";
      const algos = matrixAlgos.map((slot) => ({
        id: slot.id, label: slot.label,
        entry_conditions: slot.strategy.entry_conditions,
        exit_conditions: slot.strategy.exit_conditions,
        target_pct: slot.strategy.target_pct,
        sl_pct: slot.strategy.sl_pct,
        max_bars: slot.strategy.max_bars,
      }));
      const res = await fetch(`${BASE}/backtest/run-matrix-stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbols: pickedSymbols, algos,
          from_date: strategy.from_date, to_date: strategy.to_date,
          capital_per_trade: strategy.capital_per_trade, timeframe: strategy.timeframe,
          data_source: strategy.data_source,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: res.statusText }));
        const msg = Array.isArray(err.detail) ? err.detail[0]?.msg : (err.detail ?? res.statusText);
        throw new Error(String(msg));
      }
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = JSON.parse(line.slice(6));
          if (data.result) {
            set({ matrixResults: data.result, matrixLoading: false, matrixProgress: null });
          } else {
            set({ matrixProgress: { done: data.done, total: data.total } });
          }
        }
      }
    } catch (e) {
      set({ matrixLoading: false, matrixError: String(e), matrixProgress: null });
    }
  },

  // ── Options straddle/strangle mode ────────────────────────────────────────
  straddle: DEFAULT_STRADDLE,
  straddleResults: null,
  straddleLoading: false,
  straddleError: null,

  setStraddle: (p) => set((s) => ({ straddle: { ...s.straddle, ...p } })),

  runStraddle: async () => {
    const { straddle } = get();
    if (!straddle.symbol) return;
    set({ straddleLoading: true, straddleError: null, straddleResults: null });
    try {
      const res = await api.runStraddleBacktest(straddle);
      set({ straddleResults: res, straddleLoading: false });
    } catch (e) {
      set({ straddleLoading: false, straddleError: String(e) });
    }
  },

  // ── Options spreads mode ──────────────────────────────────────────────────
  optionsFamily: "straddle",
  setOptionsFamily: (f) => set({ optionsFamily: f }),

  spread: DEFAULT_SPREAD,
  spreadResults: null,
  spreadLoading: false,
  spreadError: null,

  setSpread: (p) => set((s) => ({ spread: { ...s.spread, ...p } })),

  runSpread: async () => {
    const { spread } = get();
    if (!spread.symbol) return;
    set({ spreadLoading: true, spreadError: null, spreadResults: null });
    try {
      const res = await api.runSpreadBacktest(spread);
      set({ spreadResults: res, spreadLoading: false });
    } catch (e) {
      set({ spreadLoading: false, spreadError: String(e) });
    }
  },

  // ── ORB mode ───────────────────────────────────────────────────────────────
  orb: DEFAULT_ORB,
  orbResults: null,
  orbLoading: false,
  orbError: null,

  setOrb: (p) => set((s) => ({ orb: { ...s.orb, ...p } })),

  runOrb: async () => {
    const { orb } = get();
    if (!orb.symbol) return;
    set({ orbLoading: true, orbError: null, orbResults: null });
    try {
      const res = await api.runOrbBacktest(orb);
      set({ orbResults: res, orbLoading: false });
    } catch (e) {
      set({ orbLoading: false, orbError: String(e) });
    }
  },

  // ── Grid Search mode ──────────────────────────────────────────────────────
  grid: DEFAULT_GRID,
  gridResults: null,
  gridLoading: false,
  gridError: null,
  gridProgress: null,
  gridSweepables: null,

  setGrid: (p) => set((s) => ({ grid: { ...s.grid, ...p } })),

  loadGridSweepables: async () => {
    try {
      const res = await api.getGridSweepables();
      set({ gridSweepables: res });
    } catch {}
  },

  runGridSearch: async () => {
    const { pickedSymbols, grid, strategy } = get();
    if (!pickedSymbols.length || !grid.sweep_dims.length) return;
    set({ gridLoading: true, gridError: null, gridResults: null, gridProgress: null });
    try {
      const BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? "/api";
      const res = await fetch(`${BASE}/backtest/run-grid-search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbols: pickedSymbols,
          from_date: strategy.from_date, to_date: strategy.to_date,
          entry_conditions: grid.entry_conditions, exit_conditions: [],
          sweep_dims: grid.sweep_dims,
          target_pct: grid.target_pct, sl_pct: grid.sl_pct, max_bars: grid.max_bars,
          capital_per_trade: strategy.capital_per_trade, timeframe: strategy.timeframe,
          data_source: strategy.data_source,
          train_ratio: grid.train_ratio, top_n: grid.top_n,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: res.statusText }));
        const msg = Array.isArray(err.detail) ? err.detail[0]?.msg : (err.detail ?? res.statusText);
        throw new Error(String(msg));
      }
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = JSON.parse(line.slice(6));
          if (data.result) {
            set({ gridResults: data.result, gridLoading: false, gridProgress: null });
          } else {
            set({ gridProgress: { phase: data.phase, done: data.done, total: data.total } });
          }
        }
      }
    } catch (e) {
      set({ gridLoading: false, gridError: String(e), gridProgress: null });
    }
  },

  // ── ML Models mode ────────────────────────────────────────────────────────
  ml: DEFAULT_ML,
  mlResults: null,
  mlLoading: false,
  mlError: null,
  mlProgress: null,
  mlModelList: [],

  setMl: (p) => set((s) => ({ ml: { ...s.ml, ...p } })),

  loadMlModels: async () => {
    try {
      const list = await api.getMlModels();
      set({ mlModelList: list });
    } catch {}
  },

  runMl: async () => {
    const { pickedSymbols, ml, strategy } = get();
    if (!pickedSymbols.length || !ml.models.length) return;
    set({ mlLoading: true, mlError: null, mlResults: null, mlProgress: null });
    try {
      const BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? "/api";
      const res = await fetch(`${BASE}/backtest/run-ml-stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbols: pickedSymbols,
          from_date: strategy.from_date, to_date: strategy.to_date,
          entry_conditions: ml.entry_conditions, sample_mode: ml.sample_mode,
          models: ml.models, prob_threshold: ml.prob_threshold, train_ratio: ml.train_ratio,
          target_pct: ml.target_pct, sl_pct: ml.sl_pct, max_bars: ml.max_bars,
          capital_per_trade: strategy.capital_per_trade, timeframe: strategy.timeframe,
          data_source: strategy.data_source,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: res.statusText }));
        const msg = Array.isArray(err.detail) ? err.detail[0]?.msg : (err.detail ?? res.statusText);
        throw new Error(String(msg));
      }
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = JSON.parse(line.slice(6));
          if (data.result) {
            set({ mlResults: data.result, mlLoading: false, mlProgress: null });
          } else if (data.phase === "error") {
            set({ mlLoading: false, mlError: data.error, mlProgress: null });
          } else {
            set({ mlProgress: { phase: data.phase, model: data.model, done: data.done, total: data.total } });
          }
        }
      }
    } catch (e) {
      set({ mlLoading: false, mlError: String(e), mlProgress: null });
    }
  },

  // ── Quant Signals mode ────────────────────────────────────────────────────
  quant: DEFAULT_QUANT,
  quantResults: null,
  quantLoading: false,
  quantError: null,
  quantProgress: null,
  quantAlgoMeta: [],

  setQuant: (p) => set((s) => ({ quant: { ...s.quant, ...p } })),

  loadQuantAlgoMeta: async () => {
    try {
      const list = await api.getQuantSignalAlgos();
      set({ quantAlgoMeta: list });
    } catch {}
  },

  runQuantSignals: async () => {
    const { pickedSymbols, quant, strategy } = get();
    if (!pickedSymbols.length) return;
    set({ quantLoading: true, quantError: null, quantResults: null, quantProgress: null });
    try {
      const BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? "/api";
      const res = await fetch(`${BASE}/backtest/run-quant-signals`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          algo: quant.algo,
          symbols: pickedSymbols,
          from_date: strategy.from_date, to_date: strategy.to_date,
          account_capital: quant.account_capital,
          data_source: quant.data_source,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: res.statusText }));
        const msg = Array.isArray(err.detail) ? err.detail[0]?.msg : (err.detail ?? res.statusText);
        throw new Error(String(msg));
      }
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = JSON.parse(line.slice(6));
          if (data.result) {
            set({ quantResults: data.result, quantLoading: false, quantProgress: null });
          } else {
            set({ quantProgress: { phase: data.phase, done: data.done, total: data.total, symbol: data.symbol } });
          }
        }
      }
    } catch (e) {
      set({ quantLoading: false, quantError: String(e), quantProgress: null });
    }
  },

  addSymbol: (sym) => {
    const upper = sym.toUpperCase().trim();
    if (!upper) return;
    set((s) => ({
      pickedSymbols: s.pickedSymbols.includes(upper) ? s.pickedSymbols : [...s.pickedSymbols, upper],
    }));
  },
  removeSymbol: (sym) =>
    set((s) => ({ pickedSymbols: s.pickedSymbols.filter((x) => x !== sym) })),
  loadWatchlistSymbols: (symbols) => set({ pickedSymbols: symbols, v2Results: null }),
  clearSymbols: () => set({ pickedSymbols: [], v2Results: null }),

  setStrategy: (p) => set((s) => ({ strategy: { ...s.strategy, ...p } })),

  runBacktestV2: async () => {
    const { pickedSymbols, strategy } = get();
    if (!pickedSymbols.length) return;
    set({ v2Loading: true, v2Error: null, v2Results: null, activeSymbol: null });
    try {
      const res = await api.runBacktestV2({
        symbols: pickedSymbols,
        from_date: strategy.from_date,
        to_date: strategy.to_date,
        entry_conditions: strategy.entry_conditions,
        exit_conditions: strategy.exit_conditions,
        target_pct: strategy.target_pct,
        sl_pct: strategy.sl_pct,
        max_bars: strategy.max_bars,
        capital_per_trade: strategy.capital_per_trade,
        timeframe: strategy.timeframe,
        data_source: strategy.data_source,
      });
      const firstSym = Object.keys(res.per_symbol)[0] ?? null;
      set({ v2Results: res, v2Loading: false, activeSymbol: firstSym });
    } catch (e) {
      set({ v2Loading: false, v2Error: String(e) });
    }
  },

  loadEntryConditions: async () => {
    try {
      const conditions = await api.getEntryConditions();
      set({ entryConditions: conditions });
    } catch {}
  },

  loadIndicators: async () => {
    try {
      const data = await api.getBacktestIndicators();
      set({ indicators: data.indicators, operators: data.operators });
    } catch {}
  },

  loadWatchlists: async () => {
    try {
      const watchlists = await api.getWatchlists();
      set({ watchlists });
    } catch {}
  },

  setActiveSymbol: (sym) => set({ activeSymbol: sym }),

  saveCurrentRun: (label) => {
    const { v2Results, strategy } = get();
    if (!v2Results) return;
    const run: SavedRun = {
      id: String(Date.now()),
      label,
      timeframe: strategy.timeframe,
      results: v2Results,
    };
    set((s) => ({
      savedRuns: s.savedRuns.some((r) => r.label === label)
        ? s.savedRuns.map((r) => r.label === label ? run : r)
        : [...s.savedRuns, run],
    }));
  },

  clearSavedRuns: () => set({ savedRuns: [] }),

  fetchCandleStats: async () => {
    const { pickedSymbols } = get();
    if (!pickedSymbols.length) { set({ candleStats: [] }); return; }
    try {
      const stats = await api.getCandleStats(pickedSymbols);
      set({ candleStats: stats });
    } catch {}
  },

  startDataSync: async (candle_days: number) => {
    const { pickedSymbols } = get();
    if (!pickedSymbols.length) return;
    set({ syncLoading: true, syncJob: null, syncJobId: null });
    try {
      const { job_id } = await api.startSync(pickedSymbols, candle_days);
      set({ syncJobId: job_id });
      const poll = setInterval(async () => {
        try {
          const job = await api.getSyncJob(job_id);
          set({ syncJob: job });
          if (job.status === "complete" || job.status === "done" || job.status === "error") {
            clearInterval(poll);
            set({ syncLoading: false });
            get().fetchCandleStats();
          }
        } catch { clearInterval(poll); set({ syncLoading: false }); }
      }, 1200);
    } catch (e) {
      set({ syncLoading: false });
    }
  },
}));
