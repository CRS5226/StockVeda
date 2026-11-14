"""Tests for the portfolio price sync: parsing Yahoo downloads, the job, and the routes. Nothing calls the network."""

from datetime import date, datetime, timedelta
from pathlib import Path

import duckdb
import pandas as pd
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.core.price_sync import expected_close_date
from backend.data_sync import sync_portfolio_prices as sync
from backend.db import connection
from backend.routes import portfolio, portfolio_mf, portfolio_prices

SCHEMA = (Path(connection.__file__).parent / "schema.sql").read_text()
D = date


def _bars(days, base=100.0):
    idx = pd.DatetimeIndex([pd.Timestamp(d) for d in days])
    return pd.DataFrame({"Open": base, "High": base + 2, "Low": base - 2, "Close": [base + i for i in range(len(days))], "Volume": 1000.0}, index=idx)


def test_closes_from_a_grouped_download():
    days = [D(2026, 11, 12), D(2026, 11, 13)]
    raw = pd.concat({"TCS.NS": _bars(days, 100), "ITC.NS": _bars(days, 50)}, axis=1)
    raw.loc[pd.Timestamp(D(2026, 11, 13)), ("ITC.NS", "Close")] = float("nan")            # a day with no close is dropped
    out = sync.closes_from_download(raw, {"TCS.NS": "TCS", "ITC.NS": "ITC"})
    assert sorted(zip(out["symbol"], out["date"], out["close"])) == [("ITC", D(2026, 11, 12), 50.0), ("TCS", D(2026, 11, 12), 100.0), ("TCS", D(2026, 11, 13), 101.0)]
    assert list(out.columns) == ["date", "symbol", "open", "high", "low", "close", "volume"]
    assert out["volume"].dtype == "int64"


def test_closes_from_a_flat_download_and_from_nothing():
    out = sync.closes_from_download(_bars([D(2026, 11, 13)]), {"TCS.NS": "TCS"})
    assert out["symbol"].tolist() == ["TCS"]
    assert sync.closes_from_download(pd.DataFrame(), {"TCS.NS": "TCS"}).empty
    grouped = pd.concat({"ZZZ.NS": _bars([D(2026, 11, 13)])}, axis=1)
    assert sync.closes_from_download(grouped, {"TCS.NS": "TCS"}).empty               # the asked-for ticker is not in the download


@pytest.fixture
def db(monkeypatch):
    conn = duckdb.connect()
    conn.execute(SCHEMA)
    conn.execute("INSERT INTO portfolios (id, name) VALUES (1, 'Mine')")
    conn.execute("INSERT INTO portfolio_holdings (id, portfolio_id, symbol) VALUES (1, 1, 'TCS'), (2, 1, 'ITC'), (3, 1, 'NEWCO')")
    for module in (portfolio_prices, sync):
        monkeypatch.setattr(module, "get_db", lambda: conn)
    monkeypatch.setattr("backend.data_sync.base.get_db", lambda: conn)
    sync.price_jobs.clear()
    return conn


@pytest.fixture
def client(db):
    app = FastAPI()
    app.include_router(portfolio.router, prefix="/api")
    app.include_router(portfolio_prices.router, prefix="/api")
    return TestClient(app)


def _expected():
    return expected_close_date(datetime.now().astimezone())


def test_everything_current_says_up_to_date_without_fetching(client, db, monkeypatch):
    monkeypatch.setattr(sync, "fetch_closes", lambda *a: pytest.fail("must not fetch"))
    for sym in ("TCS", "ITC", "NEWCO"):
        db.execute("INSERT INTO stock_ohlcv VALUES (?, ?, 1, 1, 1, 100, 1)", [_expected(), sym])
    r = client.post("/api/portfolios/1/prices/sync").json()
    assert r["status"] == "up_to_date" and r["as_of"] == str(_expected()) and r["checked"] == 3


