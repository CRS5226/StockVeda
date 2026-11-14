"""Tests for the rule evidence route."""

from datetime import date, timedelta
from pathlib import Path

import duckdb
import numpy as np
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.db import connection
from backend.routes import portfolio, portfolio_assets, portfolio_dividends, portfolio_evidence, portfolio_fd, portfolio_mf, portfolio_total

SCHEMA = (Path(connection.__file__).parent / "schema.sql").read_text()
MODULES = (portfolio, portfolio_assets, portfolio_dividends, portfolio_fd, portfolio_mf, portfolio_total, portfolio_evidence)


@pytest.fixture
def client(monkeypatch):
    conn = duckdb.connect()
    conn.execute(SCHEMA)
    for module in MODULES:
        monkeypatch.setattr(module, "get_db", lambda: conn)
    conn.execute("INSERT INTO portfolios (id, name) VALUES (1, 'Mine')")
    today = date.today()
    swing = 100 + 10 * np.sin(np.linspace(0, 24 * np.pi, 600))
    for i in range(600):
        d = today - timedelta(days=599 - i)
        conn.execute("INSERT INTO stock_ohlcv VALUES (?, 'TCS', ?, ?, ?, ?, 1000)", [d, swing[i], swing[i] + 0.1, swing[i] - 0.1, swing[i]])
    for i in range(30):                                          # NEW has only a month of candles
        conn.execute("INSERT INTO stock_ohlcv VALUES (?, 'NEW', 10, 10, 10, 10, 10)", [today - timedelta(days=i)])
    app = FastAPI()
    for module in MODULES:
        app.include_router(module.router, prefix="/api")
    return TestClient(app)


def test_evidence_per_stock_and_per_rule(client):
    client.post("/api/portfolios/1/holdings", json={"symbol": "TCS", "qty": 10, "buy_price": 100})
    client.post("/api/portfolios/1/holdings", json={"symbol": "NEW", "qty": 10, "buy_price": 10})
    r = client.get("/api/portfolios/1/evidence").json()
    assert [x["key"] for x in r["rules"]] == ["ema_cross", "sma200", "macd", "rsi", "bollinger", "breakout"]
    assert [x["symbol"] for x in r["rows"]] == ["TCS"] and r["stocks_total"] == 2          # NEW has too few candles to test
    ema = r["rows"][0]["results"]["ema_cross"]
    assert ema["trades"] >= 5 and ema["verdict"] in ("held_up", "mixed", "did_not")
    summary = {s["key"]: s for s in r["summary"]}
    assert summary["ema_cross"]["tested"] == 1 and sum(summary["ema_cross"][k] for k in ("held_up", "mixed", "did_not", "few_trades")) == 1
    assert r["cost_pct"] == 0.2


def test_a_higher_cost_lowers_the_result_and_bad_input_is_refused(client):
    client.post("/api/portfolios/1/holdings", json={"symbol": "TCS", "qty": 10, "buy_price": 100})
    cheap = client.get("/api/portfolios/1/evidence", params={"cost_pct": 0}).json()["rows"][0]["results"]["ema_cross"]["total_pct"]
    dear = client.get("/api/portfolios/1/evidence", params={"cost_pct": 1}).json()["rows"][0]["results"]["ema_cross"]["total_pct"]
    assert dear < cheap
    assert client.get("/api/portfolios/1/evidence", params={"cost_pct": -1}).status_code == 422
    assert client.get("/api/portfolios/9/evidence").status_code == 404
