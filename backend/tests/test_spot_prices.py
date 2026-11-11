"""Tests for the shared spot candle and risk-free rate helpers."""

from pathlib import Path

import duckdb
import pytest

from backend.core import rates, spot_prices

SCHEMA = (Path(spot_prices.__file__).parents[1] / "db" / "schema.sql").read_text()


@pytest.fixture
def db(monkeypatch):
    conn = duckdb.connect()
    conn.execute(SCHEMA)
    monkeypatch.setattr(spot_prices, "get_db", lambda: conn)
    monkeypatch.setattr(rates, "get_db", lambda: conn)
    return conn


def test_stock_symbol_reads_stock_ohlcv_with_text_dates(db):
    db.execute("INSERT INTO stock_ohlcv (date, symbol, open, high, low, close) VALUES ('2026-01-02', 'TCS', 1, 3, 1, 2)")
    df = spot_prices.get_spot_ohlcv(" tcs ", "2026-01-01", "2026-01-31")
    assert df.to_dict("records") == [{"date": "2026-01-02", "open": 1.0, "high": 3.0, "low": 1.0, "close": 2.0}]


def test_index_alias_reads_the_stored_index_name(db):
    db.execute("INSERT INTO index_ohlcv (date, index_name, open, high, low, close) VALUES ('2026-01-02', 'NIFTY 50', 10, 12, 9, 11)")
    df = spot_prices.get_spot_ohlcv("NIFTY", "2026-01-01", "2026-01-31")
    assert len(df) == 1 and df.iloc[0].close == 11


def test_no_rows_gives_an_empty_frame(db):
    assert spot_prices.get_spot_ohlcv("TCS", "2026-01-01", "2026-01-31").empty


def test_risk_free_rate_is_the_latest_repo_rate_on_or_before_the_date(db):
    db.execute("INSERT INTO rbi_rates (date, repo_rate) VALUES ('2026-01-01', 6.0), ('2026-03-01', 5.5)")
    assert rates.get_risk_free_rate("2026-02-01") == pytest.approx(0.06)
    assert rates.get_risk_free_rate("2026-04-01") == pytest.approx(0.055)


def test_risk_free_rate_falls_back_when_there_is_no_data(db):
    assert rates.get_risk_free_rate("2026-01-01") == rates.DEFAULT_RISK_FREE_RATE
