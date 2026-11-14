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
export interface EpsHistoryItem {
  quarter: string;
  eps_actual: number;
  eps_estimate: number | null;
  surprise_pct: number | null;
}
export interface StockRatios {
  symbol: string;
  market_cap_cr?: number; pe_ratio?: number; forward_pe?: number; pb_ratio?: number;
  book_value?: number; roe_pct?: number; roa_pct?: number;
  profit_margin_pct?: number; operating_margin_pct?: number;
  eps_trailing?: number; eps_forward?: number;
  div_yield_pct?: number; div_per_share?: number; payout_ratio_pct?: number; face_value?: number; roce_pct?: number;
  peg_ratio?: number; div_streak?: number; eps_history?: EpsHistoryItem[];
  ev_to_ebitda?: number; debt_to_equity?: number; price_to_sales?: number;
  fcf_cr?: number; sales_cagr_3y?: number; profit_cagr_3y?: number;
  beta?: number;
  beta_computed?: { beta: number; alpha: number; r_squared: number; n_obs: number; index_symbol: string; as_of_date: string } | null;
  "52w_high"?: number; "52w_low"?: number;
  avg_volume?: number; shares_outstanding?: number;
  revenue_growth_pct?: number; earnings_growth_pct?: number;
  target_high?: number; target_low?: number; target_mean?: number;
  recommendation?: string;
  employees?: number; website?: string; description?: string;
  sector?: string; industry?: string;
  next_earnings?: string;
  recommendations_summary?: { period: string; strongBuy: number; buy: number; hold: number; sell: number; strongSell: number }[];
}
export interface SectorComparePoint { date: string; pct: number }
export interface SectorCompareData {
  stock: SectorComparePoint[]; sector: SectorComparePoint[]; sector_name: string;
}
export interface BankFinancial {
  period: string; period_type: string; is_consolidated: boolean;
  nii_cr?: number; interest_earned_cr?: number; interest_expended_cr?: number;
  other_income_cr?: number; total_income_cr?: number;
  operating_expenses_cr?: number; ppop_cr?: number; provisions_cr?: number;
  pbt_cr?: number; pat_cr?: number; eps?: number;
  gnpa_cr?: number; net_npa_cr?: number;
  gnpa_pct?: number; net_npa_pct?: number;
  crar_pct?: number; cet1_pct?: number; roa?: number;
}
export interface NewsItem { title: string; link: string; source: string; published_at: string }
export interface Holder {
  Holder: string; Shares: number; "Date Reported": string;
  pctHeld?: number; "% Out"?: number; Value: number; pctChange?: number;
}

