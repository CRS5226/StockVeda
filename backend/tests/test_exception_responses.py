import logging

import pandas as pd
import pytest
from fastapi import HTTPException

from backend.data_sync import sync_intraday
from backend.routes import backtest, macro, screener, stock


def test_stock_ratio_error_is_logged_but_not_returned(monkeypatch, caplog):
    def fail(_symbol):
        raise RuntimeError("database path /private/stockveda.duckdb")

    monkeypatch.setattr(stock.yf, "Ticker", fail)

    with caplog.at_level(logging.ERROR):
        result = stock.get_ratios("ACME")

    assert result["error"] == "Failed to load stock information"
    assert "database path /private/stockveda.duckdb" not in str(result)
    assert "database path /private/stockveda.duckdb" in caplog.text


def test_screener_unexpected_error_is_generic_and_logged(monkeypatch, caplog):
    def fail(*_args, **_kwargs):
        raise RuntimeError("DuckDB query leaked internal schema")

    monkeypatch.setattr(screener, "run_screen", fail)

    with caplog.at_level(logging.ERROR), pytest.raises(HTTPException) as exc_info:
        screener.run_screener(screener.ScreenRequest(conditions=[]))

    assert exc_info.value.status_code == 500
    assert exc_info.value.detail == "Screening failed, see server logs"
    assert "DuckDB query leaked internal schema" in caplog.text


def test_screener_user_input_error_remains_descriptive(monkeypatch):
    def fail(*_args, **_kwargs):
        raise ValueError("Unknown metric: xyz")

    monkeypatch.setattr(screener, "run_screen", fail)

    with pytest.raises(HTTPException) as exc_info:
        screener.run_screener(screener.ScreenRequest(conditions=[]))

    assert exc_info.value.status_code == 400
    assert exc_info.value.detail == "Unknown metric: xyz"


def test_backtest_internal_error_keeps_500_and_is_generic(monkeypatch, caplog):
    class Result:
        def df(self):
            return pd.DataFrame({"close": range(60)})

    class Database:
        def execute(self, *_args, **_kwargs):
            return Result()

    def fail(*_args, **_kwargs):
        raise RuntimeError("internal SQL detail")

    monkeypatch.setattr(backtest, "get_db", Database)
    monkeypatch.setattr(backtest, "run_backtest", fail)
    request = backtest.BacktestRequest(
        symbol="ACME", from_date="2025-01-01", to_date="2025-12-31"
    )

    with caplog.at_level(logging.ERROR), pytest.raises(HTTPException) as exc_info:
        backtest.run(request)

    assert exc_info.value.status_code == 500
    assert exc_info.value.detail == "Backtest failed, see server logs"
    assert "internal SQL detail" in caplog.text


def test_bootstrap_errors_are_generic_and_logged(monkeypatch, caplog):
    class Result:
        def fetchone(self):
            return (0,)

    class Database:
        def execute(self, *_args, **_kwargs):
            return Result()

    monkeypatch.setattr(macro, "get_db", Database)
    from backend.data_sync import (
        seed_symbols,
        sync_currency,
        sync_fii_dii,
        sync_index_fundamentals,
        sync_indices,
    )

    def fail():
        raise RuntimeError("private schema detail")

    for module in (seed_symbols, sync_indices, sync_currency, sync_fii_dii, sync_index_fundamentals):
        monkeypatch.setattr(module, "run", fail)

    with caplog.at_level(logging.ERROR):
        result = macro.bootstrap()

    assert set(result["sources"].values()) == {"failed; see server logs"}
    assert "private schema detail" in caplog.text


def test_intraday_error_is_generic_and_logged(monkeypatch, caplog):
    def fail(*_args, **_kwargs):
        raise RuntimeError("remote service returned internal detail")

    monkeypatch.setitem(sync_intraday.intraday_fetch_jobs, "job-1", {"status": "running"})
    monkeypatch.setattr(sync_intraday, "fetch_intraday_symbol", fail)

    with caplog.at_level(logging.ERROR):
        sync_intraday._run_intraday_fetch_job("job-1", "ACME", "5m", 1)

    assert sync_intraday.intraday_fetch_jobs["job-1"]["error"] == "Intraday fetch failed; see server logs"
    assert "remote service returned internal detail" in caplog.text


def test_intraday_batch_error_is_logged_without_stopping_batch(monkeypatch, caplog):
    def fail(*_args, **_kwargs):
        raise RuntimeError("batch fetch internal detail")

    monkeypatch.setattr(sync_intraday, "_existing_coverage", lambda *_args: (None, None))
    monkeypatch.setattr(sync_intraday, "fetch_intraday_symbol", fail)

    with caplog.at_level(logging.ERROR):
        sync_intraday.sync_intraday_batch(["ACME"], "5m", 1, "batch-job-1")

    job = sync_intraday.intraday_fetch_jobs["batch-job-1"]
    assert job["status"] == "done"
    assert job["done"] == 1
    assert "batch fetch internal detail" in caplog.text
