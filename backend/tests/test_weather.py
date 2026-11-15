"""Tests for the weather sync, the sector notes and the route. Open-Meteo is mocked; no network."""

from datetime import date

import duckdb
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.core import weather_context as wc
from backend.data_sync import sync_weather as sync
from backend.routes import connections

TODAY = date(2026, 11, 15)


def _result(days, rain, temp, gust):
    return {"daily": {"time": days, "precipitation_sum": rain, "temperature_2m_max": temp, "wind_gusts_10m_max": gust}}


DAYS = ["2026-11-14", "2026-11-15", "2026-11-16"]


def test_parse_response_for_a_list_and_a_single_location_and_forecast_flag():
    payload = [_result(DAYS, [0, 1.5, 70.0], [30, 31, 32], [10, 20, 65]), _result(DAYS, [0, 0, 0], [20, 21, 22], [5, 5, 5])]
    df = sync.parse_response(["Mumbai", "Pune"], payload, TODAY)
    assert len(df) == 6 and list(df.columns) == sync.COLUMNS
    mumbai = df[df["city"] == "Mumbai"].set_index("date")
    assert mumbai.loc[date(2026, 11, 16), "precip_mm"] == 70.0
    assert not mumbai.loc[date(2026, 11, 15), "is_forecast"] and mumbai.loc[date(2026, 11, 16), "is_forecast"]
    single = sync.parse_response(["Mumbai"], payload[0], TODAY)  # one city comes back as a dict
    assert len(single) == 3


def test_parse_response_rejects_a_wrong_number_of_locations_and_keeps_missing_values():
    with pytest.raises(ValueError):
        sync.parse_response(["A", "B"], [_result(DAYS, [0] * 3, [1] * 3, [1] * 3)], TODAY)
    df = sync.parse_response(["A"], [_result(DAYS, [None, 2, 3], [1, 2, 3], [1, 2, 3])], TODAY)
    assert df["precip_mm"].isna().sum() == 1


@pytest.mark.parametrize("sector,industry,expect", [
    ("Utilities", "Utilities - Regulated Electric", "electricity"),
    ("Industrials", "Engineering & Construction", "construction"),
    ("Industrials", "Airlines", "flights"),
    ("Basic Materials", "Steel", "mining"),
    ("Technology", "Information Technology Services", None),
    (None, None, None),
])
def test_sector_note(sector, industry, expect):
    note = wc.sector_note(sector, industry)
    assert (note is None) if expect is None else (expect in note.lower())


def test_summarise_flags_and_totals():
    days = [{"precip_mm": 10, "temp_max_c": 41, "wind_gust_kmh": 20}, {"precip_mm": 70, "temp_max_c": 30, "wind_gust_kmh": 65}]
    s = wc.summarise(days)
    assert s["flags"] == ["heavy_rain", "heat", "strong_wind"] and s["rain_total_mm"] == 80
    assert wc.summarise([{"precip_mm": 1, "temp_max_c": 30, "wind_gust_kmh": 10}])["flags"] == []
    assert wc.summarise([])["max_temp_c"] is None


@pytest.fixture
def con(monkeypatch):
    c = duckdb.connect(":memory:")
    c.execute("CREATE TABLE city_weather (city VARCHAR, date DATE, precip_mm DOUBLE, temp_max_c DOUBLE, wind_gust_kmh DOUBLE, is_forecast BOOLEAN, PRIMARY KEY (city, date))")
    c.execute("CREATE TABLE city_coordinates (city VARCHAR PRIMARY KEY, state VARCHAR, lat DOUBLE, lon DOUBLE)")
    c.execute("CREATE TABLE company_profile (symbol VARCHAR PRIMARY KEY, city VARCHAR, state VARCHAR, pincode VARCHAR, sector VARCHAR, industry VARCHAR, website VARCHAR, employees BIGINT, lat DOUBLE, lon DOUBLE, updated_at TIMESTAMP)")
    c.execute("CREATE TABLE sync_log (source VARCHAR PRIMARY KEY, last_synced_at TIMESTAMP, last_date_fetched DATE, status VARCHAR, records_added INTEGER, error_message VARCHAR)")
    for mod in (sync, wc):
        monkeypatch.setattr(mod, "get_db", lambda c=c: c)
    monkeypatch.setattr("backend.data_sync.base.get_db", lambda: c)
    return c


