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
