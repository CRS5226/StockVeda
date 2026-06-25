import { create } from "zustand";
import { api, BacktestResult, Strategy, BacktestV2Response, EntryCondition, Watchlist, ConditionRow, CandleStat, SyncJob } from "../lib/api";

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
}

export interface SavedRun {
  id: string;
  label: string;
  timeframe: string;
  results: BacktestV2Response;
}

const TWO_YEARS_AGO = new Date(Date.now() - 2 * 365 * 86400_000).toISOString().slice(0, 10);
const TODAY = new Date().toISOString().slice(0, 10);

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
    set((s) => ({ savedRuns: [...s.savedRuns, run] }));
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