export interface ScreenerResult {
  symbol: string; date: string; close: number; volume: number;
  pe_ratio?: number; debt_to_equity?: number; promoter_pct?: number;
  fii_pct?: number; delivery_pct?: number; eps_basic?: number; pat?: number;
  ebitda?: number;
  rsi_14?: number; sma_20?: number; sma_50?: number; sma_200?: number;
  ema_20?: number; ema_50?: number; macd?: number; macd_signal?: number;
  bb_upper?: number; bb_lower?: number; atr_14?: number;
}
export interface ScreenerCondition { metric: string; op: string; value: number }
export interface ScreenerPreset { name: string; description: string; conditions: ScreenerCondition[] }
export interface ScreenerPresetOption { id: string; label: string; count: number; symbols: string[] }
export interface SavedScreener { id: number; name: string; conditions: ScreenerCondition[]; created_at: string }
export interface Watchlist { id: number; name: string; symbols: string[]; created_at: string }
export interface PortfolioSummary { id: number; name: string; holdings: number }
/** One purchase (lot) of a stock. Figures are null until quantity and buy price are filled in, or when no close is stored. */
export type HoldingKind = "stock" | "etf" | "reit" | "invit";
export interface PortfolioHolding {
  /** `kind` is the type shown: the one set by hand (`kind_override`) or else worked out from the symbol and name. */
  kind: HoldingKind; kind_override: HoldingKind | null;
  id: number; symbol: string; qty: number | null; buy_price: number | null; buy_date: string | null;
  last_price: number | null; last_date: string | null;
  invested: number | null; value: number | null; pnl: number | null; pnl_pct: number | null;
}
export interface PortfolioTotals { invested: number; value: number; pnl: number; pnl_pct: number | null; incomplete: number }
export interface PortfolioDetail { id: number; name: string; holdings: PortfolioHolding[]; totals: PortfolioTotals }
export type HoldingDraft = Pick<PortfolioHolding, "symbol" | "qty" | "buy_price" | "buy_date"> & { kind: HoldingKind | null };
export type FdFrequency = "monthly" | "quarterly" | "half_yearly" | "yearly";
export type FdPayout = "cumulative" | FdFrequency;
/** What the user types in for a fixed deposit. */
export interface FdDraft {
  name: string; principal: number; annual_rate: number; start_date: string; maturity_date: string;
  compounding: FdFrequency; payout: FdPayout;
}
/** A saved FD with its value worked out by the server for today. */
export interface PortfolioFd extends FdDraft {
  id: number; status: "not_started" | "active" | "matured"; days_left: number;
  interest_earned: number; interest_received: number; current_value: number; maturity_value: number; maturity_interest: number;
}
export interface FdTotals { principal: number; current_value: number; interest_earned: number; interest_received: number; maturity_value: number }
export interface FdListing { fds: PortfolioFd[]; totals: FdTotals }
export type AssetType = "crypto" | "us_stock" | "mutual_fund" | "bond" | "gold" | "other";
export type AssetCurrency = "INR" | "USD";
/** What the user types in for an investment such as crypto or a US stock; the current price is typed in too. */
export interface AssetDraft {
  name: string; asset_type: AssetType; currency: AssetCurrency; qty: number; buy_price: number; current_price: number; buy_date: string | null;
}
/** Figures are in the asset's own currency; the *_inr ones are null for a USD asset until a rate is entered. */
export interface PortfolioAsset extends AssetDraft {
  id: number; invested: number; value: number; pnl: number; pnl_pct: number | null;
  invested_inr: number | null; value_inr: number | null; pnl_inr: number | null;
}
export interface AssetTotals { invested: number; value: number; pnl: number; pnl_pct: number | null; unconverted: number }
export interface AssetListing { assets: PortfolioAsset[]; usd_inr: number | null; totals: AssetTotals }
/** One slice of the portfolio total: stocks, fixed deposits or one kind of other investment, all in rupees. */
export interface TotalPart { key: string; label: string; invested: number; value: number; pnl: number; pnl_pct: number | null; share_pct: number }
export interface PortfolioTotal {
  invested: number; value: number; /** profit including the dividends received */ pnl: number; dividends: number; pnl_pct: number | null; parts: TotalPart[];
  /** Stocks without a quantity and buy price, and dollar assets without a USD to INR rate: not in the total yet. */
  left_out: { stocks: number; assets: number };
  /** Annualised return over the items that have a date, and how many items that is. */
  xirr_pct: number | null;
  xirr_items: { dated: number; total: number };
}
export type MfKind = "sip" | "lumpsum";
/** What the user types in for a mutual fund: the scheme, a SIP or a lump sum, the amount and when it started. */
export interface MfDraft { scheme_code: string; kind: MfKind; amount: number; start_date: string; end_date: string | null }
/** A saved fund with its units and value worked out from the stored NAV history. Figures are null without NAV data. */
export interface PortfolioMf {
  id: number; scheme_code: string; scheme_name: string; kind: MfKind; amount: number; start_date: string; end_date: string | null;
  plan: string | null; option_type: string | null; category: string | null;
  invested: number | null; units: number | null; current_value: number | null; returns: number | null; returns_pct: number | null;
  xirr_pct: number | null; installments: number; last_nav: number | null; last_nav_date: string | null; active_sip: boolean;
}
export interface MfTotals { invested: number; current_value: number; returns: number; returns_pct: number | null; xirr_pct: number | null }
export interface MfListing { holdings: PortfolioMf[]; totals: MfTotals }
/** What the user types in for a dividend: the stock, the payment date, what reached the account, and any TDS taken on top. */
export interface DividendDraft { symbol: string; pay_date: string; amount: number; tds: number }
export interface PortfolioDividend extends DividendDraft { id: number; company: string | null }
export interface DividendSummary {
  received: number; tds: number; gross: number; this_fy: number; this_fy_label: string;
  by_fy: { fy: string; received: number; tds: number }[];
  by_symbol: { symbol: string; received: number }[];
}
export interface DividendListing { dividends: PortfolioDividend[]; summary: DividendSummary }
export interface PriceSyncStart { status: "up_to_date" | "started"; as_of?: string; checked?: number; job_id?: string; total?: number; done?: number }
export interface PriceSyncJob {
  status: "queued" | "running" | "done" | "error"; total: number; done: number;
  prices: number; updated_symbols: number; navs: number; no_data: string[]; as_of: string; error?: string;
}
export interface HealthSettings { max_position_pct: number; band_pp: number; targets: Record<string, number> }
export interface HealthPosition { symbol: string; kind: HoldingKind; weight_pct: number; value: number; over_limit: boolean; excess_value: number; shares_to_trim: number }
export interface HealthAllocation {
  key: string; label: string; value: number; current_pct: number; target_pct: number | null; diff_pp: number | null;
  status: "within" | "over" | "under" | "no_target"; move: number | null;
}
export interface HealthTrend {
  symbol: string; kind: HoldingKind; weight_pct: number; bars: number; last: number | null; sma50: number | null; sma200: number | null;
  above_sma50: boolean | null; above_sma200: boolean | null; from_high_pct: number | null; return_1y_pct: number | null; deep_drawdown: boolean;
}
export interface HealthReport {
  total_value: number; settings: HealthSettings;
  concentration: { positions: HealthPosition[]; top5_pct: number; effective_holdings: number; over_limit: number; max_pct: number };
  allocation: HealthAllocation[]; trend: HealthTrend[];
  summary: { stocks: number; below_sma200: number; with_sma200: number; deep_drawdown: number; types_out_of_band: number };
}
export interface DataDataset { key: string; label: string; applies_to: string; total: number; stored: number; stale: number; newest: string | null }
export interface DataCoverage { datasets: DataDataset[]; up_to_date: boolean }
export interface DataSyncStart { status: "up_to_date" | "started"; job_id?: string; checked?: number }
export interface DataSyncStep {
  key: string; label: string; total: number; done: number; updated: number; rows: number;
  status: "pending" | "running" | "done" | "skipped"; no_data: string[]; failed: string[];
}
export interface DataSyncJob { status: "queued" | "running" | "done" | "error"; current: string | null; error: string | null; steps: DataSyncStep[] }
export interface PortfolioFundamentalsRow {
  symbol: string; as_of: string | null; sector: string | null;
  pe: number | null; forward_pe: number | null; pb: number | null; roe_pct: number | null; debt_to_equity: number | null;
  profit_margin_pct: number | null; dividend_yield_pct: number | null; market_cap: number | null;
  quarter: { period: string; revenue: number | null; ebitda: number | null; pat: number | null; revenue_yoy_pct: number | null; pat_yoy_pct: number | null } | null;
}
export type SignalState = "bullish" | "neutral" | "bearish";
export interface SignalRule { key: string; label: string; family: string; state: SignalState; detail: string; since: string | null; fresh: boolean; counts: boolean }
export interface SignalFrame {
  bars: number; adx: number | null; regime: "trending" | "ranging" | "mixed" | null; rules: SignalRule[];
  votes: { bullish: number; bearish: number; neutral: number; counted: number }; lean: SignalState; as_of: string;
}
export interface SignalSizing {
  trim: { shares: number; value: number; pct: number };
  cost_out: { shares: number; value: number; possible: boolean };
  add: { shares: number; value: number; budget: number; headroom: number; limited_by_size: boolean; avg_before: number; avg_after: number; breakeven_before_pct: number | null; breakeven_after_pct: number | null };
}
export type SignalTimeframe = "1W" | "1D" | "1H";
export interface SignalRow {
  symbol: string; kind: HoldingKind; weight_pct: number; qty: number; avg_price: number; last: number; pnl_pct: number | null;
  timeframes: Record<SignalTimeframe, SignalFrame | null>; alignment: "bullish" | "bearish" | "mixed" | null;
  zone: "profit" | "recovery" | "hold"; zone_checks: { text: string; met: boolean }[]; sizing: SignalSizing;
}
export interface SignalSettings { profit_gain_pct: number; profit_rsi: number; loss_pct: number; trim_pct: number; add_budget: number }
export interface SignalsReport {
  settings: SignalSettings; max_position_pct: number; rows: SignalRow[];
  summary: { stocks: number; with_signals: number; aligned_bullish: number; aligned_bearish: number; profit_zone: number; recovery_zone: number };
}
export interface SyncJob { done: number; total: number; pct: number; status: string; current_symbol: string }
export interface CandleStat { symbol: string; candles: number; from_date: string | null; to_date: string | null }
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
export interface BacktestTradeV2 {
  entry_date: string; exit_date: string;
  entry_price: number; target_price: number; sl_price: number;
  exit_price: number; exit_reason: "target" | "sl" | "timeout" | "indicator";
  pnl: number; pnl_pct: number; shares: number;
}
export interface BacktestSymbolResult {
  ohlcv: { date: string; open: number; high: number; low: number; close: number }[];
  trades: BacktestTradeV2[];
  stats: { total_trades: number; win_rate_pct: number; total_pnl: number; avg_pnl_pct: number };
}
export interface BacktestV2Response {
  aggregate: { total_trades: number; win_rate_pct: number; total_pnl: number;
               avg_pnl_pct: number; best_symbol: string; worst_symbol: string };
  per_symbol: Record<string, BacktestSymbolResult>;
}
export interface EntryCondition { id: string; label: string; has_threshold: boolean }
export interface MatrixAlgoInput {
  id: string; label: string;
  entry_conditions: ConditionRow[]; exit_conditions: ConditionRow[];
  target_pct: number; sl_pct: number; max_bars: number;
}
export interface MatrixComboResult {
  trades: BacktestTradeV2[];
  stats: { total_trades: number; win_rate_pct: number; total_pnl: number; avg_pnl_pct: number };
  ohlcv: { date: string; open: number; high: number; low: number; close: number }[];
}
export interface MatrixResponse {
  matrix: Record<string, Record<string, MatrixComboResult>>;
  per_algo: Record<string, { label: string; total_trades: number; win_rate_pct: number; total_pnl: number; avg_pnl_pct: number }>;
  per_symbol: Record<string, { total_trades: number; win_rate_pct: number; total_pnl: number }>;
  aggregate: {
    total_trades: number; win_rate_pct: number; total_pnl: number; avg_pnl_pct: number;
    best_combo:  { symbol: string; algo_id: string; win_rate_pct: number; total_pnl: number } | null;
    worst_combo: { symbol: string; algo_id: string; win_rate_pct: number; total_pnl: number } | null;
  };
}
export interface ConditionRow { left: string; operator: string; right: string }

