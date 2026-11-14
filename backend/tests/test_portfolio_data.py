"""Tests for the portfolio data routes and the sync job. Nothing calls the network."""

from datetime import date, datetime, timedelta
from pathlib import Path

import duckdb
import pandas as pd
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.core.price_sync import expected_close_date
from backend.data_sync import sync_portfolio_data as sync
from backend.db import connection
from backend.routes import portfolio, portfolio_data

SCHEMA = (Path(connection.__file__).parent / "schema.sql").read_text()


@pytest.fixture
def db(monkeypatch):
    conn = duckdb.connect()
    conn.execute(SCHEMA)
    conn.execute("INSERT INTO portfolios (id, name) VALUES (1, 'Mine')")
    conn.execute("INSERT INTO portfolio_holdings (id, portfolio_id, symbol) VALUES (1, 1, 'TCS'), (2, 1, 'ITC'), (3, 1, 'NIFTYBEES')")
    for module in (portfolio, portfolio_data):
        monkeypatch.setattr(module, "get_db", lambda: conn)
    monkeypatch.setattr("backend.data_sync.base.get_db", lambda: conn)
    monkeypatch.setattr(sync, "PAUSE_SECONDS", 0)
    monkeypatch.setattr(sync, "FUNDAMENTALS_PAUSE_SECONDS", 0)
    sync.data_jobs.clear()
    return conn


@pytest.fixture
def client(db):
    app = FastAPI()
    app.include_router(portfolio.router, prefix="/api")
    app.include_router(portfolio_data.router, prefix="/api")
    return TestClient(app)


def _fresh_everything(db):
    now = datetime.now()
    for s in ("TCS", "ITC", "NIFTYBEES"):
        db.execute("INSERT INTO stock_intraday_ohlcv VALUES (?, ?, '60m', 1, 1, 1, 1, 1)", [datetime.combine(expected_close_date(now.astimezone()), datetime.min.time()), s])
    for s in ("TCS", "ITC"):
        db.execute("INSERT INTO stock_fundamentals (symbol, period, period_type, is_consolidated, revenue, pat) VALUES (?, ?, 'Q', true, 10, 1)", [s, date.today() - timedelta(days=40)])
        db.execute("INSERT INTO stock_ratios_snapshot (symbol, as_of, pe) VALUES (?, ?, 20)", [s, date.today()])


def test_coverage_counts_what_is_stored_and_what_is_stale(client, db):
    c = client.get("/api/portfolios/1/data/coverage").json()
    by = {d["key"]: d for d in c["datasets"]}
    assert by["hourly"]["total"] == 3 and by["hourly"]["stored"] == 0 and by["hourly"]["stale"] == 3
    assert by["fundamentals"]["total"] == 2 and by["ratios"]["total"] == 2          # NIFTYBEES is an ETF: no company results
    assert c["up_to_date"] is False
    _fresh_everything(db)
    c = client.get("/api/portfolios/1/data/coverage").json()
    assert c["up_to_date"] is True and {d["key"]: d["stale"] for d in c["datasets"]} == {"hourly": 0, "fundamentals": 0, "ratios": 0}


def test_everything_current_says_up_to_date_without_fetching(client, db, monkeypatch):
    _fresh_everything(db)
    monkeypatch.setattr(sync, "fetch_intraday_symbol", lambda *a: pytest.fail("must not fetch"))
    assert client.post("/api/portfolios/1/data/sync").json() == {"status": "up_to_date", "checked": 3}
    assert client.post("/api/portfolios/9/data/sync").status_code == 404


class FakeTicker:
    def __init__(self, code):
        self.code = code
        self.info = {"trailingPE": 18.0, "priceToBook": 2.0, "returnOnEquity": 0.2, "marketCap": 1e12, "sector": "Tech"} if code.startswith("TCS") else {}


def test_sync_fills_the_gaps_and_reports_each_step(client, db, monkeypatch):
    def fake_hourly(sym, interval, days):
        assert interval == "60m"
        if sym == "ITC":
            return pd.DataFrame()                                          # Yahoo has nothing for ITC
        return pd.DataFrame({"datetime": [datetime(2026, 11, 13, 10, 15)], "symbol": [sym], "interval": ["60m"], "open": 1.0, "high": 1.0, "low": 1.0, "close": 1.0, "volume": 5})

    monkeypatch.setattr(sync, "fetch_intraday_symbol", fake_hourly)
    monkeypatch.setattr(sync.yf, "Ticker", FakeTicker)
    monkeypatch.setattr(sync, "parse_financials", lambda t, sym, kind: [{
        "symbol": sym, "period": date(2026, 9, 30), "period_type": kind, "is_consolidated": True, "revenue": 100.0, "gross_profit": None, "ebitda": 20.0, "ebit": None,
        "pbt": None, "pat": 10.0, "eps_basic": None, "eps_diluted": None, "total_assets": None, "total_equity": None, "total_debt": None, "cash": None,
        "cfo": None, "cfi": None, "cff": None, "capex": None}] if sym == "TCS" else [])
    started = client.post("/api/portfolios/1/data/sync").json()
    assert started["status"] == "started"
    job = client.get(f"/api/portfolios/1/data/sync/{started['job_id']}").json()
    steps = {s["key"]: s for s in job["steps"]}
    assert job["status"] == "done" and job["current"] is None
    assert (steps["hourly"]["total"], steps["hourly"]["updated"], steps["hourly"]["no_data"]) == (3, 2, ["ITC"])
    assert (steps["fundamentals"]["total"], steps["fundamentals"]["updated"], steps["fundamentals"]["no_data"]) == (2, 1, ["ITC"])
    assert (steps["ratios"]["updated"], steps["ratios"]["no_data"]) == (1, ["ITC"])
    # what was stored shows up in the table, and ITC is not asked again straight away
    table = {r["symbol"]: r for r in client.get("/api/portfolios/1/data/fundamentals").json()["rows"]}
    assert table["TCS"]["pe"] == 18.0 and table["TCS"]["roe_pct"] == 20.0 and table["TCS"]["quarter"]["revenue"] == 100.0 and "ITC" not in table
    again = {d["key"]: d["stale"] for d in client.get("/api/portfolios/1/data/coverage").json()["datasets"]}
    assert again["fundamentals"] == 0 and again["ratios"] == 1 and again["hourly"] == 1        # ITC fundamentals retried later; ratios and 1h have no fresh data for ITC
    assert client.get("/api/portfolios/1/data/sync/nope").status_code == 404


def test_a_failing_symbol_does_not_stop_the_others(client, db, monkeypatch):
    def fake_hourly(sym, interval, days):
        if sym == "TCS":
            raise RuntimeError("yahoo down")
        return pd.DataFrame({"datetime": [datetime(2026, 11, 13, 10, 15)], "symbol": [sym], "interval": ["60m"], "open": 1.0, "high": 1.0, "low": 1.0, "close": 1.0, "volume": 5})
    monkeypatch.setattr(sync, "fetch_intraday_symbol", fake_hourly)
    monkeypatch.setattr(sync.yf, "Ticker", FakeTicker)
    monkeypatch.setattr(sync, "parse_financials", lambda *a: [])
    job_id = client.post("/api/portfolios/1/data/sync").json()["job_id"]
    steps = {s["key"]: s for s in client.get(f"/api/portfolios/1/data/sync/{job_id}").json()["steps"]}
    assert steps["hourly"]["failed"] == ["TCS"] and steps["hourly"]["updated"] == 2 and steps["hourly"]["done"] == 3
