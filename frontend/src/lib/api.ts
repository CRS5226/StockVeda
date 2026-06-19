const BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? "/api";

async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, opts);
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

// ── Types ──────────────────────────────────────────────────────────────────

export interface Candle {
  date: string;
  open: number; high: number; low: number; close: number; volume: number;
  sma_20?: number; sma_50?: number; sma_200?: number;
  ema_20?: number; ema_50?: number;
  rsi_14?: number;
  macd?: number; macd_signal?: number; macd_hist?: number;
  bb_upper?: number; bb_mid?: number; bb_lower?: number;
  stoch_k?: number; stoch_d?: number;
  willr?: number;
  cci?: number;
  adx?: number; adx_pos?: number; adx_neg?: number;
  atr_14?: number;
  volume_sma_20?: number;
}

export interface Fundamental {
  period: string; period_type: string; is_consolidated: boolean;
  revenue?: number; gross_profit?: number; ebitda?: number; ebit?: number;
  pbt?: number; pat?: number; eps_basic?: number; eps_diluted?: number;
  total_assets?: number; total_equity?: number; total_debt?: number;
  cash?: number; cfo?: number; cfi?: number; cff?: number; capex?: number;
}

export interface Delivery { date: string; delivery_qty: number; delivery_pct: number }
export interface Shareholding {
  period: string; promoter_pct?: number; promoter_pledge_pct?: number;
  fii_pct?: number; dii_pct?: number; mf_pct?: number; retail_pct?: number;
}
export interface CorporateAction {
  ex_date: string; action_type: string; value?: number; ratio?: string; record_date?: string;
}
export interface InsiderTrade {
  person_name: string; person_category: string; trade_date: string;
  transaction_type: string; quantity: number; price?: number; filing_date: string;
}
export interface FnoRow {
  date: string; symbol: string; instrument: string; expiry?: string;
  strike?: number; option_type?: string; open?: number; high?: number;
  low?: number; close?: number; open_interest?: number; oi_change?: number;
}
export interface ScreenerResult {
  symbol: string; date: string; close: number; volume: number;
  pe_ratio?: number; debt_to_equity?: number; promoter_pct?: number;
  fii_pct?: number; delivery_pct?: number; eps_basic?: number; pat?: number;
}
export interface ScreenerCondition { metric: string; op: string; value: number }
export interface ScreenerPreset { name: string; description: string; conditions: ScreenerCondition[] }
export interface BacktestResult {
  equity_curve: { date: string; value: number }[];
  trades: {
    entry_date: string; exit_date: string; entry_price: number; exit_price: number;
    shares: number; pnl: number; pnl_pct: number;
  }[];
  stats: {
    initial_capital: number; final_value: number; total_return_pct: number;
    total_trades: number; winning_trades: number; win_rate_pct: number;
    max_drawdown_pct: number; avg_pnl: number;
  };
}
export interface Strategy {
  name: string; description: string;
  params: {
    entry_col: string; entry_op: string; entry_threshold_col: string;
    exit_bars?: number; exit_col?: string; exit_op?: string; exit_threshold_col?: string;
  };
}
export interface IndexRow { date: string; index_name: string; open: number; high: number; low: number; close: number }
export interface FiiDiiRow {
  date: string; fii_buy: number; fii_sell: number; fii_net: number;
  dii_buy: number; dii_sell: number; dii_net: number;
}
export interface CurrencyRow { date: string; pair: string; open: number; high: number; low: number; close: number }
export interface MacroRow { date: string; metric: string; value: number; unit: string }
export interface DashboardData {
  headline: { name: string; close: number; prev: number; change: number; change_pct: number }[];
  sector_perf: { name: string; pct: number }[];
  nifty_hist: { date: string; close: number }[];
  fii_latest: { date: string; fii_buy: number; fii_sell: number; fii_net: number; dii_buy: number; dii_sell: number; dii_net: number } | null;
  usdinr: { close: number; change_pct?: number } | null;
}

// ── API functions ──────────────────────────────────────────────────────────