// ── Grid search ─────────────────────────────────────────────────────────────
export interface SweepDim {
  kind: "threshold" | "indicator_period";
  condition_index: number;
  column: string;
  values: number[];
}
export interface GridComboStats { total_trades: number; win_rate_pct: number; total_pnl: number; avg_pnl_pct: number }
export interface GridComboRow {
  combo_id: string;
  params: Record<string, number>;
  dim_values: number[];
  conditions: ConditionRow[];
  train: GridComboStats;
  test: GridComboStats | null;
  gap: { win_rate_gap: number; avg_pnl_gap: number } | null;
}
export interface GridDim { kind: string; label: string; values: number[] }
export interface GridSearchResult {
  total_combos: number;
  symbols_used: string[];
  split: { train_ratio: number; boundary_dates: Record<string, string> };
  dims: GridDim[];
  top_n: number;
  leaderboard: GridComboRow[];
}

// ── ML models ───────────────────────────────────────────────────────────────
export interface MlModelInfo { id: string; label: string; available: boolean }
export interface MlMetrics { accuracy: number; precision: number; recall: number; f1: number; roc_auc: number | null }
export interface MlConfusion { tn: number; fp: number; fn: number; tp: number }
export interface MlModelResult {
  label: string;
  error: string | null;
  train_metrics: MlMetrics | null;
  test_metrics: MlMetrics | null;
  confusion: { train: MlConfusion; test: MlConfusion } | null;
  stats: GridComboStats | null;
  per_symbol: Record<string, { trades: BacktestTradeV2[]; stats: GridComboStats }>;
  feature_importance: { feature: string; importance: number }[] | null;
}
export interface MlResult {
  dataset: {
    n_train: number; n_test: number; n_features: number; features: string[];
    pos_rate_train: number; pos_rate_test: number; split_dates: Record<string, string>;
    train_period: { start: string; end: string } | null;
    test_period: { start: string; end: string } | null;
    alt_coverage: AltCoverage;
  };
  ohlcv: Record<string, { date: string; open: number; high: number; low: number; close: number }[]>;
  baseline: { stats: GridComboStats };
  models: Record<string, MlModelResult>;
}