def _cities(con):
    con.execute("INSERT INTO city_coordinates VALUES ('Mumbai', 'MH', 19.0, 72.8), ('Pune', 'MH', 18.5, 73.8), ('Nowhere', NULL, NULL, NULL), ('NoCompany', 'X', 1.0, 2.0)")
    con.execute("INSERT INTO company_profile (symbol, city, sector, industry) VALUES ('A', 'Mumbai', 'Utilities', 'Power'), ('B', 'Pune', 'Technology', 'IT'), ('C', 'Nowhere', NULL, NULL)")


def test_cities_with_coordinates_needs_a_company_and_a_position(con):
    _cities(con)
    assert [c[0] for c in sync.cities_with_coordinates()] == ["Mumbai", "Pune"]


class _FakeClient:
    calls = []

    def __init__(self, *a, **k): pass
    def __enter__(self): return self
    def __exit__(self, *a): return False

    def get(self, url, params=None):
        _FakeClient.calls.append(params)
        n = len(params["latitude"].split(","))

        class R:
            def raise_for_status(self): pass
            def json(self): return [_result(DAYS, [0, 0, 80], [30, 30, 41], [10, 10, 10])] * n
        return R()


def test_run_batches_cities_stores_rows_and_skips_a_recent_rerun(con, monkeypatch):
    _cities(con)
    _FakeClient.calls = []
    monkeypatch.setattr(sync.httpx, "Client", _FakeClient)
    monkeypatch.setattr(sync.time, "sleep", lambda s: None)
    assert sync.run() == 6                                   # 2 cities x 3 days
    assert len(_FakeClient.calls) == 1 and _FakeClient.calls[0]["latitude"] == "19.0,18.5"
    assert con.execute("SELECT COUNT(*) FROM city_weather").fetchone()[0] == 6
    assert sync.run() == 0 and len(_FakeClient.calls) == 1   # ran less than 3 hours ago
    assert sync.run(force=True) == 6
    assert con.execute("SELECT COUNT(*) FROM city_weather").fetchone()[0] == 6  # replaced, not duplicated


def test_run_marks_a_failed_batch_and_stores_nothing(con, monkeypatch):
    _cities(con)

    class Boom(_FakeClient):
        def get(self, url, params=None): raise RuntimeError("HTTP 429")

    logged = []
    monkeypatch.setattr(sync.httpx, "Client", Boom)
    monkeypatch.setattr(sync.time, "sleep", lambda s: None)
    monkeypatch.setattr(sync, "log_sync", lambda *a, **k: logged.append(a))
    assert sync.run() == 0 and logged[-1][1] == "failed"


def test_weather_context_summary_note_and_missing_data(con):
    _cities(con)
    for i, d in enumerate(["2026-11-13", "2026-11-14", "2026-11-15", "2026-11-16", "2026-11-17"]):
        con.execute("INSERT INTO city_weather VALUES ('Mumbai', ?, ?, 30, 10, ?)", [d, 80.0 if i == 4 else 0.0, i > 2])
    res = wc.weather_context("a", today=TODAY)
    assert res["city"] == "Mumbai" and len(res["daily"]) == 5
    assert res["summary"]["flags"] == ["heavy_rain"]                    # only today and later count
    assert "electricity" in res["sector_note"] and "not a forecast" in res["disclaimer"]
    assert wc.weather_context("B", today=TODAY) is None                  # city but no weather rows
    assert wc.weather_context("C", today=TODAY) is None                  # profile without a city
    assert wc.weather_context("ZZZ", today=TODAY) is None


def test_route_200_and_404(con, monkeypatch):
    _cities(con)
    con.execute("INSERT INTO city_weather VALUES ('Mumbai', ?, 0, 30, 10, FALSE)", [date.today()])
    app = FastAPI()
    app.include_router(connections.router)
    client = TestClient(app)
    assert client.get("/stock/A/weather").json()["city"] == "Mumbai"
    assert client.get("/stock/B/weather").status_code == 404
