import { create } from "zustand";
import { api, MfCategory, MfScheme, MfSchemeDetail } from "../lib/api";

interface MutualFundState {
  categories: MfCategory[];
  categoriesLoading: boolean;

  bucket: string | null;
  category: string | null;
  query: string;
  sortByScore: boolean;
  schemes: MfScheme[];
  schemesLoading: boolean;
  error: string | null;

  detail: MfSchemeDetail | null;
  detailLoading: boolean;
  detailError: string | null;

  loadCategories: () => Promise<void>;
  setBucket: (bucket: string | null) => void;
  setCategory: (category: string | null) => void;
  setQuery: (q: string) => void;
  setSortByScore: (v: boolean) => void;
  loadSchemes: () => Promise<void>;
  loadSchemeDetail: (schemeCode: string) => Promise<void>;
  clearDetail: () => void;
}

export const useMutualFundStore = create<MutualFundState>((set, get) => ({
  categories: [],
  categoriesLoading: false,

  bucket: null,
  category: null,
  query: "",
  sortByScore: false,
  schemes: [],
  schemesLoading: false,
  error: null,

  detail: null,
  detailLoading: false,
  detailError: null,

  loadCategories: async () => {
    set({ categoriesLoading: true });
    try {
      const categories = await api.getMfCategories();
      set({ categories, categoriesLoading: false });
    } catch {
      set({ categories: [], categoriesLoading: false });
    }
  },

  setBucket: (bucket) => set({ bucket, category: null }),
  setCategory: (category) => set({ category }),
  setQuery: (query) => set({ query }),
  setSortByScore: (sortByScore) => set({ sortByScore }),

  loadSchemes: async () => {
    const { bucket, category, query, sortByScore } = get();
    set({ schemesLoading: true, error: null });
    try {
      const schemes = await api.getMfSchemes({
        bucket: bucket ?? undefined,
        category: category ?? undefined,
        q: query || undefined,
        limit: 200,
        sort: sortByScore ? "stockveda_score" : undefined,
      });
      set({ schemes, schemesLoading: false });
    } catch (e) {
      set({ schemesLoading: false, error: String(e), schemes: [] });
    }
  },

  loadSchemeDetail: async (schemeCode: string) => {
    set({ detailLoading: true, detailError: null, detail: null });
    try {
      const detail = await api.getMfSchemeDetail(schemeCode);
      set({ detail, detailLoading: false });
    } catch (e) {
      set({ detailLoading: false, detailError: String(e) });
    }
  },

  clearDetail: () => set({ detail: null, detailError: null }),
}));
