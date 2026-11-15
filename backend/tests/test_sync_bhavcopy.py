"""Tests for the NSE price sync: first sync, retrying failed days, and backfilling older history.

NSE is replaced by a fake client and the database by an in-memory DuckDB; nothing touches the network.
"""

import io
import zipfile
from datetime import date, timedelta

import duckdb
import pandas as pd
import pytest

from backend.data_sync import base
from backend.data_sync import sync_bhavcopy as sync
from backend.data_sync.base import business_days_between

TODAY = date(2026, 11, 18)          # a Wednesday
SYMBOLS = ("AAA", "BBB")


class _Date(date):
    @classmethod
    def today(cls):
        return cls(2026, 11, 18)


BLANK_DAY = date(2026, 10, 27)        # when asked, this day's file has a blank open price for AAA and no close at all for BBB


def _zip_for(d: date, symbols=SYMBOLS, close=100.0, blank=False) -> bytes:
    rows = ["SYMBOL, SERIES, OPEN_PRICE, HIGH_PRICE, LOW_PRICE, CLOSE_PRICE, NET_TRDQTY"]
    for s in symbols:
        if blank and s == "AAA":
            rows.append(f"{s}, EQ,  , 101, 98, {close}, 1000")
        elif blank and s == "BBB":
            rows.append(f"{s}, EQ, 99, 101, 98,  , 1000")
        else:
            rows.append(f"{s}, EQ, 99, 101, 98, {close}, 1000")
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr(f"pd{d.strftime('%d%m%Y')}.csv", "\n".join(rows))
    return buf.getvalue()


def _mto_for(symbols=SYMBOLS) -> str:
    return "\n".join(f"20,1,{s},EQ,1000,400,40.0" for s in symbols)


class FakeResponse:
    def __init__(self, status=200, content=b"", text=""):
        self.status_code, self.content, self.text = status, content, text

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}")


class FakeNse:
    """Answers the two download URLs per day; holidays are 404 and `failing` days raise a server error."""

    def __init__(self, holidays=(), failing=(), blank_days=()):
        self.holidays, self.failing, self.blank_days = set(holidays), set(failing), set(blank_days)
        self.days_asked: list[date] = []     # one entry per day, in the order the sync asked for them

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def get(self, url):
        if "/pr/PR" in url:
            stamp = url.rsplit("PR", 1)[1][:6]
            d = date(2000 + int(stamp[4:6]), int(stamp[2:4]), int(stamp[0:2]))
            self.days_asked.append(d)
        else:
            stamp = url.rsplit("MTO_", 1)[1][:8]
            d = date(int(stamp[4:8]), int(stamp[2:4]), int(stamp[0:2]))
        if d in self.holidays:
            return FakeResponse(404)
        if d in self.failing:
            return FakeResponse(503)
        return FakeResponse(200, content=_zip_for(d, blank=d in self.blank_days), text=_mto_for()) if "/pr/PR" in url else FakeResponse(200, text=_mto_for())


@pytest.fixture
def env(monkeypatch):
    con = duckdb.connect(":memory:")
    con.execute("CREATE TABLE stock_ohlcv (date DATE, symbol VARCHAR, open DOUBLE, high DOUBLE, low DOUBLE, close DOUBLE, volume BIGINT, PRIMARY KEY (date, symbol))")
    con.execute("CREATE TABLE stock_delivery (date DATE, symbol VARCHAR, delivery_qty BIGINT, delivery_pct DOUBLE, PRIMARY KEY (date, symbol))")
    con.execute("CREATE TABLE sync_log (source VARCHAR PRIMARY KEY, last_synced_at TIMESTAMP, last_date_fetched DATE, status VARCHAR, records_added INTEGER, error_message VARCHAR)")
    monkeypatch.setattr(base, "get_db", lambda: con)
    monkeypatch.setattr(sync, "get_db", lambda: con)
    monkeypatch.setattr(sync, "date", _Date)
    monkeypatch.setattr(sync.time, "sleep", lambda s: None)
    monkeypatch.setattr(sync.settings, "bhavcopy_lookback_days", 30)
    monkeypatch.setattr(sync, "FULL_MARKET_MIN_SYMBOLS", 2)

    class Env:
        db = con

        def use(self, nse):
            monkeypatch.setattr(sync, "get_client", lambda timeout=None: nse)
            return nse

        def marker(self, source):
            row = con.execute("SELECT last_date_fetched, status FROM sync_log WHERE source = ?", [source]).fetchone()
            return row if row else (None, None)

        def dates(self):
            return [r[0] for r in con.execute("SELECT DISTINCT date FROM stock_ohlcv ORDER BY date").fetchall()]

    return Env()


START = date(2026, 10, 19)          # TODAY - 30 days is Oct 19, a Monday


