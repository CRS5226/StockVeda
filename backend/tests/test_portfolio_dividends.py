"""Tests for dividends: the summary maths, the routes and their effect on the portfolio total."""

from datetime import date, timedelta
from pathlib import Path

import duckdb
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.core.dividends import financial_year, summarize
from backend.core.portfolio_total import build_flows, combine, portfolio_xirr
from backend.db import connection
from backend.routes import portfolio, portfolio_assets, portfolio_dividends, portfolio_fd, portfolio_mf, portfolio_total

SCHEMA = (Path(connection.__file__).parent / "schema.sql").read_text()
D = date


def test_financial_year_runs_april_to_march():
    assert financial_year(D(2026, 3, 31)) == "2025-26"
    assert financial_year(D(2026, 4, 1)) == "2026-27"
    assert financial_year(D(2025, 12, 15)) == "2025-26"
    assert financial_year(D(2099, 5, 1)) == "2099-00"


def test_summary_splits_by_financial_year_and_stock():
    rows = [
        {"symbol": "ITC", "pay_date": D(2026, 6, 10), "amount": 500.0, "tds": 0.0},
        {"symbol": "TCS", "pay_date": D(2026, 1, 20), "amount": 900.0, "tds": 100.0},
        {"symbol": "ITC", "pay_date": D(2025, 6, 10), "amount": 300.0, "tds": 0.0},
    ]
    s = summarize(rows, D(2026, 11, 14))
    assert (s["received"], s["tds"], s["gross"]) == (1_700, 100, 1_800)
    assert (s["this_fy_label"], s["this_fy"]) == ("2026-27", 500)
    assert [(b["fy"], b["received"], b["tds"]) for b in s["by_fy"]] == [("2026-27", 500, 0), ("2025-26", 1_200, 100)]
    assert [(x["symbol"], x["received"]) for x in s["by_symbol"]] == [("TCS", 900), ("ITC", 800)]   # biggest first
    assert summarize([], D(2026, 1, 1))["received"] == 0


@pytest.fixture
def client(monkeypatch):
    conn = duckdb.connect()
    conn.execute(SCHEMA)
    conn.execute("INSERT INTO nse_symbols (symbol, company_name) VALUES ('TCS', 'Tata Consultancy Services Limited')")
    modules = (portfolio, portfolio_assets, portfolio_dividends, portfolio_fd, portfolio_mf, portfolio_total)
    for module in modules:
        monkeypatch.setattr(module, "get_db", lambda: conn)
    conn.execute("INSERT INTO portfolios (id, name) VALUES (1, 'Mine')")
    conn.execute("INSERT INTO stock_ohlcv VALUES (?, 'TCS', 1, 1, 1, 110, 1)", [date.today()])
    app = FastAPI()
    for module in modules:
        app.include_router(module.router, prefix="/api")
    return TestClient(app)


def _div(**over):
    return {"symbol": "tcs", "pay_date": str(date.today() - timedelta(days=30)), "amount": 100, "tds": 10, **over}


def test_add_edit_delete(client):
    client.post("/api/portfolios/1/dividends", json=_div(symbol="itc"))
    r = client.post("/api/portfolios/1/dividends", json=_div()).json()
    assert {x["symbol"]: x["company"] for x in r["dividends"]} == {"ITC": None, "TCS": "Tata Consultancy Services Limited"}
    d = next(x for x in r["dividends"] if x["symbol"] == "TCS")
    assert d["symbol"] == "TCS" and r["summary"]["received"] == 200 and r["summary"]["gross"] == 220
    r = client.put(f"/api/portfolios/1/dividends/{d['id']}", json=_div(amount=250)).json()
    assert r["summary"]["received"] == 350
    assert len(client.delete(f"/api/portfolios/1/dividends/{d['id']}").json()["dividends"]) == 1


def test_bad_input(client):
    assert client.post("/api/portfolios/1/dividends", json=_div(amount=0)).status_code == 422
    assert client.post("/api/portfolios/1/dividends", json=_div(tds=-1)).status_code == 422
    assert client.post("/api/portfolios/1/dividends", json=_div(pay_date=str(date.today() + timedelta(days=3)))).status_code == 400
    assert client.post("/api/portfolios/9/dividends", json=_div()).status_code == 404
    assert client.put("/api/portfolios/1/dividends/99", json=_div()).status_code == 404


def test_dividends_count_in_the_portfolio_total_and_go_with_the_portfolio(client):
    client.post("/api/portfolios/1/holdings", json={"symbol": "TCS", "qty": 10, "buy_price": 100, "buy_date": str(date.today() - timedelta(days=365))})
    before = client.get("/api/portfolios/1/total").json()
    client.post("/api/portfolios/1/dividends", json=_div(amount=50))
    after = client.get("/api/portfolios/1/total").json()
    assert after["dividends"] == 50 and after["pnl"] == pytest.approx(before["pnl"] + 50)
    assert after["value"] == before["value"] and after["xirr_pct"] > before["xirr_pct"]
    client.delete("/api/portfolios/1")
    assert client.get("/api/portfolios/1/dividends").status_code == 404


def test_dividends_only_count_in_xirr_for_stocks_with_a_buy_date():
    year_ago = D.today() - timedelta(days=365)
    stocks = [{"symbol": "TCS", "invested": 1_000, "value": 1_000, "buy_date": str(year_ago)}, {"symbol": "ITC", "invested": 500, "value": 500, "buy_date": None}]
    divs = [{"symbol": "TCS", "pay_date": D.today(), "amount": 100}, {"symbol": "ITC", "pay_date": D.today(), "amount": 999}]
    flows, _, _ = build_flows(stocks, [], [], [], D.today(), divs)
    assert portfolio_xirr(flows) == pytest.approx(10, abs=0.1)         # 1000 -> 1000 + 100 dividends in a year


def test_combine_adds_dividends_to_the_stock_profit():
    t = combine({"invested": 1_000, "value": 1_100, "incomplete": 0}, {"principal": 0, "current_value": 0}, [], None, 40)
    assert t["pnl"] == 140 and t["parts"][0]["pnl"] == 140 and t["value"] == 1_100 and t["dividends"] == 40