export interface MlRegressionMetrics { rmse: number; mae: number; r2: number | null }
export interface MlRegressorModelResult {
  label: string;
  error: string | null;
  train_metrics: MlRegressionMetrics | null;
  test_metrics: MlRegressionMetrics | null;
  feature_importance: { feature: string; importance: number }[] | null;
}
export interface MlRegressionResult {
  dataset: {
    n_train: number; n_test: number; n_features: number; features: string[];
    train_period: { start: string; end: string } | null;
    test_period: { start: string; end: string } | null;
    alt_coverage: AltCoverage;
  };
  models: Record<string, MlRegressorModelResult>;
}

export interface MlFeatureDistribution {
  counts: number[]; bin_edges: number[];
  mean: number; std: number; min: number; max: number; median: number;
}
// symbol -> % of bars that have every selected alternative-data feature; null when none selected
export type AltCoverage = Record<string, number> | null;

export interface MlEdaResult {
  error: string | null;
  n_samples: number;
  alt_coverage: AltCoverage;
  distributions: Record<string, MlFeatureDistribution>;
  correlation: { features: string[]; matrix: number[][] };
}

export interface StockScore {
  momentum: number | null;   // 0–100, rank within the picked basket (higher = stronger uptrend)
  quality: number | null;    // 0–100, null when no fundamentals synced
  quality_n: number;         // how many of the 4 fundamentals the quality score is based on
}

export interface ClusteringResult {
  clustering_error: string | null;    // clustering failed but scores are still returned
  scores: Record<string, StockScore>;
  missing_features: Record<string, string[]>;  // symbol -> features with no data (all features, not just selected)
  clusters: Record<string, number>;   // symbol -> cluster id (-1 = DBSCAN noise)
  pca: Record<string, [number, number]>;
  feature_cols: string[];
  n_clusters: number | null;
  noise_count: number | null;
  cluster_summary: Record<number, Record<string, number>> | null;  // cluster id -> {feature: mean}
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
  headline: { name: string; close: number; prev: number; change: number; change_pct: number; date?: string }[];
  sector_perf: { name: string; pct: number }[];
  nifty_hist: { date: string; close: number }[];
  indices_hist: { name: string; data: { date: string; close: number }[] }[];
  fii_latest: { date: string; fii_buy: number; fii_sell: number; fii_net: number; dii_buy: number; dii_sell: number; dii_net: number } | null;
  usdinr: { close: number; change_pct?: number; date?: string } | null;
  india_vix: { close: number; change_pct?: number; date?: string } | null;
  us_markets: { name: string; close: number; change: number; change_pct: number; date?: string }[];
  us_sectors: { name: string; close: number; change: number; change_pct: number; date?: string }[];
  global_markets: { name: string; close: number; change: number; change_pct: number; region: string; date?: string }[];
}

export interface MarketBreadthRow {
  date: string; advances?: number; declines?: number; unchanged?: number;
  new_52wk_high?: number; new_52wk_low?: number; above_200dma?: number; above_50dma?: number;
  total_turnover_cr?: number; nifty_pe?: number; nifty_pb?: number; nifty_div_yield?: number;
}

export interface NewsItem { title: string; link: string; source: string; published_at: string }

export interface TopCorrelatedItem {
  symbol: string; company_name: string | null;
  correlation: number; days_overlap: number;
}
export interface CorrelationMatrix { symbols: string[]; matrix: (number | null)[][]; }
export interface CommonHolderPair {
  symbol1: string; symbol2: string;
  overlap_score: number; fii_overlap: number; mf_overlap: number;
}

export interface MfCategory { bucket: string; category: string; scheme_count: number; }
export interface MfScheme {
  scheme_code: string; scheme_name: string; amc: string; category: string; bucket: string;
  plan: string; option_type: string; latest_nav: number; latest_nav_date: string; isin?: string | null;
  return_1m: number | null; return_3m: number | null; return_6m: number | null;
  return_1y: number | null; return_3y: number | null; return_5y: number | null;
  cagr_1y?: number | null; cagr_3y?: number | null; cagr_5y?: number | null;
  stockveda_score?: number | null;
}
export interface MfNavPoint { date: string; nav: number; }
export interface MfRollingCagrPoint { date: string; cagr: number; }
export interface MfRisk {
  volatility_annualized_pct: number | null;
  sharpe: number | null;
  sortino: number | null;
  max_drawdown_pct: number | null;
  risk_free_rate_pct: number;
  beta: number | null;
  alpha_annualized_pct: number | null;
  r_squared: number | null;
  n_obs?: number;
  benchmark: string;
  benchmark_type: string;
  lookback_days_used: number;
  rolling_3y_cagr: MfRollingCagrPoint[];
  note?: string;
}
export interface MfSchemeDetail {
  meta: MfScheme;
  latest_nav: number; latest_nav_date: string;
  return_1m: number | null; return_3m: number | null; return_6m: number | null;
  return_1y: number | null; return_3y: number | null; return_5y: number | null;
  cagr_1y: number | null; cagr_3y: number | null; cagr_5y: number | null;
  risk: MfRisk;
  nav_history: MfNavPoint[];
}
export interface MfSipResult {
  invested: number; current_value: number; units: number;
  xirr: number | null; n_installments: number; start_date: string; end_date: string;
}
export interface MfProjection {
  drift_annualized: number; volatility_annualized: number;
  horizon_days: number; n_simulations: number;
  percentile_paths: { p5: number[]; p50: number[]; p95: number[] };
  last_nav: number; as_of_date: string; lookback_days_used: number;
}

