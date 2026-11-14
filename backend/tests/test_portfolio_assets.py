"""Tests for the other-asset maths and routes."""

from pathlib import Path

import duckdb
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.core.other_assets import asset_metrics, asset_totals
from backend.db import connection
from backend.routes import portfolio, portfolio_assets

SCHEMA = (Path(connection.__file__).parent / "schema.sql").read_text()


def test_inr_asset_needs_no_rate():
    m = asset_metrics(2, 50_000, 60_000, "INR", None)
    assert (m["invested"], m["value"], m["pnl"], m["pnl_pct"]) == (100_000, 120_000, 20_000, 20)
    assert (m["invested_inr"], m["value_inr"], m["pnl_inr"]) == (100_000, 120_000, 20_000)


def test_usd_asset_is_converted_with_the_typed_rate():
    m = asset_metrics(10, 100, 120, "USD", 80)
    assert (m["invested"], m["value"], m["pnl"]) == (1_000, 1_200, 200)       # dollars
    assert (m["invested_inr"], m["value_inr"], m["pnl_inr"]) == (80_000, 96_000, 16_000)


def test_usd_asset_without_a_rate_has_no_rupee_figures():
    m = asset_metrics(10, 100, 120, "USD", None)
    assert m["pnl"] == 200 and m["value_inr"] is None and m["pnl_inr"] is None


def test_totals_are_in_rupees_and_count_unconverted_assets():
    rows = [asset_metrics(2, 50_000, 60_000, "INR", None), asset_metrics(10, 100, 120, "USD", 80), asset_metrics(1, 5, 6, "USD", None)]
    t = asset_totals(rows)
    assert (t["invested"], t["value"], t["pnl"], t["unconverted"]) == (180_000, 216_000, 36_000, 1)
    assert t["pnl_pct"] == pytest.approx(20)
    assert asset_totals([])["pnl_pct"] is None


@pytest.fixture
def client(monkeypatch):
    conn = duckdb.connect()
    conn.execute(SCHEMA)
    for module in (portfolio, portfolio_assets):
        monkeypatch.setattr(module, "get_db", lambda: conn)
    conn.execute("INSERT INTO portfolios (id, name) VALUES (1, 'Mine')")
    app = FastAPI()
    app.include_router(portfolio.router, prefix="/api")
    app.include_router(portfolio_assets.router, prefix="/api")
    return TestClient(app)


def _asset(**over):
    return {"name": "Bitcoin", "asset_type": "crypto", "currency": "INR", "qty": 0.5, "buy_price": 4_000_000, "current_price": 5_000_000, **over}


def test_add_edit_delete_and_the_usd_rate(client):
    r = client.post("/api/portfolios/1/assets", json=_asset()).json()
    a = r["assets"][0]
    assert a["value_inr"] == 2_500_000 and a["pnl"] == 500_000 and r["usd_inr"] is None

    r = client.post("/api/portfolios/1/assets", json=_asset(name="AAPL", asset_type="us_stock", currency="USD", qty=10, buy_price=100, current_price=120)).json()
    assert r["totals"]["unconverted"] == 1
    r = client.put("/api/portfolios/1/assets/usd-inr", json={"usd_inr": 80}).json()
    assert r["usd_inr"] == 80 and r["totals"]["unconverted"] == 0
    assert r["totals"]["value"] == 2_500_000 + 96_000

    updated = client.put(f"/api/portfolios/1/assets/{a['id']}", json=_asset(current_price=6_000_000)).json()
    assert [x["current_price"] for x in updated["assets"] if x["name"] == "Bitcoin"] == [6_000_000]
    assert len(client.delete(f"/api/portfolios/1/assets/{a['id']}").json()["assets"]) == 1


def test_bad_input_and_missing_portfolio(client):
    assert client.post("/api/portfolios/1/assets", json=_asset(qty=0)).status_code == 422
    assert client.post("/api/portfolios/1/assets", json=_asset(asset_type="art")).status_code == 422
    assert client.post("/api/portfolios/9/assets", json=_asset()).status_code == 404
    assert client.put("/api/portfolios/1/assets/99", json=_asset()).status_code == 404
    assert client.put("/api/portfolios/1/assets/usd-inr", json={"usd_inr": -1}).status_code == 422


def test_deleting_a_portfolio_removes_its_assets(client):
    client.post("/api/portfolios/1/assets", json=_asset())
    client.delete("/api/portfolios/1")
    assert client.get("/api/portfolios/1/assets").status_code == 404
