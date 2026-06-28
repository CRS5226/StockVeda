CREATE TABLE IF NOT EXISTS sync_log (
    source VARCHAR PRIMARY KEY,
    last_synced_at TIMESTAMP,
    last_date_fetched DATE,
    status VARCHAR,
    records_added INTEGER,
    error_message VARCHAR
);

CREATE TABLE IF NOT EXISTS stock_ohlcv (
    date DATE,
    symbol VARCHAR,
    open DOUBLE,
    high DOUBLE,
    low DOUBLE,
    close DOUBLE,
    volume BIGINT,
    PRIMARY KEY (date, symbol)
);

CREATE TABLE IF NOT EXISTS index_ohlcv (
    date DATE,
    index_name VARCHAR,
    open DOUBLE,
    high DOUBLE,
    low DOUBLE,
    close DOUBLE,
    PRIMARY KEY (date, index_name)
);

CREATE TABLE IF NOT EXISTS fii_dii_flows (
    date DATE PRIMARY KEY,
    fii_buy DOUBLE,
    fii_sell DOUBLE,
    fii_net DOUBLE,
    dii_buy DOUBLE,
    dii_sell DOUBLE,
    dii_net DOUBLE
);

CREATE TABLE IF NOT EXISTS india_vix (
    date DATE PRIMARY KEY,
    open DOUBLE,
    high DOUBLE,
    low DOUBLE,
    close DOUBLE
);

CREATE TABLE IF NOT EXISTS macro_monthly (
    date DATE,
    metric VARCHAR,
    value DOUBLE,
    unit VARCHAR,
    PRIMARY KEY (date, metric)
);

CREATE TABLE IF NOT EXISTS macro_quarterly (
    date DATE,
    metric VARCHAR,
    value DOUBLE,
    unit VARCHAR,
    PRIMARY KEY (date, metric)
);

CREATE TABLE IF NOT EXISTS stock_delivery (
    date DATE,
    symbol VARCHAR,
    delivery_qty BIGINT,
    delivery_pct DOUBLE,
    PRIMARY KEY (date, symbol)
);

CREATE TABLE IF NOT EXISTS stock_fundamentals (
    symbol VARCHAR,
    period DATE,
    period_type VARCHAR,
    is_consolidated BOOLEAN,
    revenue DOUBLE,
    gross_profit DOUBLE,
    ebitda DOUBLE,
    ebit DOUBLE,
    pbt DOUBLE,
    pat DOUBLE,
    eps_basic DOUBLE,
    eps_diluted DOUBLE,
    total_assets DOUBLE,
    total_equity DOUBLE,
    total_debt DOUBLE,
    cash DOUBLE,
    cfo DOUBLE,
    cfi DOUBLE,
    cff DOUBLE,
    capex DOUBLE,
    PRIMARY KEY (symbol, period, period_type, is_consolidated)
);

CREATE TABLE IF NOT EXISTS bank_financials (
    symbol VARCHAR,
    period DATE,
    period_type VARCHAR,      -- 'Q' quarterly, 'YTD' year-to-date (Apr–Dec etc.)
    is_consolidated BOOLEAN,
    -- Income (INR full rupees)
    interest_earned DOUBLE,
    interest_expended DOUBLE,
    nii DOUBLE,
    other_income DOUBLE,
    total_income DOUBLE,
    operating_expenses DOUBLE,
    ppop DOUBLE,
    provisions DOUBLE,
    pbt DOUBLE,
    tax DOUBLE,
    pat DOUBLE,
    eps DOUBLE,
    -- Asset quality
    gnpa DOUBLE,
    net_npa DOUBLE,
    gnpa_pct DOUBLE,
    net_npa_pct DOUBLE,
    -- Capital & returns
    crar_pct DOUBLE,
    cet1_pct DOUBLE,
    roa DOUBLE,
    PRIMARY KEY (symbol, period, period_type, is_consolidated)
);

CREATE TABLE IF NOT EXISTS shareholding (
    symbol VARCHAR,
    period DATE,
    promoter_pct DOUBLE,
    promoter_pledge_pct DOUBLE,
    fii_pct DOUBLE,
    dii_pct DOUBLE,
    mf_pct DOUBLE,
    retail_pct DOUBLE,
    government_pct DOUBLE,
    total_shareholders BIGINT,
    PRIMARY KEY (symbol, period)
);

CREATE TABLE IF NOT EXISTS corporate_actions (
    symbol VARCHAR,
    ex_date DATE,
    action_type VARCHAR,
    value DOUBLE,
    ratio VARCHAR,
    record_date DATE,
    PRIMARY KEY (symbol, ex_date, action_type)
);

