import { create } from "zustand";
import { api, Candle, Fundamental, Delivery, Shareholding, CorporateAction, InsiderTrade, FnoRow } from "../lib/api";

interface StockState {
  symbol: string;
  candles: Candle[];
  fundamentals: Fundamental[];
  delivery: Delivery[];
  shareholding: Shareholding[];
  corporateActions: CorporateAction[];
  insiderTrades: InsiderTrade[];
  fno: FnoRow[];
  loading: Record<string, boolean>;
  error: string | null;

  fetchCandles: (symbol: string, fromDate?: string, withIndicators?: boolean) => Promise<void>;
  fetchFundamentals: (symbol: string, periodType?: "Q" | "A") => Promise<void>;
  fetchDelivery: (symbol: string, fromDate?: string) => Promise<void>;
  fetchShareholding: (symbol: string) => Promise<void>;
  fetchCorporateActions: (symbol: string) => Promise<void>;
  fetchInsiderTrades: (symbol: string) => Promise<void>;
  fetchFno: (symbol: string) => Promise<void>;
  setSymbol: (s: string) => void;
  clearError: () => void;
}

export const useStockStore = create<StockState>((set, get) => ({
  symbol: "",
  candles: [],
  fundamentals: [],
  delivery: [],
  shareholding: [],
  corporateActions: [],
  insiderTrades: [],
  fno: [],
  loading: {},
  error: null,

  setSymbol: (s) => set({ symbol: s.toUpperCase() }),
  clearError: () => set({ error: null }),

  fetchCandles: async (symbol, fromDate, withIndicators = true) => {
    set((s) => ({ loading: { ...s.loading, candles: true }, error: null }));
    try {
      const candles = await api.getCandles(symbol.toUpperCase(), fromDate, withIndicators);
      set((s) => ({ candles, loading: { ...s.loading, candles: false } }));
    } catch (e: unknown) {
      set((s) => ({ loading: { ...s.loading, candles: false }, error: String(e) }));
    }
  },

  fetchFundamentals: async (symbol, periodType = "Q") => {
    set((s) => ({ loading: { ...s.loading, fundamentals: true } }));
    try {
      const fundamentals = await api.getFundamentals(symbol.toUpperCase(), periodType);
      set((s) => ({ fundamentals, loading: { ...s.loading, fundamentals: false } }));
    } catch {
      set((s) => ({ loading: { ...s.loading, fundamentals: false } }));
    }
  },

  fetchDelivery: async (symbol, fromDate) => {
    set((s) => ({ loading: { ...s.loading, delivery: true } }));
    try {
      const delivery = await api.getDelivery(symbol.toUpperCase(), fromDate);
      set((s) => ({ delivery, loading: { ...s.loading, delivery: false } }));
    } catch {
      set((s) => ({ loading: { ...s.loading, delivery: false }, delivery: [] }));
    }
  },

  fetchShareholding: async (symbol) => {
    set((s) => ({ loading: { ...s.loading, shareholding: true } }));
    try {
      const shareholding = await api.getShareholding(symbol.toUpperCase());
      set((s) => ({ shareholding, loading: { ...s.loading, shareholding: false } }));
    } catch {
      set((s) => ({ loading: { ...s.loading, shareholding: false }, shareholding: [] }));
    }
  },

  fetchCorporateActions: async (symbol) => {
    set((s) => ({ loading: { ...s.loading, corporateActions: true } }));
    try {
      const [corporateActions, insiderTrades] = await Promise.all([
        api.getCorporateActions(symbol.toUpperCase()),
        api.getInsiderTrades(symbol.toUpperCase()),
      ]);
      set((s) => ({ corporateActions, insiderTrades, loading: { ...s.loading, corporateActions: false } }));
    } catch {
      set((s) => ({ loading: { ...s.loading, corporateActions: false } }));
    }
  },

  fetchInsiderTrades: async (symbol) => {
    set((s) => ({ loading: { ...s.loading, insiderTrades: true } }));
    try {
      const insiderTrades = await api.getInsiderTrades(symbol.toUpperCase());
      set((s) => ({ insiderTrades, loading: { ...s.loading, insiderTrades: false } }));
    } catch {
      set((s) => ({ loading: { ...s.loading, insiderTrades: false } }));
    }
  },

  fetchFno: async (symbol) => {
    set((s) => ({ loading: { ...s.loading, fno: true } }));
    try {
      const fno = await api.getFno(symbol.toUpperCase());
      set((s) => ({ fno, loading: { ...s.loading, fno: false } }));
    } catch {
      set((s) => ({ loading: { ...s.loading, fno: false }, fno: [] }));
    }
  },
}));