// ── API functions ──────────────────────────────────────────────────────────

export interface TimeframeInfo {
  key: string;
  kind: "intraday" | "daily";
  base_interval: string;
  bars_per_day: number;
  max_lookback_days: number | null;
}

/** A long / short trade box saved from the Charts "Trade plot" mode. Times are the exchange wall clock, "YYYY-MM-DDTHH:MM:SS". */
export interface PlottedTrade {
  id: number;
  symbol: string;
  side: "long" | "short";
  entry_time: string;
  end_time: string;
  entry_price: number;
  stop_loss: number;
  target: number;
  qty: number | null;
  note: string;
  created_at: string;
  updated_at: string;
}
export type PlotDraft = Omit<PlottedTrade, "id" | "created_at" | "updated_at">;

/** A line or rectangle drawn on a chart. Two anchors (time + price); a horizontal line keeps the first price at both ends. */
export interface ChartDrawing {
  id: number;
  symbol: string;
  kind: "line" | "hline" | "rect";
  time1: string;
  price1: number;
  time2: string;
  price2: number;
  color: string;
  created_at: string;
  updated_at: string;
}
export type DrawingDraft = Omit<ChartDrawing, "id" | "created_at" | "updated_at">;

export interface TimeframeCandles {
  interval: string;
  bars: (Candle)[];
  status: { earliest: string | null; latest: string | null; total_bars: number };
  missing: { before: number; after: number; total: number };
  clamped_from: string | null;
  max_lookback_days: number | null;
  fetch: { kind: "intraday" | "daily"; interval: string; days: number };
}