CREATE TABLE IF NOT EXISTS fno_ohlcv (
    date DATE,
    symbol VARCHAR,
    instrument VARCHAR,
    expiry DATE,
    strike DOUBLE,
    option_type VARCHAR,
    open DOUBLE,
    high DOUBLE,
    low DOUBLE,
    close DOUBLE,
    settle_price DOUBLE,
    contracts BIGINT,
    open_interest BIGINT,
    oi_change BIGINT,
    PRIMARY KEY (date, symbol, instrument, expiry, strike, option_type)
);

CREATE TABLE IF NOT EXISTS fno_oi (
    date DATE,
    participant_type VARCHAR,
    instrument VARCHAR,
    long_oi BIGINT,
    short_oi BIGINT,
    net_oi BIGINT,
    PRIMARY KEY (date, participant_type, instrument)
);

CREATE TABLE IF NOT EXISTS bulk_block_deals (
    date DATE,
    symbol VARCHAR,
    deal_type VARCHAR,
    client_name VARCHAR,
    transaction_type VARCHAR,
    quantity BIGINT,
    price DOUBLE,
    PRIMARY KEY (date, symbol, deal_type, client_name)
);

CREATE TABLE IF NOT EXISTS insider_trades (
    symbol VARCHAR,
    person_name VARCHAR,
    person_category VARCHAR,
    trade_date DATE,
    transaction_type VARCHAR,
    quantity BIGINT,
    price DOUBLE,
    filing_date DATE,
    PRIMARY KEY (symbol, person_name, trade_date, transaction_type)
);

CREATE TABLE IF NOT EXISTS currency_ohlcv (
    date DATE,
    pair VARCHAR,
    open DOUBLE,
    high DOUBLE,
    low DOUBLE,
    close DOUBLE,
    PRIMARY KEY (date, pair)
);

CREATE TABLE IF NOT EXISTS commodity_prices (
    date DATE,
    commodity VARCHAR,
    price DOUBLE,
    unit VARCHAR,
    currency VARCHAR,
    PRIMARY KEY (date, commodity)
);

CREATE TABLE IF NOT EXISTS rbi_rates (
    date DATE,
    repo_rate DOUBLE,
    reverse_repo DOUBLE,
    sdf_rate DOUBLE,
    msf_rate DOUBLE,
    bank_rate DOUBLE,
    crr_pct DOUBLE,
    slr_pct DOUBLE,
    gsec_10yr DOUBLE,
    PRIMARY KEY (date)
);

CREATE TABLE IF NOT EXISTS market_breadth (
    date DATE PRIMARY KEY,
    advances INTEGER,
    declines INTEGER,
    unchanged INTEGER,
    new_52wk_high INTEGER,
    new_52wk_low INTEGER,
    above_200dma INTEGER,
    above_50dma INTEGER,
    total_turnover_cr DOUBLE,
    nifty_pe DOUBLE,
    nifty_pb DOUBLE,
    nifty_div_yield DOUBLE
);

CREATE TABLE IF NOT EXISTS nse_symbols (
    symbol VARCHAR PRIMARY KEY,
    company_name VARCHAR,
    series VARCHAR,
    isin VARCHAR,
    face_value DOUBLE
);

CREATE TABLE IF NOT EXISTS mf_nav (
    date DATE,
    scheme_code VARCHAR,
    scheme_name VARCHAR,
    isin VARCHAR,
    nav DOUBLE,
    PRIMARY KEY (date, scheme_code)
);

CREATE TABLE IF NOT EXISTS stock_technical_cache (
    symbol      VARCHAR,
    date        DATE,
    sma_20      DOUBLE,
    sma_50      DOUBLE,
    sma_200     DOUBLE,
    ema_20      DOUBLE,
    ema_50      DOUBLE,
    rsi_14      DOUBLE,
    macd        DOUBLE,
    macd_signal DOUBLE,
    bb_upper    DOUBLE,
    bb_lower    DOUBLE,
    atr_14      DOUBLE,
    PRIMARY KEY (symbol, date)
);

CREATE TABLE IF NOT EXISTS watchlists (
    id          INTEGER,
    name        VARCHAR NOT NULL,
    symbols     VARCHAR[],
    created_at  TIMESTAMP DEFAULT now(),
    PRIMARY KEY (id)
);

CREATE SEQUENCE IF NOT EXISTS watchlist_id_seq START 1;

-- ── Saved Screeners ────────────────────────────────────────────────────────
CREATE SEQUENCE IF NOT EXISTS screener_id_seq START 1;
CREATE TABLE IF NOT EXISTS saved_screeners (
    id          INTEGER DEFAULT nextval('screener_id_seq'),
    name        VARCHAR NOT NULL,
    conditions  VARCHAR NOT NULL,
    created_at  TIMESTAMP DEFAULT now(),
    PRIMARY KEY (id)
);

