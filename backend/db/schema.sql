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
    isin VARCHAR
);

CREATE TABLE IF NOT EXISTS mf_nav (
    date DATE,
    scheme_code VARCHAR,
    scheme_name VARCHAR,
    isin VARCHAR,
    nav DOUBLE,
    PRIMARY KEY (date, scheme_code)
);
