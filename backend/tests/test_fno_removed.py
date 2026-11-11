"""Futures and options are no longer stored; the backtests read stocks and indices from the cash tables."""

from pathlib import Path

import duckdb
import pytest

from backend.db import connection
from backend.routes.backtest import _load_price_df

SCHEMA = (Path(connection.__file__).parent / "schema.sql").read_text()


@pytest.fixture
def db():
    conn = duckdb.connect()
    conn.execute(SCHEMA)
    return conn


def _tables(conn):
    return {r[0] for r in conn.execute("SHOW TABLES").fetchall()}


def test_new_databases_have_no_fno_tables(db):
    assert not {t for t in _tables(db) if t.startswith("fno_")}


def test_the_schema_drops_fno_tables_left_in_old_databases():
    conn = duckdb.connect()
    conn.execute("CREATE TABLE fno_ohlcv (symbol VARCHAR)")
    conn.execute("CREATE TABLE fno_oi (date DATE)")
    conn.execute(SCHEMA)
    assert not {t for t in _tables(conn) if t.startswith("fno_")}


def test_schema_can_run_twice(db):
    db.execute(SCHEMA)


def test_backtests_can_load_an_index_from_the_cash_tables(db):
    db.execute("INSERT INTO index_ohlcv (date, index_name, open, high, low, close) VALUES ('2026-01-02', 'NIFTY 50', 10, 12, 9, 11)")
    df = _load_price_df(db, "NIFTY", "2026-01-01", "2026-01-31")
    assert list(df.columns) == ["date", "open", "high", "low", "close", "volume"]
    assert len(df) == 1 and df.iloc[0].close == 11 and df.iloc[0].volume == 0


def test_backtests_still_load_stocks(db):
    db.execute("INSERT INTO stock_ohlcv (date, symbol, open, high, low, close, volume) VALUES ('2026-01-02', 'TCS', 1, 3, 1, 2, 100)")
    df = _load_price_df(db, "TCS", "2026-01-01", "2026-01-31")
    assert len(df) == 1 and df.iloc[0].volume == 100
