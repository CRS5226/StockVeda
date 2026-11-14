"""Tests for the fixed deposit routes."""

from datetime import date, timedelta
from pathlib import Path

import duckdb
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.db import connection
from backend.routes import portfolio, portfolio_fd

SCHEMA = (Path(connection.__file__).parent / "schema.sql").read_text()


@pytest.fixture
def client(monkeypatch):
    conn = duckdb.connect()
    conn.execute(SCHEMA)
    for module in (portfolio, portfolio_fd):
        monkeypatch.setattr(module, "get_db", lambda: conn)
    conn.execute("INSERT INTO portfolios (id, name) VALUES (1, 'Mine')")
    app = FastAPI()
    app.include_router(portfolio.router, prefix="/api")
    app.include_router(portfolio_fd.router, prefix="/api")
    return TestClient(app)


def _fd(**over):
    today = date.today()
    body = {"name": "SBI FD", "principal": 100000, "annual_rate": 8, "start_date": str(today - timedelta(days=365)),
            "maturity_date": str(today + timedelta(days=365)), "compounding": "quarterly", "payout": "cumulative"}
    return {**body, **over}


def test_add_list_edit_delete(client):
    r = client.post("/api/portfolios/1/fds", json=_fd()).json()
    fd = r["fds"][0]
    assert fd["status"] == "active" and 107_000 < fd["current_value"] < 109_000     # about a year of 8% quarterly
    assert fd["maturity_value"] > fd["current_value"] > fd["principal"]
    assert r["totals"]["principal"] == 100000

    r = client.put(f"/api/portfolios/1/fds/{fd['id']}", json=_fd(payout="monthly")).json()
    assert r["fds"][0]["payout"] == "monthly" and r["fds"][0]["interest_received"] > 0
    assert client.delete(f"/api/portfolios/1/fds/{fd['id']}").json()["fds"] == []


def test_bad_terms_are_rejected(client):
    assert client.post("/api/portfolios/1/fds", json=_fd(maturity_date=str(date.today() - timedelta(days=400)))).status_code == 400
    assert client.post("/api/portfolios/1/fds", json=_fd(principal=0)).status_code == 422
    assert client.post("/api/portfolios/1/fds", json=_fd(payout="daily")).status_code == 422
    assert client.post("/api/portfolios/9/fds", json=_fd()).status_code == 404


def test_deleting_a_portfolio_removes_its_fds(client):
    client.post("/api/portfolios/1/fds", json=_fd())
    client.delete("/api/portfolios/1")
    assert client.get("/api/portfolios/1/fds").status_code == 404
