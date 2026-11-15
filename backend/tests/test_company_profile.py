"""Tests for the company profile parsing, the sync helpers and the read routes. No network."""

from datetime import datetime

import duckdb
import pandas as pd
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.core import company_profile as cp
from backend.data_sync import sync_company_profile as sync
from backend.routes import company_profile as route

NOW = datetime(2026, 11, 15, 12, 0)


def test_normalise_city_aliases_case_and_empty():
    assert cp.normalise_city("  bangalore ") == "Bengaluru"
    assert cp.normalise_city("GURGAON") == "Gurugram"
    assert cp.normalise_city("navi  mumbai") == "Navi Mumbai"
    assert cp.normalise_city("Mumbai") == "Mumbai"
    assert cp.normalise_city("  ") is None
    assert cp.normalise_city(None) is None


def test_profile_row_reads_info_and_tolerates_missing_fields():
    info = {"city": "Mumbai", "zip": "400021", "sector": "Energy", "industry": "Oil & Gas Refining & Marketing",
            "website": "https://www.ril.com", "fullTimeEmployees": 419911}
    row = cp.profile_row("reliance", info, NOW)
    assert row["symbol"] == "RELIANCE" and row["city"] == "Mumbai" and row["pincode"] == "400021"
    assert row["employees"] == 419911 and row["lat"] is None and row["updated_at"] == NOW
    assert list(row) == cp.PROFILE_COLUMNS

    empty = cp.profile_row("XYZ", {}, NOW)
    assert empty["city"] is None and empty["sector"] is None and empty["employees"] is None


@pytest.fixture
def con(monkeypatch):
    c = duckdb.connect(":memory:")
    c.execute("CREATE TABLE stock_ohlcv (date DATE, symbol VARCHAR, close DOUBLE, volume BIGINT)")
    c.execute("""CREATE TABLE company_profile (symbol VARCHAR PRIMARY KEY, city VARCHAR, state VARCHAR, pincode VARCHAR,
                 sector VARCHAR, industry VARCHAR, website VARCHAR, employees BIGINT, lat DOUBLE, lon DOUBLE, updated_at TIMESTAMP)""")
    c.execute("CREATE TABLE city_coordinates (city VARCHAR PRIMARY KEY, state VARCHAR, lat DOUBLE, lon DOUBLE)")
    for mod in (sync, cp):
        monkeypatch.setattr(mod, "get_db", lambda c=c: c)
    monkeypatch.setattr("backend.data_sync.base.get_db", lambda: c)
    return c


def _trade(c, symbol, value):
    c.execute("INSERT INTO stock_ohlcv VALUES ('2026-11-13', ?, ?, 1)", [symbol, value])


def test_symbols_to_fetch_new_first_by_traded_value_then_stale(con):
    for sym, value in [("BIG", 900.0), ("SMALL", 10.0), ("FRESH", 500.0), ("STALE", 800.0)]:
        _trade(con, sym, value)
    con.execute("INSERT INTO company_profile (symbol, updated_at) VALUES ('FRESH', '2026-11-01')")
    con.execute("INSERT INTO company_profile (symbol, updated_at) VALUES ('STALE', '2026-01-01')")
    assert sync.symbols_to_fetch(10, NOW) == ["BIG", "SMALL", "STALE"]
    assert sync.symbols_to_fetch(2, NOW) == ["BIG", "SMALL"]


def test_fill_coordinates_geocodes_once_caches_misses_and_updates_profiles(con, monkeypatch):
    con.execute("""INSERT INTO company_profile (symbol, city) VALUES ('A','Mumbai'), ('B','Mumbai'), ('C','Nowhereville'), ('D', NULL)""")
    calls = []

    def fake_geocode(client, city):
        calls.append(city)
        return {"lat": 19.07, "lon": 72.88, "state": "Maharashtra"} if city == "Mumbai" else None

    monkeypatch.setattr(sync, "geocode_city", fake_geocode)
    monkeypatch.setattr(sync.time, "sleep", lambda s: None)
    assert sync.fill_coordinates() == 1
    assert sorted(calls) == ["Mumbai", "Nowhereville"]  # Mumbai only once

    got = {r[0]: r[1:] for r in con.execute("SELECT symbol, state, lat, lon FROM company_profile").fetchall()}
    assert got["A"] == ("Maharashtra", 19.07, 72.88) and got["B"] == got["A"]
    assert got["C"] == (None, None, None) and got["D"] == (None, None, None)

    calls.clear()
    sync.fill_coordinates()
    assert calls == []  # the miss is cached too


def test_geocode_city_parses_result_and_no_match():
    class R:
        def __init__(self, data): self.data = data
        def raise_for_status(self): pass
        def json(self): return self.data

    class Client:
        def __init__(self, data): self.data, self.params = data, None
        def get(self, url, params=None):
            self.params = params
            return R(self.data)

    hit = Client({"results": [{"latitude": 22.3, "longitude": 73.2, "admin1": "Gujarat"}]})
    assert sync.geocode_city(hit, "Vadodara") == {"lat": 22.3, "lon": 73.2, "state": "Gujarat"}
    assert hit.params["country_code"] == "IN" and hit.params["count"] == 1
    assert sync.geocode_city(Client({}), "Nowhere") is None


def test_run_stores_profiles_and_keeps_going_after_a_failure(con, monkeypatch):
    for sym in ("GOOD", "BAD"):
        _trade(con, sym, 100.0)

    class Ticker:
        def __init__(self, ticker): self.ticker = ticker
        @property
        def info(self):
            if self.ticker.startswith("BAD"):
                raise RuntimeError("HTTP 404")
            return {"city": "Pune", "sector": "Technology"}

    logged = []
    monkeypatch.setattr(sync.yf, "Ticker", Ticker)
    monkeypatch.setattr(sync.time, "sleep", lambda s: None)
    monkeypatch.setattr(sync, "fill_coordinates", lambda: 0)
    monkeypatch.setattr(sync, "log_sync", lambda *a, **k: logged.append(a))
    assert sync.run(limit=10) == 1
    assert [r[0] for r in con.execute("SELECT symbol FROM company_profile").fetchall()] == ["GOOD"]
    assert logged[-1][1] == "partial" and "BAD" in logged[-1][4]


def test_routes_return_profile_404_and_located_filter(con):
    con.execute("""INSERT INTO company_profile (symbol, city, lat, lon, updated_at) VALUES
                   ('A','Mumbai',19.0,72.8,'2026-11-15'), ('B','Pune',NULL,NULL,'2026-11-15')""")
    app = FastAPI()
    app.include_router(route.router)
    client = TestClient(app)
    assert client.get("/company-profile/a").json()["city"] == "Mumbai"
    assert client.get("/company-profile/ZZZ").status_code == 404
    assert [p["symbol"] for p in client.get("/company-profiles").json()] == ["A", "B"]
    assert [p["symbol"] for p in client.get("/company-profiles?located_only=true").json()] == ["A"]
