"""Tests for the company events sync, parsing and routes. NSE calls are mocked; no network."""

from datetime import date, datetime

import duckdb
import pandas as pd
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.core import company_events as ce
from backend.data_sync import sync_company_events as sync
from backend.routes import company_events as route

ORDER = {"symbol": "lt", "desc": "Bagging/Receiving of orders/contracts", "an_dt": "13-Nov-2026 10:37:33",
         "attchmntText": "  Larsen & Toubro has informed the Exchange about orders\n - Ultra-Mega Order ", "attchmntFile": "https://x/a.pdf"}
RATING = dict(ORDER, symbol="ABC", desc="Credit Rating", an_dt="12-Nov-2026 09:00:00", attchmntFile="")
NOISE = dict(ORDER, symbol="ZZZ", desc="Copy of Newspaper Publication")
MEETING = {"bm_symbol": "lt", "bm_date": "17-Nov-2026", "bm_purpose": "Financial Results", "bm_desc": "Results for the quarter"}


def test_parse_events_keeps_only_material_categories_and_cleans_text():
    df = ce.parse_events([ORDER, RATING, NOISE, {"symbol": "BAD", "desc": "Credit Rating", "an_dt": "nope"}])
    assert list(df["symbol"]) == ["LT", "ABC"]
    row = df.iloc[0]
    assert row["kind"] == "order" and row["event_time"] == datetime(2026, 11, 13, 10, 37, 33)
    assert row["subject"] == "Larsen & Toubro has informed the Exchange about orders - Ultra-Mega Order"
    assert pd.isna(df.iloc[1]["pdf_url"]) and list(df.columns) == ce.EVENT_COLUMNS


def test_parse_meetings_and_empty_input():
    df = ce.parse_meetings([MEETING, {"bm_symbol": "X", "bm_date": "??"}])
    assert len(df) == 1 and df.iloc[0]["symbol"] == "LT" and df.iloc[0]["meeting_date"] == date(2026, 11, 17)
    assert list(ce.parse_events([]).columns) == ce.EVENT_COLUMNS


def test_date_chunks_cover_the_range_without_gaps():
    chunks = sync.date_chunks(date(2026, 11, 1), date(2026, 11, 16), 7)
    assert chunks == [(date(2026, 11, 1), date(2026, 11, 7)), (date(2026, 11, 8), date(2026, 11, 14)), (date(2026, 11, 15), date(2026, 11, 16))]
    assert sync.date_chunks(date(2026, 11, 5), date(2026, 11, 4), 7) == []


@pytest.fixture
def con(monkeypatch):
    c = duckdb.connect(":memory:")
    c.execute("CREATE TABLE company_events (symbol VARCHAR, event_time TIMESTAMP, category VARCHAR, kind VARCHAR, subject VARCHAR, pdf_url VARCHAR)")
    c.execute("CREATE TABLE board_meetings (symbol VARCHAR, meeting_date DATE, purpose VARCHAR, description VARCHAR)")
    for mod in (sync, ce):
        monkeypatch.setattr(mod, "get_db", lambda c=c: c)
    return c


def test_replace_swaps_only_the_given_date_range(con):
    con.execute("INSERT INTO company_events VALUES ('OLD', '2026-11-10 10:00:00', 'Credit Rating', 'rating', 's', NULL), ('KEEP', '2026-11-05 10:00:00', 'Credit Rating', 'rating', 's', NULL)")
    df = ce.parse_events([ORDER])
    n = sync._replace("company_events", "event_time", date(2026, 11, 8), date(2026, 11, 14), df, ce.EVENT_COLUMNS)
    assert n == 1
    assert sorted(r[0] for r in con.execute("SELECT symbol FROM company_events").fetchall()) == ["KEEP", "LT"]
    sync._replace("company_events", "event_time", date(2026, 11, 8), date(2026, 11, 14), df, ce.EVENT_COLUMNS)  # re-run
    assert con.execute("SELECT COUNT(*) FROM company_events WHERE symbol = 'LT'").fetchone()[0] == 1


class _Date(date):
    @classmethod
    def today(cls): return cls(2026, 11, 15)


