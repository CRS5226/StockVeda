"""Tests for the instrument type guess and its use in portfolio holdings."""

from pathlib import Path

import duckdb
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.core.instrument_type import effective_kind, guess_kind
from backend.db import connection
from backend.routes import portfolio

SCHEMA = (Path(connection.__file__).parent / "schema.sql").read_text()


@pytest.mark.parametrize("symbol,name,expected", [
    ("EMBASSY", None, "reit"), ("mindspace", None, "reit"), ("BIRET", "", "reit"), ("NXST", None, "reit"), ("KRT", None, "reit"),
    ("INDIGRID", None, "invit"), ("XYZ", "Some Infrastructure Investment Trust", "invit"),
    ("NIFTYBEES", None, "etf"), ("CPSEETF", None, "etf"), ("MON100", None, "etf"), ("MAFANG", None, "etf"), ("MASPTOP50", None, "etf"),
    ("ZZZ", "Acme Gold ETF", "etf"), ("TCS", "Tata Consultancy Services Limited", "stock"), ("ABB", "ABB India Limited", "stock"),
])
def test_guess_kind(symbol, name, expected):
    assert guess_kind(symbol, name) == expected


def test_a_hand_set_type_wins_over_the_guess():
    assert effective_kind("etf", "TCS") == "etf"
    assert effective_kind(None, "TCS") == "stock"
    assert effective_kind("nonsense", "NIFTYBEES") == "etf"      # unknown values are ignored


@pytest.fixture
def client(monkeypatch):
    conn = duckdb.connect()
    conn.execute(SCHEMA)
    conn.execute("INSERT INTO portfolios (id, name) VALUES (1, 'Mine')")
    conn.execute("INSERT INTO nse_symbols (symbol, company_name) VALUES ('TCS', 'Tata Consultancy Services Limited'), ('SBIGOLD', 'SBI Gold ETF')")
    monkeypatch.setattr(portfolio, "get_db", lambda: conn)
    app = FastAPI()
    app.include_router(portfolio.router, prefix="/api")
    return TestClient(app)


def _kinds(response):
    return {h["symbol"]: (h["kind"], h["kind_override"]) for h in response.json()["holdings"]}


def test_holdings_carry_their_type_and_it_can_be_set_by_hand(client):
    for sym in ("TCS", "NIFTYBEES", "EMBASSY", "SBIGOLD"):
        client.post("/api/portfolios/1/holdings", json={"symbol": sym})
    kinds = _kinds(client.get("/api/portfolios/1"))
    assert kinds == {"TCS": ("stock", None), "NIFTYBEES": ("etf", None), "EMBASSY": ("reit", None), "SBIGOLD": ("etf", None)}   # SBIGOLD: from its company name

    tcs = next(h for h in client.get("/api/portfolios/1").json()["holdings"] if h["symbol"] == "TCS")
    after = client.put(f"/api/portfolios/1/holdings/{tcs['id']}", json={"symbol": "TCS", "kind": "invit"})
    assert _kinds(after)["TCS"] == ("invit", "invit")
    reset = client.put(f"/api/portfolios/1/holdings/{tcs['id']}", json={"symbol": "TCS", "kind": None})
    assert _kinds(reset)["TCS"] == ("stock", None)
    assert client.post("/api/portfolios/1/holdings", json={"symbol": "TCS", "kind": "bond"}).status_code == 422
