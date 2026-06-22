import { create } from "zustand";
import { api, ScreenerCondition, ScreenerResult, Watchlist, ScreenerPresetOption, SyncJob, SavedScreener } from "../lib/api";

type FilterTab = "technical" | "fundamental";
type SyncStatus = "idle" | "running" | "complete" | "error";

interface ScreenerState {
  // ── Step 1: Stock picker ───────────────────────────────────────────────
  pickedSymbols: string[];
  presets: ScreenerPresetOption[];

  // ── Step 2: Sync / data fetch ──────────────────────────────────────────
  candleDays: number;
  jobId: string | null;
  syncDone: number;
  syncTotal: number;
  syncPct: number;
  syncStatus: SyncStatus;
  syncCurrentSymbol: string;

  // ── Step 3: Filter + results ───────────────────────────────────────────
  filterTab: FilterTab;
  conditions: ScreenerCondition[];
  results: ScreenerResult[];
  loading: boolean;
  error: string | null;

  // ── Watchlists ─────────────────────────────────────────────────────────
  watchlists: Watchlist[];

  // ── Actions ────────────────────────────────────────────────────────────
  addSymbol: (sym: string) => void;
  removeSymbol: (sym: string) => void;
  loadPreset: (symbols: string[]) => void;
  clearSymbols: () => void;

  setCandleDays: (days: number) => void;
  startSync: () => Promise<void>;

  setFilterTab: (tab: FilterTab) => void;
  addCondition: (c: ScreenerCondition) => void;
  updateCondition: (idx: number, c: ScreenerCondition) => void;
  removeCondition: (idx: number) => void;
  clearConditions: () => void;
  setConditions: (conditions: ScreenerCondition[]) => void;
  runScreen: () => Promise<void>;

  loadPresets: () => Promise<void>;
  loadWatchlists: () => Promise<void>;
  saveWatchlist: (name: string) => Promise<Watchlist>;
  deleteWatchlist: (id: number) => Promise<void>;

  savedScreeners: SavedScreener[];
  loadSavedScreeners: () => Promise<void>;
  saveScreener: (name: string) => Promise<SavedScreener>;
  deleteSavedScreener: (id: number) => Promise<void>;
}

export const useScreenerStore = create<ScreenerState>((set, get) => ({
  pickedSymbols: [],
  presets: [],
  candleDays: 180,
  jobId: null,
  syncDone: 0,
  syncTotal: 0,
  syncPct: 0,
  syncStatus: "idle",
  syncCurrentSymbol: "",
  filterTab: "technical",
  conditions: [],
  results: [],
  loading: false,
  error: null,
  watchlists: [],
  savedScreeners: [],

  // ── Picker ──────────────────────────────────────────────────────────────
  addSymbol: (sym) => {
    const upper = sym.toUpperCase().trim();
    if (!upper) return;
    set((s) => ({
      pickedSymbols: s.pickedSymbols.includes(upper) ? s.pickedSymbols : [...s.pickedSymbols, upper],
    }));
  },
  removeSymbol: (sym) =>
    set((s) => ({ pickedSymbols: s.pickedSymbols.filter((x) => x !== sym) })),
  loadPreset: (symbols) => set({ pickedSymbols: symbols, syncStatus: "idle", results: [] }),
  clearSymbols: () => set({ pickedSymbols: [], syncStatus: "idle", results: [] }),

  // ── Sync ────────────────────────────────────────────────────────────────
  setCandleDays: (days) => set({ candleDays: days }),

  startSync: async () => {
    const { pickedSymbols, candleDays } = get();
    if (!pickedSymbols.length) return;
    set({ syncStatus: "running", syncDone: 0, syncTotal: pickedSymbols.length, syncPct: 0, syncCurrentSymbol: "", results: [] });
    try {
      const { job_id, total } = await api.startSync(pickedSymbols, candleDays);
      set({ jobId: job_id, syncTotal: total });

      const poll = setInterval(async () => {
        try {
          const job: SyncJob = await api.getSyncJob(job_id);
          set({
            syncDone: job.done,
            syncTotal: job.total,
            syncPct: job.pct,
            syncCurrentSymbol: job.current_symbol,
          });
          if (job.status === "complete" || job.status === "error") {
            clearInterval(poll);
            set({ syncStatus: job.status === "complete" ? "complete" : "error", syncCurrentSymbol: "" });
          }
        } catch {
          clearInterval(poll);
          set({ syncStatus: "error" });
        }
      }, 600);
    } catch (e) {
      set({ syncStatus: "error", error: String(e) });
    }
  },

  // ── Filters ─────────────────────────────────────────────────────────────
  setFilterTab: (tab) => set({ filterTab: tab }),
  addCondition: (c) => set((s) => ({ conditions: [...s.conditions, c] })),
  updateCondition: (idx, c) =>
    set((s) => ({ conditions: s.conditions.map((x, i) => (i === idx ? c : x)) })),
  removeCondition: (idx) =>
    set((s) => ({ conditions: s.conditions.filter((_, i) => i !== idx) })),
  clearConditions: () => set({ conditions: [] }),
  setConditions: (conditions) => set({ conditions }),

  runScreen: async () => {
    const { conditions, pickedSymbols } = get();
    set({ loading: true, error: null });
    try {
      const res = await api.screenStocks(conditions, 500, pickedSymbols.length ? pickedSymbols : undefined);
      set({ results: res.results, loading: false });
    } catch (e) {
      set({ loading: false, error: String(e), results: [] });
    }
  },

  // ── Presets + Watchlists ─────────────────────────────────────────────────
  loadPresets: async () => {
    try {
      const presets = await api.getScreenerUniversePresets();
      set({ presets });
    } catch {}
  },

  loadWatchlists: async () => {
    try {
      const watchlists = await api.getWatchlists();
      set({ watchlists });
    } catch {}
  },

  saveWatchlist: async (name) => {
    const { results, pickedSymbols } = get();
    const symbols = results.length > 0 ? results.map((r) => r.symbol) : pickedSymbols;
    const wl = await api.createWatchlist(name, symbols);
    set((s) => ({ watchlists: [wl, ...s.watchlists] }));
    return wl;
  },

  deleteWatchlist: async (id) => {
    await api.deleteWatchlist(id);
    set((s) => ({ watchlists: s.watchlists.filter((w) => w.id !== id) }));
  },

  loadSavedScreeners: async () => {
    try {
      const savedScreeners = await api.getSavedScreeners();
      set({ savedScreeners });
    } catch {}
  },
  saveScreener: async (name) => {
    const { conditions } = get();
    const s = await api.createSavedScreener(name, conditions);
    set((st) => ({ savedScreeners: [s, ...st.savedScreeners] }));
    return s;
  },
  deleteSavedScreener: async (id) => {
    await api.deleteSavedScreener(id);
    set((s) => ({ savedScreeners: s.savedScreeners.filter((x) => x.id !== id) }));
  },
}));