def test_pure_helpers():
    assert sync.window_start(TODAY, 30) == START
    assert sync.window_start(date(2026, 11, 15), 400) == date(2025, 10, 13)          # lands on a Monday
    assert sync.history_gap_days(TODAY, 30, None) == []
    assert sync.history_gap_days(TODAY, 30, date(2026, 10, 24)) == []                # starts within a week of the window
    gap = sync.history_gap_days(TODAY, 30, date(2026, 11, 2))
    assert gap[0] == START and gap[-1] == date(2026, 10, 30)
    assert all(d.weekday() < 5 for d in gap)
    assert [len(c) for c in sync._chunks(list(range(45)), 20)] == [20, 20, 5]


def test_lookback_setting_is_clamped(monkeypatch):
    for configured, expected in [(400, 400), (5, sync.MIN_LOOKBACK_DAYS), (99999, sync.MAX_LOOKBACK_DAYS)]:
        monkeypatch.setattr(sync.settings, "bhavcopy_lookback_days", configured)
        assert sync.lookback_days() == expected


def test_first_sync_covers_the_window_and_marks_history_complete(env):
    nse = env.use(FakeNse(holidays=[date(2026, 11, 9)]))
    expected_days = [d for d in business_days_between(START, TODAY) if d != date(2026, 11, 9)]
    stored = sync.run()
    assert env.dates() == expected_days
    assert stored == len(expected_days) * len(SYMBOLS) * 2         # prices and delivery
    assert env.marker(sync.SOURCE_ID) == (TODAY, "success")
    assert env.marker(sync.HISTORY_SOURCE) == (START, "success")
    nse.days_asked.clear()
    assert sync.run() == 0 and nse.days_asked == []                 # up to date: nothing is asked for


def test_a_failed_day_stops_the_bookmark_and_is_retried(env):
    failing = date(2026, 11, 5)
    nse = env.use(FakeNse(failing=[failing]))
    sync.run()
    assert env.marker(sync.SOURCE_ID) == (date(2026, 11, 4), "partial")
    assert failing not in env.dates() and TODAY in env.dates()      # later days were still stored

    retry = env.use(FakeNse())
    sync.run()
    assert retry.days_asked[0] == failing                           # resumes at the failed day
    assert env.marker(sync.SOURCE_ID) == (TODAY, "success")
    assert failing in env.dates()
    assert env.db.execute("SELECT COUNT(*) FROM stock_ohlcv").fetchone()[0] == len(env.dates()) * len(SYMBOLS)   # no duplicates


def _seed_recent_history(env, first=date(2026, 11, 2), last=date(2026, 11, 17)):
    """An older database: full-market days from `first`, and one stock with older yfinance-style history."""
    for d in business_days_between(first, last):
        for s in SYMBOLS:
            env.db.execute("INSERT INTO stock_ohlcv VALUES (?, ?, 1, 1, 1, 50, 1)", [d, s])
    env.db.execute("INSERT INTO stock_ohlcv VALUES (?, 'AAA', 999, 999, 999, 999, 1)", [date(2026, 10, 22)])  # one stock only
    env.db.execute("INSERT INTO sync_log VALUES (?, now(), ?, 'success', 1, NULL)", [sync.SOURCE_ID, last])


def test_backfill_fills_older_days_newest_first_and_keeps_existing_rows(env):
    _seed_recent_history(env)
    nse = env.use(FakeNse())
    sync.run()
    older = [d for d in nse.days_asked if d < date(2026, 11, 2)]
    assert older == sorted(older, reverse=True)                                       # newest first, so stored history stays contiguous
    assert set(older) == set(business_days_between(START, date(2026, 10, 30)))
    kept = env.db.execute("SELECT close FROM stock_ohlcv WHERE date = ? AND symbol = 'AAA'", [date(2026, 10, 22)]).fetchone()[0]
    assert kept == 999                                                                # an existing row is never overwritten
    filled = env.db.execute("SELECT COUNT(*) FROM stock_ohlcv WHERE date = ? AND symbol = 'BBB'", [date(2026, 10, 22)]).fetchone()[0]
    assert filled == 1                                                                # the missing stock on that day was added
    assert env.marker(sync.HISTORY_SOURCE) == (START, "success")
    nse.days_asked.clear()
    sync.run()
    assert not [d for d in nse.days_asked if d < date(2026, 11, 2)]                   # a second run does not fetch the gap again


def test_backfill_holidays_are_not_failures(env):
    _seed_recent_history(env)
    env.use(FakeNse(holidays=[date(2026, 10, 26), START]))
    sync.run()
    assert env.marker(sync.HISTORY_SOURCE) == (START, "success")