def test_stale_symbols_are_fetched_from_the_day_after_their_last_close(client, db, monkeypatch):
    exp = _expected()
    db.execute("INSERT INTO stock_ohlcv VALUES (?, 'TCS', 1, 1, 1, 100, 1)", [exp])                      # current
    db.execute("INSERT INTO stock_ohlcv VALUES (?, 'ITC', 1, 1, 1, 100, 1)", [exp - timedelta(days=5)])    # behind
    calls = []

    def fake_fetch(symbols, start):
        calls.append((sorted(symbols), start))
        return pd.DataFrame({"date": [exp, exp], "symbol": ["ITC", "ITC"], "open": 1.0, "high": 1.0, "low": 1.0, "close": [101.0, 102.0], "volume": 5})

    monkeypatch.setattr(sync, "fetch_closes", fake_fetch)
    monkeypatch.setattr(sync, "PAUSE_SECONDS", 0)
    started = client.post("/api/portfolios/1/prices/sync").json()
    assert started["status"] == "started" and started["total"] == 2          # ITC and NEWCO (no close at all)
    assert calls[0][0] == ["ITC", "NEWCO"] and calls[0][1] == date.today() - timedelta(days=30)     # NEWCO pulls the start back
    job = client.get(f"/api/portfolios/1/prices/sync/{started['job_id']}").json()
    assert job["status"] == "done" and job["done"] == 2 and job["updated_symbols"] == 1
    assert job["no_data"] == ["NEWCO"]                                       # never had a close and Yahoo has none
    assert db.execute("SELECT COUNT(*) FROM stock_ohlcv WHERE symbol = 'ITC'").fetchall()[0][0] >= 1
    assert client.get("/api/portfolios/1/prices/sync/nope").status_code == 404
    assert client.post("/api/portfolios/9/prices/sync").status_code == 404


def test_a_day_that_is_still_trading_is_not_stored(db, monkeypatch):
    exp = _expected()
    later = exp + timedelta(days=1)
    monkeypatch.setattr(sync, "fetch_closes", lambda s, st: pd.DataFrame({"date": [exp, later], "symbol": ["TCS", "TCS"], "open": 1.0, "high": 1.0, "low": 1.0, "close": 1.0, "volume": 1}))
    monkeypatch.setattr(sync, "PAUSE_SECONDS", 0)
    sync.price_jobs["j"] = {"pid": 1, "status": "queued", "total": 1, "done": 0, "prices": 0, "updated_symbols": 0, "navs": 0, "no_data": [], "as_of": str(exp)}
    sync.run_price_sync("j", {"TCS": exp - timedelta(days=3)}, {}, exp, date.today())
    assert [r[0] for r in db.execute("SELECT date FROM stock_ohlcv WHERE symbol = 'TCS'").fetchall()] == [exp]


def test_stale_mutual_fund_navs_are_refreshed(client, db, monkeypatch):
    for sym in ("TCS", "ITC", "NEWCO"):
        db.execute("INSERT INTO stock_ohlcv VALUES (?, ?, 1, 1, 1, 100, 1)", [_expected(), sym])
    db.execute("INSERT INTO mf_scheme_master (scheme_code, scheme_name) VALUES ('100', 'Test Fund')")
    db.execute("INSERT INTO portfolio_mf (id, portfolio_id, scheme_code, scheme_name, kind, amount, start_date) VALUES (1, 1, '100', 'Test Fund', 'sip', 500, '2025-01-01')")
    db.execute("INSERT INTO mf_nav VALUES (?, '100', 'Test Fund', NULL, 10)", [_expected() - timedelta(days=4)])
    fetched = []
    monkeypatch.setattr(sync, "backfill_nav", lambda code, name, isin: fetched.append(code) or 5)
    monkeypatch.setattr(sync, "PAUSE_SECONDS", 0)
    started = client.post("/api/portfolios/1/prices/sync").json()
    assert started["total"] == 1 and fetched == ["100"]
    assert client.get(f"/api/portfolios/1/prices/sync/{started['job_id']}").json()["navs"] == 1
