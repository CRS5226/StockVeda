"""Tests for the portfolio mutual fund routes and the portfolio XIRR."""

from datetime import date, timedelta
from pathlib import Path

import duckdb
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.core.portfolio_total import build_flows, combine, portfolio_xirr
from backend.db import connection
from backend.routes import portfolio, portfolio_assets, portfolio_fd, portfolio_mf, portfolio_total

SCHEMA = (Path(connection.__file__).parent / "schema.sql").read_text()
TODAY = date.today()


@pytest.fixture
def client(monkeypatch):
    conn = duckdb.connect()
    conn.execute(SCHEMA)
    for module in (portfolio, portfolio_assets, portfolio_fd, portfolio_mf, portfolio_total):
        monkeypatch.setattr(module, "get_db", lambda: conn)
    monkeypatch.setattr(portfolio_mf, "load_meta_and_history", lambda code: None)     # never touch the network
    conn.execute("INSERT INTO portfolios (id, name) VALUES (1, 'Mine')")
    conn.execute("INSERT INTO mf_scheme_master (scheme_code, scheme_name, plan, option_type, category) VALUES ('100', 'Test Flexi Cap Fund', 'Direct Plan', 'Growth', 'Flexi Cap')")
    start = TODAY - timedelta(days=400)
    for i in range(401):                                  # NAV 10 rising to 14 over the 400 days
        conn.execute("INSERT INTO mf_nav VALUES (?, '100', 'Test Flexi Cap Fund', NULL, ?)", [start + timedelta(days=i), 10 + 4 * i / 400])
    app = FastAPI()
    for module in (portfolio, portfolio_assets, portfolio_fd, portfolio_mf, portfolio_total):
        app.include_router(module.router, prefix="/api")
    return TestClient(app)


def _mf(**over):
    return {"scheme_code": "100", "kind": "lumpsum", "amount": 10_000, "start_date": str(TODAY - timedelta(days=400)), **over}


def test_lump_sum_is_valued_from_nav_history(client):
    r = client.post("/api/portfolios/1/mf", json=_mf()).json()
    h = r["holdings"][0]
    assert (h["scheme_name"], h["plan"], h["option_type"], h["active_sip"]) == ("Test Flexi Cap Fund", "Direct Plan", "Growth", False)
    assert h["units"] == pytest.approx(1_000) and h["current_value"] == pytest.approx(14_000)
    assert h["returns_pct"] == pytest.approx(40) and h["xirr_pct"] > 30
    assert r["totals"]["invested"] == 10_000 and r["totals"]["returns"] == pytest.approx(4_000)


def test_sip_edit_stop_and_delete(client):
    r = client.post("/api/portfolios/1/mf", json=_mf(kind="sip", amount=1_000)).json()
    h = r["holdings"][0]
    assert h["active_sip"] is True and h["installments"] >= 13 and h["invested"] == 1_000 * h["installments"]
    stopped = client.put(f"/api/portfolios/1/mf/{h['id']}", json=_mf(kind="sip", amount=1_000, end_date=str(TODAY - timedelta(days=200)))).json()["holdings"][0]
    assert stopped["active_sip"] is False and stopped["installments"] < h["installments"]
    assert client.delete(f"/api/portfolios/1/mf/{h['id']}").json()["holdings"] == []


def test_bad_input(client):
    assert client.post("/api/portfolios/1/mf", json=_mf(scheme_code="999")).status_code == 404
    assert client.post("/api/portfolios/1/mf", json=_mf(kind="lumpsum", end_date=str(TODAY))).status_code == 400
    assert client.post("/api/portfolios/1/mf", json=_mf(start_date=str(TODAY + timedelta(days=5)))).status_code == 400
    assert client.post("/api/portfolios/1/mf", json=_mf(amount=0)).status_code == 422
    assert client.post("/api/portfolios/9/mf", json=_mf()).status_code == 404


def test_mutual_funds_join_the_portfolio_total_and_xirr(client):
    client.post("/api/portfolios/1/mf", json=_mf())
    t = client.get("/api/portfolios/1/total").json()
    assert [p["key"] for p in t["parts"]] == ["mutual_funds"]
    assert t["value"] == pytest.approx(14_000) and t["xirr_pct"] > 30
    assert t["xirr_items"] == {"dated": 1, "total": 1}


def test_xirr_counts_only_dated_items():
    year_ago = TODAY - timedelta(days=365)
    stocks = [{"invested": 1_000, "value": 1_200, "buy_date": str(year_ago)}, {"invested": 500, "value": 600, "buy_date": None}]
    fds = [{"principal": 10_000, "current_value": 10_800, "start_date": str(year_ago)}]
    assets = [{"value_inr": 2_000, "invested_inr": 1_000, "buy_date": None}]
    flows, dated, counted = build_flows(stocks, fds, assets, [], TODAY)
    assert (dated, counted) == (2, 4)
    # 1000 -> 1200 and 10000 -> 10800 over one year: 800 + 200 on 11000 invested = 9.09% a year
    assert portfolio_xirr(flows) == pytest.approx(1000 / 11000 * 100, abs=0.05)
    assert portfolio_xirr([]) is None


def test_combine_adds_the_mutual_fund_part():
    t = combine({"invested": 0, "value": 0, "incomplete": 0}, {"principal": 0, "current_value": 0}, [], {"invested": 1_000, "current_value": 1_300})
    assert t["parts"][0]["key"] == "mutual_funds" and t["pnl"] == 300