def test_backfill_failure_stops_the_marker_and_resumes_after_it(env, monkeypatch):
    _seed_recent_history(env)
    failing = date(2026, 10, 27)
    env.use(FakeNse(failing=[failing]))
    sync.run()
    assert env.marker(sync.HISTORY_SOURCE) == (date(2026, 10, 28), "partial")         # complete from the day after the failure
    count_after_failure = env.db.execute("SELECT COUNT(*) FROM stock_ohlcv").fetchone()[0]

    retry = env.use(FakeNse())
    sync.run()
    assert failing in retry.days_asked and env.marker(sync.HISTORY_SOURCE) == (START, "success")
    assert failing in env.dates()
    total = env.db.execute("SELECT COUNT(*) FROM stock_ohlcv").fetchone()[0]
    assert total > count_after_failure
    assert total == len(env.dates()) * len(SYMBOLS)                                   # nothing stored twice


def test_backfill_stops_after_the_failing_chunk(env, monkeypatch):
    _seed_recent_history(env)
    monkeypatch.setattr(sync, "CHUNK_DAYS", 3)
    nse = env.use(FakeNse(failing=[date(2026, 10, 28)]))
    sync.run()
    older = [d for d in nse.days_asked if d < date(2026, 11, 2)]
    assert START not in older                                                          # the oldest chunk was never asked for
    assert env.marker(sync.HISTORY_SOURCE) == (date(2026, 10, 29), "partial")


def test_a_long_run_of_missing_days_is_a_failure_not_a_set_of_holidays(env):
    run_of_holidays = business_days_between(date(2026, 10, 26), date(2026, 11, 3))        # 7 business days in a row
    assert len(run_of_holidays) >= sync.MAX_MISSING_STREAK
    env.use(FakeNse(holidays=run_of_holidays))
    sync.run()
    last, status = env.marker(sync.SOURCE_ID)
    assert status == "partial"
    assert last < run_of_holidays[sync.MAX_MISSING_STREAK - 1]            # the bookmark stops before the day that looked like a block


def test_a_short_run_of_holidays_is_fine(env):
    env.use(FakeNse(holidays=business_days_between(date(2026, 11, 9), date(2026, 11, 12))))   # four business days
    sync.run()
    assert env.marker(sync.SOURCE_ID) == (TODAY, "success")


def test_blank_prices_in_an_old_file_are_stored_as_empty_not_a_crash(env):
    env.use(FakeNse(blank_days=[BLANK_DAY]))
    sync.run()
    row = env.db.execute("SELECT open, close FROM stock_ohlcv WHERE date = ? AND symbol = 'AAA'", [BLANK_DAY]).fetchall()
    assert row == [(None, 100.0)]                                                  # blank open kept as empty
    missing = env.db.execute("SELECT COUNT(*) FROM stock_ohlcv WHERE date = ? AND symbol = 'BBB'", [BLANK_DAY]).fetchall()[0][0]
    assert missing == 0                                                            # no close price: the row is dropped
    assert env.marker(sync.SOURCE_ID) == (TODAY, "success")


def test_blank_prices_do_not_stop_a_backfill(env):
    _seed_recent_history(env)
    env.use(FakeNse(blank_days=[BLANK_DAY]))
    sync.run()
    assert env.marker(sync.HISTORY_SOURCE) == (START, "success")


def test_a_store_error_is_logged_with_its_message_and_the_marker_stays(env, monkeypatch):
    _seed_recent_history(env)
    env.use(FakeNse())
    real_store = sync._store

    def broken_store(bhav, deliv, only_missing):
        if only_missing:
            raise RuntimeError("disk full")
        return real_store(bhav, deliv, only_missing)

    monkeypatch.setattr(sync, "_store", broken_store)
    sync.run()
    row = env.db.execute("SELECT status, error_message, last_date_fetched FROM sync_log WHERE source = ?", [sync.HISTORY_SOURCE]).fetchall()[0]
    assert row[0] == "failed" and "disk full" in row[1]
    assert row[2] == date(2026, 11, 2)                                              # still where it started: the full-market start


def test_no_backfill_on_an_empty_database_other_than_the_first_sync(env):
    nse = env.use(FakeNse())
    sync._backfill_history(TODAY, 30)
    assert nse.days_asked == []


def test_insert_missing_df_adds_only_new_keys(env):
    env.db.execute("INSERT INTO stock_ohlcv VALUES ('2026-10-20', 'AAA', 1, 1, 1, 1, 1)")
    df = pd.DataFrame([
        {"date": date(2026, 10, 20), "symbol": "AAA", "open": 9, "high": 9, "low": 9, "close": 9, "volume": 9},
        {"date": date(2026, 10, 20), "symbol": "BBB", "open": 2, "high": 2, "low": 2, "close": 2, "volume": 2},
    ])
    assert base.insert_missing_df(df, "stock_ohlcv") == 1
    assert env.db.execute("SELECT close FROM stock_ohlcv WHERE symbol = 'AAA'").fetchone()[0] == 1
    assert base.insert_missing_df(df.iloc[0:0], "stock_ohlcv") == 0