-- ── Extend stock_technical_cache with additional indicators ────────────────
ALTER TABLE stock_technical_cache ADD COLUMN IF NOT EXISTS sma_5        DOUBLE;
ALTER TABLE stock_technical_cache ADD COLUMN IF NOT EXISTS sma_10       DOUBLE;
ALTER TABLE stock_technical_cache ADD COLUMN IF NOT EXISTS sma_100      DOUBLE;
ALTER TABLE stock_technical_cache ADD COLUMN IF NOT EXISTS ema_9        DOUBLE;
ALTER TABLE stock_technical_cache ADD COLUMN IF NOT EXISTS ema_12       DOUBLE;
ALTER TABLE stock_technical_cache ADD COLUMN IF NOT EXISTS ema_26       DOUBLE;
ALTER TABLE stock_technical_cache ADD COLUMN IF NOT EXISTS ema_100      DOUBLE;
ALTER TABLE stock_technical_cache ADD COLUMN IF NOT EXISTS ema_200      DOUBLE;
ALTER TABLE stock_technical_cache ADD COLUMN IF NOT EXISTS wma_20       DOUBLE;
ALTER TABLE stock_technical_cache ADD COLUMN IF NOT EXISTS vwma_20      DOUBLE;
ALTER TABLE stock_technical_cache ADD COLUMN IF NOT EXISTS rsi_9        DOUBLE;
ALTER TABLE stock_technical_cache ADD COLUMN IF NOT EXISTS rsi_21       DOUBLE;
ALTER TABLE stock_technical_cache ADD COLUMN IF NOT EXISTS macd_hist    DOUBLE;
ALTER TABLE stock_technical_cache ADD COLUMN IF NOT EXISTS stoch_k      DOUBLE;
ALTER TABLE stock_technical_cache ADD COLUMN IF NOT EXISTS stoch_d      DOUBLE;
ALTER TABLE stock_technical_cache ADD COLUMN IF NOT EXISTS willr        DOUBLE;
ALTER TABLE stock_technical_cache ADD COLUMN IF NOT EXISTS cci_20       DOUBLE;
ALTER TABLE stock_technical_cache ADD COLUMN IF NOT EXISTS roc_10       DOUBLE;
ALTER TABLE stock_technical_cache ADD COLUMN IF NOT EXISTS roc_20       DOUBLE;
ALTER TABLE stock_technical_cache ADD COLUMN IF NOT EXISTS mfi_14       DOUBLE;
ALTER TABLE stock_technical_cache ADD COLUMN IF NOT EXISTS ppo          DOUBLE;
ALTER TABLE stock_technical_cache ADD COLUMN IF NOT EXISTS trix_15      DOUBLE;
ALTER TABLE stock_technical_cache ADD COLUMN IF NOT EXISTS atr_7        DOUBLE;
ALTER TABLE stock_technical_cache ADD COLUMN IF NOT EXISTS atr_21       DOUBLE;
ALTER TABLE stock_technical_cache ADD COLUMN IF NOT EXISTS bb_width     DOUBLE;
ALTER TABLE stock_technical_cache ADD COLUMN IF NOT EXISTS bb_pct       DOUBLE;
ALTER TABLE stock_technical_cache ADD COLUMN IF NOT EXISTS std_20       DOUBLE;
ALTER TABLE stock_technical_cache ADD COLUMN IF NOT EXISTS adx_14       DOUBLE;
ALTER TABLE stock_technical_cache ADD COLUMN IF NOT EXISTS adx_pos      DOUBLE;
ALTER TABLE stock_technical_cache ADD COLUMN IF NOT EXISTS adx_neg      DOUBLE;
ALTER TABLE stock_technical_cache ADD COLUMN IF NOT EXISTS volume_sma_20 DOUBLE;
ALTER TABLE stock_technical_cache ADD COLUMN IF NOT EXISTS volume_ratio  DOUBLE;
ALTER TABLE stock_technical_cache ADD COLUMN IF NOT EXISTS cmf_20       DOUBLE;
ALTER TABLE stock_technical_cache ADD COLUMN IF NOT EXISTS high_52w     DOUBLE;
ALTER TABLE stock_technical_cache ADD COLUMN IF NOT EXISTS low_52w      DOUBLE;
ALTER TABLE stock_technical_cache ADD COLUMN IF NOT EXISTS pct_from_52w_high DOUBLE;
ALTER TABLE stock_technical_cache ADD COLUMN IF NOT EXISTS pct_from_52w_low  DOUBLE;
ALTER TABLE stock_technical_cache ADD COLUMN IF NOT EXISTS change_1d    DOUBLE;
ALTER TABLE stock_technical_cache ADD COLUMN IF NOT EXISTS change_5d    DOUBLE;
ALTER TABLE stock_technical_cache ADD COLUMN IF NOT EXISTS change_20d   DOUBLE;
