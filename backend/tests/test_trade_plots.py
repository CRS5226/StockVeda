"""Tests for the trade plot rules and routes."""

from pathlib import Path

import duckdb
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.core.trade_plot import validate_levels
from backend.db import connection
from backend.routes import trade_plots

SCHEMA = (Path(connection.__file__).parent / "schema.sql").read_text()


def test_a_long_needs_the_stop_below_and_the_target_above():
    assert validate_levels("long", 100, 99, 102) is None
    assert "below" in validate_levels("long", 100, 101, 102)
    assert "above" in validate_levels("long", 100, 99, 99.5)


def test_a_short_is_the_mirror_image():
    assert validate_levels("short", 100, 101, 98) is None
    assert "above" in validate_levels("short", 100, 99, 98)
    assert "below" in validate_levels("short", 100, 101, 102)


def test_bad_side_or_prices_are_rejected():
    assert validate_levels("buy", 100, 99, 102)
    assert validate_levels("long", 100, 0, 102)


@pytest.fixture
def client(monkeypatch):
    conn = duckdb.connect()
    conn.execute(SCHEMA)
    monkeypatch.setattr(trade_plots, "get_db", lambda: conn)
    app = FastAPI()
    app.include_router(trade_plots.router, prefix="/api")
    return TestClient(app)


def _plot(**over):
    body = {
        "symbol": "hdfcbank", "side": "long", "entry_time": "2026-11-11T09:15:00", "end_time": "2026-11-11T15:15:00",
        "entry_price": 800, "stop_loss": 792, "target": 816, "qty": 10, "note": "breakout",
    }
    return {**body, **over}


def test_create_then_list_by_symbol(client):
    r = client.post("/api/trade-plots", json=_plot())
    assert r.status_code == 200
    created = r.json()
    assert created["id"] == 1 and created["symbol"] == "HDFCBANK" and created["entry_time"] == "2026-11-11T09:15:00"
    client.post("/api/trade-plots", json=_plot(symbol="TCS"))
    mine = client.get("/api/trade-plots", params={"symbol": "hdfcbank"}).json()
    assert [p["symbol"] for p in mine] == ["HDFCBANK"]
    assert len(client.get("/api/trade-plots").json()) == 2


def test_update_changes_the_levels_and_keeps_the_id(client):
    pid = client.post("/api/trade-plots", json=_plot()).json()["id"]
    r = client.put(f"/api/trade-plots/{pid}", json=_plot(target=820, note="moved"))
    assert r.status_code == 200 and r.json()["id"] == pid
    assert r.json()["target"] == 820 and r.json()["note"] == "moved"


def test_delete_removes_it_and_a_second_delete_is_404(client):
    pid = client.post("/api/trade-plots", json=_plot()).json()["id"]
    assert client.delete(f"/api/trade-plots/{pid}").json() == {"ok": True}
    assert client.get("/api/trade-plots").json() == []
    assert client.delete(f"/api/trade-plots/{pid}").status_code == 404


def test_invalid_boxes_are_rejected_with_a_clear_message(client):
    wrong_side = client.post("/api/trade-plots", json=_plot(stop_loss=810))
    assert wrong_side.status_code == 400 and "below" in wrong_side.json()["detail"]
    backwards = client.post("/api/trade-plots", json=_plot(end_time="2026-11-11T09:00:00"))
    assert backwards.status_code == 400
    assert client.post("/api/trade-plots", json=_plot(qty=0)).status_code == 422
    assert client.put("/api/trade-plots/99", json=_plot()).status_code == 404
