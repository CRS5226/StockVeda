"""Tests for the chart drawing rules and routes."""

from pathlib import Path

import duckdb
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.core.chart_drawing import validate_drawing
from backend.db import connection
from backend.routes import drawings

SCHEMA = (Path(connection.__file__).parent / "schema.sql").read_text()


def test_rules():
    assert validate_drawing("line", 100, 105, "#3b82f6") is None
    assert validate_drawing("hline", 100, 100, "#3b82f6") is None
    assert validate_drawing("rect", 100, 100, "#3b82f6")      # flat rectangle
    assert validate_drawing("circle", 100, 105, "#3b82f6")    # unknown kind
    assert validate_drawing("line", 0, 105, "#3b82f6")        # price must be above 0
    assert validate_drawing("line", 100, 105, "blue")         # not a hex colour


@pytest.fixture
def client(monkeypatch):
    conn = duckdb.connect()
    conn.execute(SCHEMA)
    monkeypatch.setattr(drawings, "get_db", lambda: conn)
    app = FastAPI()
    app.include_router(drawings.router, prefix="/api")
    return TestClient(app)


def _drawing(**over):
    body = {"symbol": "hdfcbank", "kind": "rect", "time1": "2026-11-11T09:15:00", "price1": 800,
            "time2": "2026-11-11T11:15:00", "price2": 810, "color": "#22c55e"}
    return {**body, **over}


def test_create_list_update_delete(client):
    created = client.post("/api/drawings", json=_drawing()).json()
    assert created["id"] == 1 and created["symbol"] == "HDFCBANK" and created["time2"] == "2026-11-11T11:15:00"
    client.post("/api/drawings", json=_drawing(symbol="TCS"))
    assert [d["symbol"] for d in client.get("/api/drawings", params={"symbol": "hdfcbank"}).json()] == ["HDFCBANK"]

    moved = client.put("/api/drawings/1", json=_drawing(price2=820, color="#ef4444")).json()
    assert moved["price2"] == 820 and moved["color"] == "#ef4444"

    assert client.delete("/api/drawings/1").json() == {"ok": True}
    assert client.delete("/api/drawings/1").status_code == 404
    assert client.put("/api/drawings/99", json=_drawing()).status_code == 404


def test_bad_drawings_are_rejected(client):
    assert client.post("/api/drawings", json=_drawing(price2=800)).status_code == 400
    assert client.post("/api/drawings", json=_drawing(color="red")).status_code == 400
    assert client.post("/api/drawings", json=_drawing(kind="circle")).status_code == 422
