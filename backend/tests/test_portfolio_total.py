"""Tests for the portfolio total."""

from datetime import date, timedelta
from pathlib import Path

import duckdb
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.core.other_assets import asset_metrics
from backend.core.portfolio_total import combine
from backend.db import connection
from backend.routes import portfolio, portfolio_assets, portfolio_fd, portfolio_total

SCHEMA = (Path(connection.__file__).parent / "schema.sql").read_text()


def _asset(kind, qty, buy, now, currency="INR", rate=None):
    return {"asset_type": kind, **asset_metrics(qty, buy, now, currency, rate)}


def test_combine_adds_up_types_and_shares():
    stocks = {"invested": 100_000, "value": 120_000, "incomplete": 1}
    fds = {"principal": 200_000, "current_value": 210_000}
    assets = [_asset("crypto", 1, 50_000, 70_000), _asset("us_stock", 10, 100, 120, "USD", 80)]
    t = combine(stocks, fds, assets)
    assert (t["invested"], t["value"], t["pnl"]) == (100_000 + 200_000 + 50_000 + 80_000, 120_000 + 210_000 + 70_000 + 96_000, 66_000)
    assert t["pnl_pct"] == pytest.approx(66_000 / 430_000 * 100)
    assert [p["key"] for p in t["parts"]] == ["stocks", "fixed_deposits", "crypto", "us_stock"]
    assert sum(p["share_pct"] for p in t["parts"]) == pytest.approx(100)
    assert next(p for p in t["parts"] if p["key"] == "fixed_deposits")["pnl"] == 10_000
    assert t["left_out"] == {"stocks": 1, "assets": 0}


def test_unconverted_dollar_assets_are_left_out_and_counted():
    t = combine({"invested": 0, "value": 0, "incomplete": 0}, {"principal": 0, "current_value": 0}, [_asset("us_stock", 10, 100, 120, "USD", None)])
    assert t["parts"] == [] and t["value"] == 0 and t["pnl_pct"] is None and t["left_out"]["assets"] == 1


@pytest.fixture
def client(monkeypatch):
    conn = duckdb.connect()
    conn.execute(SCHEMA)
    for module in (portfolio, portfolio_assets, portfolio_fd, portfolio_total):
        monkeypatch.setattr(module, "get_db", lambda: conn)
    conn.execute("INSERT INTO portfolios (id, name) VALUES (1, 'Mine')")
    conn.execute("INSERT INTO stock_ohlcv VALUES ('2026-01-02','TCS',1,1,1,110,1)")
    conn.execute("INSERT INTO portfolio_holdings (id, portfolio_id, symbol, qty, buy_price) VALUES (1, 1, 'TCS', 10, 100)")
    app = FastAPI()
    for module in (portfolio, portfolio_assets, portfolio_fd, portfolio_total):
        app.include_router(module.router, prefix="/api")
    return TestClient(app)


def test_total_route_combines_all_three_kinds(client):
    today = date.today()
    client.post("/api/portfolios/1/fds", json={"name": "FD", "principal": 100000, "annual_rate": 8, "start_date": str(today - timedelta(days=30)),
                                               "maturity_date": str(today + timedelta(days=335)), "payout": "cumulative", "compounding": "yearly"})
    client.post("/api/portfolios/1/assets", json={"name": "BTC", "asset_type": "crypto", "currency": "INR", "qty": 1, "buy_price": 1000, "current_price": 1500})
    t = client.get("/api/portfolios/1/total").json()
    assert [p["key"] for p in t["parts"]] == ["stocks", "fixed_deposits", "crypto"]
    assert t["invested"] == 1_000 + 100_000 + 1_000
    stocks = next(p for p in t["parts"] if p["key"] == "stocks")
    assert (stocks["invested"], stocks["value"]) == (1_000, 1_100)
    assert t["value"] > t["invested"]
    assert client.get("/api/portfolios/9/total").status_code == 404
