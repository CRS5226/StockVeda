"""Tests for the per-day NSE bulk/block deals sync. No network: NSE calls are mocked."""

from datetime import date

import duckdb
import pytest

from backend.data_sync import sync_bulk_deals as sync

BULK = {
    "BD_DT_DATE": "02-NOV-2026", "BD_SYMBOL": "aartech ", "BD_SCRIP_NAME": "Aartech Solonics Limited",
    "BD_CLIENT_NAME": "KRISHNA AWTAR KABRA", "BD_BUY_SELL": "buy", "BD_QTY_TRD": 189020,
    "BD_TP_WATP": 40.92, "BD_REMARKS": "-",
}


def test_parse_deals_cleans_fields_and_skips_bad_rows():
    bad = {"BD_DT_DATE": "not a date", "BD_SYMBOL": "X"}
    df = sync.parse_deals([BULK, bad], "bulk")
    assert len(df) == 1
    row = df.iloc[0]
    assert row["date"] == date(2026, 11, 2)
    assert row["symbol"] == "AARTECH" and row["buy_sell"] == "BUY"
    assert row["quantity"] == 189020 and row["price"] == 40.92 and row["deal_type"] == "bulk"
    assert list(df.columns) == sync.COLUMNS


def test_parse_deals_empty_input_keeps_columns():
    assert list(sync.parse_deals([], "block").columns) == sync.COLUMNS


@pytest.fixture
def con(monkeypatch):
    c = duckdb.connect(":memory:")
    c.execute("""CREATE TABLE bulk_deals (date DATE, symbol VARCHAR, scrip_name VARCHAR, client_name VARCHAR,
                 buy_sell VARCHAR, quantity BIGINT, price DOUBLE, deal_type VARCHAR)""")
    monkeypatch.setattr(sync, "get_db", lambda: c)
    monkeypatch.setattr(sync.time, "sleep", lambda s: None)
    return c


def test_store_day_replaces_that_day_only(con):
    d1, d2 = date(2026, 11, 2), date(2026, 11, 3)
    sync.store_day(d1, sync.parse_deals([BULK], "bulk"))
    other = dict(BULK, BD_DT_DATE="03-NOV-2026")
    sync.store_day(d2, sync.parse_deals([other], "bulk"))
    sync.store_day(d1, sync.parse_deals([BULK, BULK], "bulk"))  # re-run of day 1
    counts = dict(con.execute("SELECT date, COUNT(*) FROM bulk_deals GROUP BY date").fetchall())
    assert counts == {d1: 2, d2: 1}


def test_run_fetches_each_day_with_equal_from_and_to(con, monkeypatch):
    days = [date(2026, 11, 2), date(2026, 11, 3)]
    monkeypatch.setattr(sync, "_days_to_fetch", lambda n: days)
    calls, logged = [], []

    def fake_get(url, params=None):
        calls.append(params)

        class R:
            def raise_for_status(self): pass
            def json(self): return {"data": [dict(BULK, BD_DT_DATE=_fmt(params["from"]))] if params["optionType"] == "bulk_deals" else []}
        return R()

    def _fmt(s):  # DD-MM-YYYY -> DD-MON-YYYY
        return date(int(s[6:]), int(s[3:5]), int(s[:2])).strftime("%d-%b-%Y").upper()

    monkeypatch.setattr(sync, "nse_get", fake_get)
    monkeypatch.setattr(sync, "log_sync", lambda *a, **k: logged.append(a))
    assert sync.run() == 2
    assert all(c["from"] == c["to"] for c in calls)
    assert len(calls) == 4  # bulk + block for each of two days
    assert logged[-1][1] == "success" and logged[-1][3] == days[-1]


def test_failed_day_stops_the_bookmark_but_later_days_are_stored(con, monkeypatch):
    days = [date(2026, 11, 2), date(2026, 11, 3), date(2026, 11, 4)]
    monkeypatch.setattr(sync, "_days_to_fetch", lambda n: days)
    logged = []

    def fake_fetch(day, option_type):
        if day == days[1]:
            raise RuntimeError("HTTP 503")
        return [dict(BULK, BD_DT_DATE=day.strftime("%d-%b-%Y").upper())] if option_type == "bulk_deals" else []

    monkeypatch.setattr(sync, "_fetch_day", fake_fetch)
    monkeypatch.setattr(sync, "log_sync", lambda *a, **k: logged.append((a, k)))
    assert sync.run() == 2
    status, last_date = logged[-1][0][1], logged[-1][0][3]
    assert status == "partial"
    assert last_date == days[0]  # bookmark stops before the failed day
    assert "2026-11-03" in logged[-1][0][4]


def test_run_when_up_to_date_does_nothing(con, monkeypatch):
    monkeypatch.setattr(sync, "_days_to_fetch", lambda n: [])
    assert sync.run() == 0
