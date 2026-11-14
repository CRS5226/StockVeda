"""Tests for the Signals routes, on synthetic candles."""

from datetime import date, datetime, timedelta
from pathlib import Path

import duckdb
import numpy as np
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.db import connection
from backend.routes import portfolio, portfolio_assets, portfolio_dividends, portfolio_fd, portfolio_health, portfolio_mf, portfolio_signals, portfolio_total

SCHEMA = (Path(connection.__file__).parent / "schema.sql").read_text()
MODULES = (portfolio, portfolio_assets, portfolio_dividends, portfolio_fd, portfolio_mf, portfolio_total, portfolio_health, portfolio_signals)


@pytest.fixture
def client(monkeypatch):
    conn = duckdb.connect()
    conn.execute(SCHEMA)
    for module in MODULES:
        monkeypatch.setattr(module, "get_db", lambda: conn)
    conn.execute("INSERT INTO portfolios (id, name) VALUES (1, 'Mine')")
    today = date.today()
    climb, fall = np.linspace(100, 300, 500), np.linspace(300, 100, 500)
    for i in range(500):                                                        # about 70 weeks, enough for the weekly rules
        d = today - timedelta(days=499 - i)
        for sym, c in (("TCS", climb[i]), ("ITC", fall[i])):
            conn.execute("INSERT INTO stock_ohlcv VALUES (?, ?, ?, ?, ?, ?, 1000)", [d, sym, c, c + 0.2, c - 0.2, c])
    for i in range(120):                                                        # an hourly series for TCS only
        conn.execute("INSERT INTO stock_intraday_ohlcv VALUES (?, 'TCS', '60m', ?, ?, ?, ?, 1000)", [datetime.now() - timedelta(hours=120 - i), 100 + i, 100.2 + i, 99.8 + i, 100 + i])
    app = FastAPI()
    for module in MODULES:
        app.include_router(module.router, prefix="/api")
    return TestClient(app)


def test_signals_report(client):
    client.post("/api/portfolios/1/holdings", json={"symbol": "TCS", "qty": 10, "buy_price": 150})     # now 300: a 100% gain
    client.post("/api/portfolios/1/holdings", json={"symbol": "ITC", "qty": 10, "buy_price": 200})     # now 100: a 50% loss
    r = client.get("/api/portfolios/1/signals").json()
    rows = {x["symbol"]: x for x in r["rows"]}
    tcs, itc = rows["TCS"], rows["ITC"]
    assert tcs["timeframes"]["1D"]["lean"] == "bullish" and tcs["timeframes"]["1W"]["lean"] == "bullish" and tcs["timeframes"]["1H"] is not None
    assert tcs["alignment"] == "bullish" and tcs["pnl_pct"] == pytest.approx(100)
    assert itc["timeframes"]["1D"]["lean"] == "bearish" and itc["timeframes"]["1H"] is None and itc["alignment"] == "bearish"
    assert itc["pnl_pct"] == pytest.approx(-50)
    # a steady climb with a 100% gain is not "stretched" by RSI the way a spike is: the zone depends on the numbers, so check the pieces
    assert tcs["zone"] in ("profit", "hold") and itc["zone"] in ("recovery", "hold")
    assert [c["met"] for c in itc["zone_checks"]][0] is True                                           # the loss condition is met
    assert tcs["sizing"]["trim"]["shares"] == 2 and tcs["sizing"]["cost_out"]["shares"] == 5            # 25% of 10; ceil(1500 / 300)
    assert r["summary"]["stocks"] == 2 and r["summary"]["aligned_bullish"] == 1 and r["summary"]["aligned_bearish"] == 1
    assert r["settings"]["profit_gain_pct"] == 40 and r["max_position_pct"] == 10


def test_settings_change_the_zones(client):
    client.post("/api/portfolios/1/holdings", json={"symbol": "TCS", "qty": 10, "buy_price": 150})
    default = client.get("/api/portfolios/1/signals/settings").json()
    assert default["trim_pct"] == 25 and default["add_budget"] == 5000
    saved = client.put("/api/portfolios/1/signals/settings", json={"trim_pct": 50, "profit_gain_pct": 120}).json()
    assert saved["trim_pct"] == 50 and saved["profit_gain_pct"] == 120 and saved["loss_pct"] == 25
    row = client.get("/api/portfolios/1/signals").json()["rows"][0]
    assert row["sizing"]["trim"]["shares"] == 5 and row["zone"] == "hold"                                  # a 100% gain is below the 120% bar now
    assert client.put("/api/portfolios/1/signals/settings", json={"trim_pct": 0}).status_code == 422
    assert client.put("/api/portfolios/9/signals/settings", json={}).status_code == 404
    assert client.get("/api/portfolios/9/signals").status_code == 404
    client.delete("/api/portfolios/1")
    assert client.get("/api/portfolios/1/signals/settings").status_code == 404


def test_a_stock_without_enough_candles_has_no_signals(client):
    client.post("/api/portfolios/1/holdings", json={"symbol": "TCS", "qty": 1, "buy_price": 100})
    client.post("/api/portfolios/1/holdings", json={"symbol": "NEW", "qty": 1, "buy_price": 100})
    connection_rows = [(date.today() - timedelta(days=i), "NEW", 10, 10, 10, 10, 10) for i in range(20)]
    for m in (portfolio_signals,):
        db = m.get_db()
        for row in connection_rows:
            db.execute("INSERT INTO stock_ohlcv VALUES (?, ?, ?, ?, ?, ?, ?)", list(row))
    rows = {x["symbol"]: x for x in client.get("/api/portfolios/1/signals").json()["rows"]}
    assert rows["NEW"]["timeframes"]["1D"] is None and rows["NEW"]["alignment"] is None and rows["NEW"]["zone"] == "hold"