def test_run_fetches_chunks_keeps_bookmark_behind_today_and_marks_failed_chunks(con, monkeypatch):
    monkeypatch.setattr(sync, "date", _Date)
    monkeypatch.setattr(sync, "last_synced_date", lambda src: date(2026, 11, 7) if src == sync.EVENTS_SOURCE else date(2026, 11, 14))
    monkeypatch.setattr(sync.time, "sleep", lambda s: None)
    calls, logged = [], []

    def fake_fetch(url, start, end):
        calls.append((url.rsplit("/", 1)[-1], start, end))
        if url == sync.ANNOUNCEMENTS_URL and start == date(2026, 11, 15):
            raise RuntimeError("HTTP 503")
        return [ORDER] if url == sync.ANNOUNCEMENTS_URL else [MEETING]

    monkeypatch.setattr(sync, "_fetch", fake_fetch)
    monkeypatch.setattr(sync, "log_sync", lambda *a, **k: logged.append(a))
    sync.run()
    ann = [c for c in calls if c[0] == "corporate-announcements"]
    assert ann[0][1] == date(2026, 11, 8)                       # starts the day after the bookmark
    assert ann[-1][1] == date(2026, 11, 15)                     # includes today
    events_log = [a for a in logged if a[0] == sync.EVENTS_SOURCE][-1]
    assert events_log[1] == "partial" and events_log[3] == date(2026, 11, 14)  # stops before the failed chunk
    upcoming = [c for c in calls if c[0] == "corporate-board-meetings"]
    assert upcoming[-1][1] == date(2026, 11, 15) and upcoming[-1][2] == date(2026, 11, 15) + sync.timedelta(days=sync.UPCOMING_DAYS)
    assert con.execute("SELECT COUNT(*) FROM board_meetings").fetchone()[0] >= 1


def _seed(con):
    con.execute("""INSERT INTO company_events VALUES
        ('LT', '2026-11-13 10:37:33', 'Bagging/Receiving of orders/contracts', 'order', 'big order', 'https://x/a.pdf'),
        ('LT', '2026-03-01 10:00:00', 'Bagging/Receiving of orders/contracts', 'order', 'older order', NULL),
        ('LT', '2025-01-01 10:00:00', 'Bagging/Receiving of orders/contracts', 'order', 'ancient order', NULL),
        ('LT', '2026-11-01 10:00:00', 'Credit Rating', 'rating', 'rating', NULL),
        ('ABC', '2026-11-12 09:00:00', 'Credit Rating', 'rating', 'abc rating', NULL)""")
    con.execute("INSERT INTO board_meetings VALUES ('LT', '2026-11-20', 'Financial Results', 'r'), ('LT', '2026-11-10', 'Past', 'p'), ('LT', '2026-12-01', 'Dividend', 'd')")


def test_stock_events_counts_orders_in_a_year_and_finds_next_meeting(con):
    _seed(con)
    res = ce.stock_events("lt", today=date(2026, 11, 15))
    assert res["history_from"] == "2025-01-01"
    assert res["order_wins_12m"] == 2                                   # the 2025 one is outside the year
    assert [e["subject"] for e in res["events"]] == ["big order", "rating", "older order"]
    assert res["events"][0]["event_time"] == "2026-11-13 10:37"
    assert res["next_meeting"]["meeting_date"] == "2026-11-20"
    assert [m["meeting_date"] for m in res["upcoming_meetings"]] == ["2026-11-20", "2026-12-01"]
    only_orders = ce.stock_events("LT", kind="order", today=date(2026, 11, 15))
    assert {e["kind"] for e in only_orders["events"]} == {"order"}


def test_recent_events_market_wide_and_kind_filter(con):
    _seed(con)
    assert [e["symbol"] for e in ce.recent_events(days=20, today=date(2026, 11, 15))] == ["LT", "ABC", "LT"]
    assert [e["symbol"] for e in ce.recent_events(kind="rating", days=20, today=date(2026, 11, 15))] == ["ABC", "LT"]
    assert ce.recent_events(kind="not-a-kind", days=20, today=date(2026, 11, 15)) != []  # unknown kind is ignored, not an error


def test_routes(con):
    _seed(con)
    app = FastAPI()
    app.include_router(route.router)
    client = TestClient(app)
    assert client.get("/stock/LT/events?days=30").json()["symbol"] == "LT"
    assert client.get("/events/recent?kind=order&days=3650").status_code == 200
    assert client.get("/stock/NONE/events").json()["events"] == []
