import { create } from "zustand";
import { api, BacktestResult, Strategy } from "../lib/api";

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

interface BacktestState {
  params: BacktestParams;
  results: BacktestResult | null;
  strategies: Strategy[];
  loading: boolean;
  error: string | null;

  setParams: (p: Partial<BacktestParams>) => void;
  applyStrategy: (s: Strategy) => void;
  runBacktest: () => Promise<void>;
  loadStrategies: () => Promise<void>;
}

const DEFAULT_PARAMS: BacktestParams = {
  symbol: "",
  from_date: new Date(Date.now() - 3 * 365 * 86400_000).toISOString().slice(0, 10),
  to_date: new Date().toISOString().slice(0, 10),
  initial_capital: 100000,
  entry_col: "close",
  entry_op: "cross_above",
  entry_threshold_col: "sma_50",
  exit_bars: 20,
  position_pct: 1.0,
};

export const useBacktestStore = create<BacktestState>((set, get) => ({
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
    } catch (e: unknown) {
      set({ loading: false, error: String(e) });
    }
  },

  loadStrategies: async () => {
    try {
      const strategies = await api.getBacktestStrategies();
      set({ strategies });
    } catch {}
  },
}));
