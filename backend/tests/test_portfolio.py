"""Tests for the portfolio maths and routes."""

from pathlib import Path

import duckdb
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.core.portfolio import holding_metrics, latest_closes, portfolio_totals
from backend.db import connection
from backend.routes import portfolio

SCHEMA = (Path(connection.__file__).parent / "schema.sql").read_text()


def test_holding_metrics():
    m = holding_metrics(10, 100, 120)
    assert (m["invested"], m["value"], m["pnl"], m["pnl_pct"]) == (1000, 1200, 200, 20)
    assert holding_metrics(10, 100, 80)["pnl"] == -200


def test_unfilled_or_unpriced_holdings_have_no_figures():
    assert holding_metrics(None, None, 120) == {"invested": None, "value": None, "pnl": None, "pnl_pct": None}
    assert holding_metrics(10, 100, None)["pnl"] is None
    assert holding_metrics(10, 100, None)["invested"] == 1000


def test_totals_skip_incomplete_rows():
    rows = [holding_metrics(10, 100, 120), holding_metrics(5, 200, 190), holding_metrics(None, None, 50)]
    t = portfolio_totals(rows)
    assert (t["invested"], t["value"], t["pnl"], t["incomplete"]) == (2000, 2150, 150, 1)
    assert t["pnl_pct"] == pytest.approx(7.5)
    assert portfolio_totals([])["pnl_pct"] is None


@pytest.fixture
def db(monkeypatch):
    conn = duckdb.connect()
    conn.execute(SCHEMA)
    conn.execute("INSERT INTO stock_ohlcv VALUES ('2026-01-01','TCS',1,1,1,100,1), ('2026-01-02','TCS',1,1,1,110,1), ('2026-01-02','INFY',1,1,1,50,1)")
    monkeypatch.setattr(portfolio, "get_db", lambda: conn)
    return conn


@pytest.fixture
def client(db):
    app = FastAPI()
    app.include_router(portfolio.router, prefix="/api")
    return TestClient(app)


def test_latest_closes_uses_each_symbols_last_day(db):
    assert latest_closes(db, ["TCS", "INFY", "NONE"]) == {"TCS": (110, "2026-01-02"), "INFY": (50, "2026-01-02")}
    assert latest_closes(db, []) == {}


def test_create_add_edit_delete(client):
    p = client.post("/api/portfolios", json={"name": "Long term"}).json()
    assert p["holdings"] == [] and p["totals"]["incomplete"] == 0
    d = client.post(f"/api/portfolios/{p['id']}/holdings", json={"symbol": "tcs", "qty": 10, "buy_price": 100, "buy_date": "2025-06-01"}).json()
    h = d["holdings"][0]
    assert (h["symbol"], h["last_price"], h["pnl"], h["buy_date"]) == ("TCS", 110, 100, "2025-06-01")
    d = client.put(f"/api/portfolios/{p['id']}/holdings/{h['id']}", json={"symbol": "TCS", "qty": 20, "buy_price": 100}).json()
    assert d["holdings"][0]["invested"] == 2000 and d["totals"]["pnl"] == 200
    assert client.delete(f"/api/portfolios/{p['id']}/holdings/{h['id']}").json()["holdings"] == []
    assert client.put(f"/api/portfolios/{p['id']}", json={"name": "Renamed"}).json()["name"] == "Renamed"
    assert client.delete(f"/api/portfolios/{p['id']}").json() == {"ok": True}
    assert client.get(f"/api/portfolios/{p['id']}").status_code == 404


def test_from_watchlist_makes_empty_holdings(client, db):
    db.execute("INSERT INTO watchlists (id, name, symbols) VALUES (1, 'My list', ['TCS', 'infy', 'TCS'])")
    d = client.post("/api/portfolios/from-watchlist", json={"watchlist_id": 1}).json()
    assert d["name"] == "My list"
    assert [(h["symbol"], h["qty"]) for h in d["holdings"]] == [("INFY", None), ("TCS", None)]
    assert d["totals"]["incomplete"] == 2
    assert client.post("/api/portfolios/from-watchlist", json={"watchlist_id": 99}).status_code == 404
    assert client.get("/api/portfolios").json() == [{"id": 1, "name": "My list", "holdings": 2}]


def test_bad_input_is_rejected(client):
    assert client.post("/api/portfolios", json={"name": ""}).status_code == 422
    pid = client.post("/api/portfolios", json={"name": "x"}).json()["id"]
    assert client.post(f"/api/portfolios/{pid}/holdings", json={"symbol": "TCS", "qty": -1}).status_code == 422
    assert client.post("/api/portfolios/99/holdings", json={"symbol": "TCS"}).status_code == 404
