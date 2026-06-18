import { create } from "zustand";
import { api, ScreenerCondition, ScreenerResult, ScreenerPreset } from "../lib/api";

interface ScreenerState {
  conditions: ScreenerCondition[];
  results: ScreenerResult[];
  presets: ScreenerPreset[];
  metrics: string[];
  operators: string[];
  loading: boolean;
  error: string | null;

  addCondition: (c: ScreenerCondition) => void;
  updateCondition: (idx: number, c: ScreenerCondition) => void;
  removeCondition: (idx: number) => void;
  setConditions: (cs: ScreenerCondition[]) => void;
  runScreen: () => Promise<void>;
  loadPresets: () => Promise<void>;
  loadMetrics: () => Promise<void>;
}

export const useScreenerStore = create<ScreenerState>((set, get) => ({
  conditions: [],
  results: [],
  presets: [],
  metrics: [],
  operators: ["gt", "lt", "gte", "lte", "eq"],
  loading: false,
  error: null,

  addCondition: (c) => set((s) => ({ conditions: [...s.conditions, c] })),
  updateCondition: (idx, c) =>
    set((s) => ({ conditions: s.conditions.map((x, i) => (i === idx ? c : x)) })),
  removeCondition: (idx) =>
    set((s) => ({ conditions: s.conditions.filter((_, i) => i !== idx) })),
  setConditions: (cs) => set({ conditions: cs }),

  runScreen: async () => {
    const { conditions } = get();
    if (!conditions.length) return;
    set({ loading: true, error: null });
    try {
      const res = await api.screenStocks(conditions);
      set({ results: res.results, loading: false });
    } catch (e: unknown) {
      set({ loading: false, error: String(e), results: [] });
    }
  },

  loadPresets: async () => {
    try {
      const presets = await api.getScreenerPresets();
      set({ presets });
    } catch {}
  },

  loadMetrics: async () => {
    try {
      const { metrics, operators } = await api.getScreenerMetrics();
      set({ metrics, operators });
    } catch {}
  },
}));