export const api = {
  searchSymbols: (q: string) =>
    apiFetch<{ symbol: string; name: string }[]>(`/stock/search?q=${encodeURIComponent(q)}`),

  getStockInfo: (symbol: string) =>
    apiFetch<{ symbol: string; company_name: string | null; series: string | null; isin: string | null }>(`/stock/info/${symbol}`),

  triggerSync: (source: string) =>
    apiFetch<{ status: string; source: string }>(`/sync/trigger/${source}`, { method: "POST" }),

  prefetchSymbol: (symbol: string) =>
    apiFetch<{ status: string; symbol: string; fetched: string[] }>(
      `/stock/prefetch/${symbol}`, { method: "POST" }
    ),

  getCandles: (symbol: string, fromDate?: string, withIndicators = false) => {
    const p = new URLSearchParams();
    if (fromDate) p.set("from_date", fromDate);
    if (withIndicators) p.set("indicators", "true");
    return apiFetch<Candle[]>(`/stock/candles/${symbol}?${p}`);
  },

  getFundamentals: (symbol: string, periodType: "Q" | "A" = "Q") =>
    apiFetch<Fundamental[]>(`/stock/fundamentals/${symbol}?period_type=${periodType}&limit=20`),

  getDelivery: (symbol: string, fromDate?: string) => {
    const p = fromDate ? `?from_date=${fromDate}` : "";
    return apiFetch<Delivery[]>(`/stock/delivery/${symbol}${p}`);
  },

  getShareholding: (symbol: string) =>
    apiFetch<Shareholding[]>(`/stock/shareholding/${symbol}`),

  getCorporateActions: (symbol: string) =>
    apiFetch<CorporateAction[]>(`/stock/corporate-actions/${symbol}`),

  getInsiderTrades: (symbol: string) =>
    apiFetch<InsiderTrade[]>(`/stock/insider-trades/${symbol}`),

  getFno: (symbol: string) =>
    apiFetch<FnoRow[]>(`/stock/fno/${symbol}?limit=200`),

  screenStocks: (conditions: ScreenerCondition[], limit = 200) =>
    apiFetch<{ count: number; results: ScreenerResult[] }>("/screener/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conditions, limit }),
    }),

  getScreenerPresets: () =>
    apiFetch<ScreenerPreset[]>("/screener/presets"),

  getScreenerMetrics: () =>
    apiFetch<{ metrics: string[]; operators: string[] }>("/screener/metrics"),

  runBacktest: (params: {
    symbol: string; from_date: string; to_date: string;
    initial_capital?: number; entry_col?: string; entry_op?: string;
    entry_threshold_col?: string; exit_bars?: number;
    exit_col?: string; exit_op?: string; exit_threshold_col?: string;
    position_pct?: number;
  }) =>
    apiFetch<BacktestResult>("/backtest/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    }),

  getBacktestStrategies: () =>
    apiFetch<Strategy[]>("/backtest/strategies"),

  getIndices: (indexName?: string, fromDate?: string) => {
    const p = new URLSearchParams({ limit: "1000" });
    if (indexName) p.set("index_name", indexName);
    if (fromDate) p.set("from_date", fromDate);
    return apiFetch<IndexRow[]>(`/macro/indices?${p}`);
  },

  getIndexList: () => apiFetch<string[]>("/macro/indices/list"),

  getFiiDii: (fromDate?: string) => {
    const p = fromDate ? `?from_date=${fromDate}&limit=252` : "?limit=252";
    return apiFetch<FiiDiiRow[]>(`/macro/fii-dii${p}`);
  },

  getCurrency: (pair?: string, fromDate?: string) => {
    const p = new URLSearchParams({ limit: "500" });
    if (pair) p.set("pair", pair);
    if (fromDate) p.set("from_date", fromDate);
    return apiFetch<CurrencyRow[]>(`/macro/currency?${p}`);
  },

  getMacroData: (metric?: string, frequency: "monthly" | "quarterly" = "monthly") => {
    const p = new URLSearchParams({ frequency });
    if (metric) p.set("metric", metric);
    return apiFetch<MacroRow[]>(`/macro/macro-data?${p}`);
  },

  getMacroMetrics: () =>
    apiFetch<{ monthly: string[]; quarterly: string[] }>("/macro/macro-data/metrics"),

  syncStatus: () => apiFetch<Record<string, unknown>[]>("/sync/status"),

  getDashboard: () => apiFetch<DashboardData>("/macro/dashboard"),
};