export const api = {
  getMfCategories: () => apiFetch<MfCategory[]>(`/mutual-fund/categories`),

  getMfSchemes: (params: { bucket?: string; category?: string; q?: string; limit?: number; sort?: string }) => {
    const p = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => { if (v != null && v !== "") p.set(k, String(v)); });
    return apiFetch<MfScheme[]>(`/mutual-fund/schemes?${p}`);
  },

  getMfSchemeDetail: (schemeCode: string) =>
    apiFetch<MfSchemeDetail>(`/mutual-fund/scheme/${schemeCode}`),

  getMfSip: (schemeCode: string, req: { monthly_amount: number; start_date: string; end_date?: string }) =>
    apiFetch<MfSipResult>(`/mutual-fund/scheme/${schemeCode}/sip`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
    }),

  getMfProjection: (schemeCode: string, params: { horizon_days?: number; n_simulations?: number; lookback_days?: number }) => {
    const p = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => { if (v != null) p.set(k, String(v)); });
    return apiFetch<MfProjection>(`/mutual-fund/scheme/${schemeCode}/projection?${p}`);
  },

  getCandleStats: (symbols: string[]) =>
    apiFetch<CandleStat[]>(`/stock/candle-stats?symbols=${symbols.map(encodeURIComponent).join(",")}`),

  searchSymbols: (q: string) =>
    apiFetch<{ symbol: string; name: string }[]>(`/stock/search?q=${encodeURIComponent(q)}`),

  getTopCorrelated: (symbol: string, days = 90, top = 15) =>
    apiFetch<TopCorrelatedItem[]>(`/stock/top-correlated/${symbol}?days=${days}&top=${top}`),

  getCorrelationMatrix: (symbols: string[], days = 90) =>
    apiFetch<CorrelationMatrix>(`/stock/correlation-matrix?symbols=${symbols.join(",")}&days=${days}`),

  getCommonHolders: (symbols: string[]) =>
    apiFetch<CommonHolderPair[]>(`/stock/common-holders?symbols=${symbols.join(",")}`),

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

  getBankFinancials: (symbol: string, consolidated = false) =>
    apiFetch<BankFinancial[]>(`/stock/bank-financials/${symbol}?consolidated=${consolidated}`),

  getRatios: (symbol: string) =>
    apiFetch<StockRatios>(`/stock/ratios/${symbol}`),

  getBetaHistory: (symbol: string, params: { index?: string; window_days?: number; from_date?: string; to_date?: string } = {}) => {
    const p = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => { if (v != null) p.set(k, String(v)); });
    return apiFetch<{ symbol: string; index_symbol: string; window_days: number; history: { date: string; beta: number }[] }>(
      `/stock/beta-history/${symbol}?${p}`
    );
  },

  getIndexFundIndices: () => apiFetch<{ indices: string[] }>(`/index-fund/indices`),

  getIndexWeights: (indexName: string, forceRefresh = false) =>
    apiFetch<{
      index_name: string; source: string; total_weight_pct: number;
      constituents: { symbol: string; weight_pct: number; market_cap_cr: number | null; source: string }[];
    }>(`/index-fund/weights/${encodeURIComponent(indexName)}?force_refresh=${forceRefresh}`),

  replicateIndex: (req: { index_name: string; capital: number; rebalance_frequency?: string; from_date?: string; to_date?: string }) =>
    apiFetch<{
      index_name: string; capital: number; total_allocated: number; cash_remaining: number;
      constituents: { symbol: string; weight_pct: number; target_allocation: number; price: number; shares: number; actual_allocation: number; source: string }[];
      value_path: { date: string; value: number }[];
      value_path_coverage: { included_symbols: number; excluded_symbols: string[]; note: string | null };
      tracking_error: { tracking_error_annualized_pct?: number; correlation?: number; cumulative_drift_pct?: number };
      source: string;
    }>(`/index-fund/replicate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
    }),

  getSectorCompare: (symbol: string, days = 252) =>
    apiFetch<SectorCompareData>(`/stock/sector-compare/${symbol}?days=${days}`),

  getNews: (symbol: string) =>
    apiFetch<NewsItem[]>(`/stock/news/${symbol}`),

  getHolders: (symbol: string) =>
    apiFetch<Holder[]>(`/stock/holders/${symbol}`),

  getCorporateActions: (symbol: string) =>
    apiFetch<CorporateAction[]>(`/stock/corporate-actions/${symbol}`),

  getInsiderTrades: (symbol: string) =>
    apiFetch<InsiderTrade[]>(`/stock/insider-trades/${symbol}`),


  screenStocks: (conditions: ScreenerCondition[], limit = 200, symbols?: string[]) =>
    apiFetch<{ count: number; results: ScreenerResult[] }>("/screener/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conditions, limit, symbols: symbols?.length ? symbols : undefined }),
    }),

  getScreenerUniversePresets: () =>
    apiFetch<ScreenerPresetOption[]>("/screener/presets"),

  getScreenerMetrics: () =>
    apiFetch<{ metrics: string[]; operators: string[] }>("/screener/metrics"),

  startSync: (symbols: string[], candle_days: number) =>
    apiFetch<{ job_id: string; total: number }>("/screener/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbols, candle_days }),
    }),

  getSyncJob: (jobId: string) =>
    apiFetch<SyncJob>(`/screener/sync/${jobId}`),

  createWatchlist: (name: string, symbols: string[]) =>
    apiFetch<Watchlist>("/screener/watchlists", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, symbols }),
    }),

  getWatchlists: () =>
    apiFetch<Watchlist[]>("/screener/watchlists"),

  deleteWatchlist: (id: number) =>
    apiFetch<{ ok: boolean }>(`/screener/watchlists/${id}`, { method: "DELETE" }),

  getPortfolios: () => apiFetch<PortfolioSummary[]>("/portfolios"),
  getPortfolio: (id: number) => apiFetch<PortfolioDetail>(`/portfolios/${id}`),
  createPortfolio: (name: string) =>
    apiFetch<PortfolioDetail>("/portfolios", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) }),
  createPortfolioFromWatchlist: (watchlistId: number) =>
    apiFetch<PortfolioDetail>("/portfolios/from-watchlist", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ watchlist_id: watchlistId }),
    }),
  renamePortfolio: (id: number, name: string) =>
    apiFetch<PortfolioDetail>(`/portfolios/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) }),
  deletePortfolio: (id: number) => apiFetch<{ ok: boolean }>(`/portfolios/${id}`, { method: "DELETE" }),
  addHolding: (id: number, body: HoldingDraft) =>
    apiFetch<PortfolioDetail>(`/portfolios/${id}/holdings`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  updateHolding: (id: number, holdingId: number, body: HoldingDraft) =>
    apiFetch<PortfolioDetail>(`/portfolios/${id}/holdings/${holdingId}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  deleteHolding: (id: number, holdingId: number) =>
    apiFetch<PortfolioDetail>(`/portfolios/${id}/holdings/${holdingId}`, { method: "DELETE" }),

  getFds: (portfolioId: number) => apiFetch<FdListing>(`/portfolios/${portfolioId}/fds`),
  addFd: (portfolioId: number, body: FdDraft) =>
    apiFetch<FdListing>(`/portfolios/${portfolioId}/fds`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  updateFd: (portfolioId: number, id: number, body: FdDraft) =>
    apiFetch<FdListing>(`/portfolios/${portfolioId}/fds/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  deleteFd: (portfolioId: number, id: number) => apiFetch<FdListing>(`/portfolios/${portfolioId}/fds/${id}`, { method: "DELETE" }),

  getAssets: (portfolioId: number) => apiFetch<AssetListing>(`/portfolios/${portfolioId}/assets`),
  addAsset: (portfolioId: number, body: AssetDraft) =>
    apiFetch<AssetListing>(`/portfolios/${portfolioId}/assets`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  updateAsset: (portfolioId: number, id: number, body: AssetDraft) =>
    apiFetch<AssetListing>(`/portfolios/${portfolioId}/assets/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  deleteAsset: (portfolioId: number, id: number) => apiFetch<AssetListing>(`/portfolios/${portfolioId}/assets/${id}`, { method: "DELETE" }),
  setUsdInr: (portfolioId: number, rate: number | null) =>
    apiFetch<AssetListing>(`/portfolios/${portfolioId}/assets/usd-inr`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ usd_inr: rate }) }),

  getPortfolioTotal: (portfolioId: number) => apiFetch<PortfolioTotal>(`/portfolios/${portfolioId}/total`),

  getMf: (portfolioId: number) => apiFetch<MfListing>(`/portfolios/${portfolioId}/mf`),
  addMf: (portfolioId: number, body: MfDraft) =>
    apiFetch<MfListing>(`/portfolios/${portfolioId}/mf`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  updateMf: (portfolioId: number, id: number, body: MfDraft) =>
    apiFetch<MfListing>(`/portfolios/${portfolioId}/mf/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  deleteMf: (portfolioId: number, id: number) => apiFetch<MfListing>(`/portfolios/${portfolioId}/mf/${id}`, { method: "DELETE" }),

  getDividends: (portfolioId: number) => apiFetch<DividendListing>(`/portfolios/${portfolioId}/dividends`),
  addDividend: (portfolioId: number, body: DividendDraft) =>
    apiFetch<DividendListing>(`/portfolios/${portfolioId}/dividends`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  updateDividend: (portfolioId: number, id: number, body: DividendDraft) =>
    apiFetch<DividendListing>(`/portfolios/${portfolioId}/dividends/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  deleteDividend: (portfolioId: number, id: number) => apiFetch<DividendListing>(`/portfolios/${portfolioId}/dividends/${id}`, { method: "DELETE" }),

  startPriceSync: (portfolioId: number) => apiFetch<PriceSyncStart>(`/portfolios/${portfolioId}/prices/sync`, { method: "POST" }),
  getPriceSync: (portfolioId: number, jobId: string) => apiFetch<PriceSyncJob>(`/portfolios/${portfolioId}/prices/sync/${jobId}`),

  getHealth: (portfolioId: number) => apiFetch<HealthReport>(`/portfolios/${portfolioId}/health`),
  putHealthTargets: (portfolioId: number, body: HealthSettings) =>
    apiFetch<HealthSettings>(`/portfolios/${portfolioId}/health/targets`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  startPriceHistory: (portfolioId: number) => apiFetch<PriceSyncStart>(`/portfolios/${portfolioId}/prices/history`, { method: "POST" }),

  getDataCoverage: (portfolioId: number) => apiFetch<DataCoverage>(`/portfolios/${portfolioId}/data/coverage`),
  startDataSync: (portfolioId: number) => apiFetch<DataSyncStart>(`/portfolios/${portfolioId}/data/sync`, { method: "POST" }),
  getDataSync: (portfolioId: number, jobId: string) => apiFetch<DataSyncJob>(`/portfolios/${portfolioId}/data/sync/${jobId}`),
  getPortfolioFundamentals: (portfolioId: number) => apiFetch<{ rows: PortfolioFundamentalsRow[] }>(`/portfolios/${portfolioId}/data/fundamentals`),

  getSignals: (portfolioId: number) => apiFetch<SignalsReport>(`/portfolios/${portfolioId}/signals`),
  putSignalSettings: (portfolioId: number, body: SignalSettings) =>
    apiFetch<SignalSettings>(`/portfolios/${portfolioId}/signals/settings`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),

  deleteAllStockData: () =>
    apiFetch<{ ok: boolean; message: string }>("/screener/stock-data", { method: "DELETE" }),

  getSavedScreeners: () =>
    apiFetch<SavedScreener[]>("/screener/saved-screeners"),

  createSavedScreener: (name: string, conditions: ScreenerCondition[]) =>
    apiFetch<SavedScreener>("/screener/saved-screeners", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, conditions }),
    }),

  deleteSavedScreener: (id: number) =>
    apiFetch<{ ok: boolean }>(`/screener/saved-screeners/${id}`, { method: "DELETE" }),

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

  getEntryConditions: () =>
    apiFetch<EntryCondition[]>("/backtest/entry-conditions"),

  getBacktestIndicators: () =>
    apiFetch<{ indicators: string[]; operators: string[] }>("/backtest/indicators"),

  runBacktestV2: (params: {
    symbols: string[]; from_date: string; to_date: string;
    entry_conditions: ConditionRow[]; exit_conditions: ConditionRow[];
    target_pct: number; sl_pct: number; max_bars: number; capital_per_trade: number;
    timeframe?: string;
  }) =>
    apiFetch<BacktestV2Response>("/backtest/run-v2", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    }),

  runBacktestMatrix: (params: {
    symbols: string[]; algos: MatrixAlgoInput[];
    from_date: string; to_date: string; capital_per_trade: number; timeframe?: string;
  }) =>
    apiFetch<MatrixResponse>("/backtest/run-matrix", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    }),


  getTradePlots: (symbol?: string) =>
    apiFetch<PlottedTrade[]>(`/trade-plots${symbol ? `?symbol=${encodeURIComponent(symbol)}` : ""}`),
  createTradePlot: (body: PlotDraft) =>
    apiFetch<PlottedTrade>("/trade-plots", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    }),
  updateTradePlot: (id: number, body: PlotDraft) =>
    apiFetch<PlottedTrade>(`/trade-plots/${id}`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    }),
  deleteTradePlot: (id: number) => apiFetch<{ ok: boolean }>(`/trade-plots/${id}`, { method: "DELETE" }),

  getDrawings: (symbol: string) => apiFetch<ChartDrawing[]>(`/drawings?symbol=${encodeURIComponent(symbol)}`),
  createDrawing: (body: DrawingDraft) =>
    apiFetch<ChartDrawing>("/drawings", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    }),
  updateDrawing: (id: number, body: DrawingDraft) =>
    apiFetch<ChartDrawing>(`/drawings/${id}`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    }),
  deleteDrawing: (id: number) => apiFetch<{ ok: boolean }>(`/drawings/${id}`, { method: "DELETE" }),

  getTimeframes: () => apiFetch<TimeframeInfo[]>("/intraday/timeframes"),
  getTimeframeCandles: (symbol: string, interval: string, range: { from?: string; to?: string; limit?: number } = {}) => {
    const p = new URLSearchParams({ interval });
    if (range.from) p.set("from_date", range.from);
    if (range.to) p.set("to_date", range.to);
    if (range.limit) p.set("limit", String(range.limit));
    return apiFetch<TimeframeCandles>(`/intraday/candles/${encodeURIComponent(symbol)}?${p}`);
  },
  fetchIntraday: (symbol: string, interval: string, days: number) =>
    apiFetch<{ job_id: string; symbol: string; interval: string; days: number; max_lookback_days: number }>(
      `/intraday/fetch?symbol=${symbol}&interval=${interval}&days=${days}`, { method: "POST" }
    ),
  intradayFetchJob: (jobId: string) =>
    apiFetch<{ total: number; done: number; inserted: number; status: string; error?: string }>(`/intraday/fetch-job/${jobId}`),
  fetchIntradayBatch: (symbols: string[], interval: string, days: number) =>
    apiFetch<{ job_id: string; symbols: string[]; interval: string; days: number; max_lookback_days: number }>(
      `/intraday/fetch-batch?symbols=${symbols.map(encodeURIComponent).join(",")}&interval=${interval}&days=${days}`,
      { method: "POST" }
    ),
  intradayDataStatusBatch: (symbols: string[], interval: string) =>
    apiFetch<Record<string, { earliest_datetime: string | null; latest_datetime: string | null; total_bars: number }>>(
      `/intraday/data-status-batch?symbols=${symbols.map(encodeURIComponent).join(",")}&interval=${interval}`
    ),

  getGridSweepables: () =>
    apiFetch<{ period_columns: string[]; max_combos: number; max_dims: number; max_values_per_dim: number; max_symbols: number }>(
      "/backtest/grid-sweepables"
    ),
  getMlModels: () => apiFetch<MlModelInfo[]>("/backtest/ml-models"),
  getMlRegressors: () => apiFetch<MlModelInfo[]>("/backtest/ml-regressors"),
  getMlFeatures: () => apiFetch<{ features: string[]; alternative: string[] }>("/backtest/ml-features"),
  runMlEda: (params: {
    symbols: string[]; from_date: string; to_date: string;
    entry_conditions: ConditionRow[]; sample_mode: "entry_signals" | "all_bars";
    timeframe: string; features?: string[] | null;
  }) =>
    apiFetch<MlEdaResult>("/backtest/ml-eda", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    }),
  getClusteringFeatures: () => apiFetch<{ trend: string[]; value_quality: string[] }>("/backtest/clustering-features"),
  runClustering: (params: {
    symbols: string[]; from_date: string; to_date: string;
    algo: "kmeans" | "hierarchical" | "dbscan"; k: number; eps: number; min_samples: number;
    lookback_days: number; timeframe: string; features?: string[] | null;
  }) =>
    apiFetch<ClusteringResult>("/backtest/run-clustering", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    }),

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
  getMarketBreadth: (limit = 1) =>
    apiFetch<MarketBreadthRow[]>(`/macro/market-breadth?limit=${limit}`),
  getMarketNews: () => apiFetch<NewsItem[]>("/macro/market-news"),
  getGlobalNews: () => apiFetch<NewsItem[]>("/macro/global-news"),
  getIndexOHLCV: (indexName: string, limit = 252) =>
    apiFetch<{ date: string; index_name: string; open: number; high: number; low: number; close: number }[]>(
      `/macro/indices?index_name=${encodeURIComponent(indexName)}&limit=${limit}`
    ),
  getIndexCandlePatterns: (indexName: string) =>
    apiFetch<import("./candlePatterns").PatternHit[]>(`/v1/candle-patterns/index/${encodeURIComponent(indexName)}`),
  getFiiDiiHistory: (limit = 252) =>
    apiFetch<{ date: string; fii_buy: number; fii_sell: number; fii_net: number; dii_buy: number; dii_sell: number; dii_net: number }[]>(
      `/macro/fii-dii?limit=${limit}`
    ),

  dashboardStatus: () =>
    apiFetch<{ populated: boolean; index_rows: number }>("/macro/dashboard/status"),

  // First-run seeding for an empty DB (indices + currency via yfinance, FII/DII best-effort).
  // No-op once indices exist, so it's safe to call on page load.
  bootstrap: () =>
    apiFetch<{ status: string; index_rows: number; sources?: Record<string, string> }>(
      "/macro/bootstrap", { method: "POST" }
    ),

  getCandlePatterns: (symbol: string, limit = 500) =>
    apiFetch<import("./candlePatterns").PatternHit[]>(`/v1/candle-patterns/${symbol}?limit=${limit}`),

  syncBulkDeals: (days = 30) =>
    apiFetch<{ synced: number; from: string; to: string }>(`/stock/bulk-deals/sync?days=${days}`),
  getBulkDeals: (symbols: string[], days = 30) =>
    apiFetch<{
      data: { date: string; symbol: string; scrip_name: string; client_name: string; client_symbol: string | null; buy_sell: string; quantity: number; price: number; deal_type: string }[];
      date_range: { from: string; to: string } | null;
    }>(`/stock/bulk-deals?symbols=${symbols.join(",")}&days=${days}`),

  getOutlook: (symbol: string) =>
    apiFetch<{
      score: number; label: string;
      components: Record<string, number>;
      indicators: { rsi: number; macd_hist: number | null; sma20_diff_pct: number | null; close: number };
      recent_patterns: string[];
      pattern_stats: {
        pattern: string; label: string; name: string; occurrences: number;
        up5d_pct: number; up10d_pct: number; up20d_pct: number; avg_move5d: number;
      }[];
    }>(`/v1/outlook/${symbol}`),

  getMarkovAnalysis: (symbol: string, params: {
    from_date?: string; to_date?: string; n_states?: number;
    flat_band_pct?: number; lookback_days?: number; horizon_days?: number;
  }) => {
    const p = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => { if (v != null) p.set(k, String(v)); });
    return apiFetch<{
      symbol: string; n_states: number; current_state: number;
      transition_matrix: number[][];
      projection: Array<Record<string, number>>;
      history: Array<{ date: string; state: number }>;
      lookback_days_used: number;
    }>(`/v1/markov/${symbol}?${p}`);
  },

  getMonteCarloAnalysis: (symbol: string, params: {
    from_date?: string; to_date?: string; n_simulations?: number;
    horizon_days?: number; lookback_days?: number; seed?: number;
  }) => {
    const p = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => { if (v != null) p.set(k, String(v)); });
    return apiFetch<{
      symbol: string; drift_annualized: number; volatility_annualized: number;
      horizon_days: number; n_simulations: number;
      percentile_paths: { p5: number[]; p50: number[]; p95: number[] };
      last_price: number; as_of_date: string; lookback_days_used: number;
    }>(`/v1/monte-carlo/${symbol}?${p}`);
  },
};
