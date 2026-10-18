"""Tests for the SMC chart timeframes: 4h / weekly / monthly resampling and the missing-bar estimate."""

from datetime import date, datetime, timedelta
from pathlib import Path

import duckdb
import pandas as pd
import pytest

from backend.core import timeframes
from backend.core.timeframes import load_candles, resample_ohlcv

SCHEMA = (Path(timeframes.__file__).parents[1] / "db" / "schema.sql").read_text()


def _bars(rows):
    return pd.DataFrame(rows, columns=["date", "open", "high", "low", "close", "volume"]).assign(
        date=lambda d: pd.to_datetime(d["date"]))


def test_4h_buckets_split_at_1315():
    hourly = _bars([
        ("2026-10-12 09:15", 10, 12, 9, 11, 100), ("2026-10-12 10:15", 11, 15, 10, 14, 100),
        ("2026-10-12 11:15", 14, 14, 8, 9, 100), ("2026-10-12 12:15", 9, 10, 9, 10, 100),
        ("2026-10-12 13:15", 10, 11, 10, 11, 50), ("2026-10-12 14:15", 11, 13, 11, 12, 50),
        ("2026-10-12 15:15", 12, 12, 7, 8, 50),
    ])
    out = resample_ohlcv(hourly, "4h")
    assert [str(d) for d in out["date"]] == ["2026-10-12 09:15:00", "2026-10-12 13:15:00"]
    first, second = out.iloc[0], out.iloc[1]
    assert (first.open, first.high, first.low, first.close, first.volume) == (10, 15, 8, 10, 400)
    assert (second.open, second.high, second.low, second.close, second.volume) == (10, 13, 7, 8, 150)


def test_weekly_and_monthly_are_stamped_on_first_trading_day():
    # Mon 12 Oct is a holiday: the week starts Tue 13 Oct, the month's first bar is Thu 1 Oct.
    daily = _bars([
        ("2026-10-01", 1, 2, 1, 2, 10), ("2026-10-05", 2, 3, 2, 3, 10),
        ("2026-10-13", 3, 5, 3, 4, 10), ("2026-10-14", 4, 6, 1, 5, 10),
    ])
    weekly = resample_ohlcv(daily, "W")
    assert [d.strftime("%Y-%m-%d") for d in weekly["date"]] == ["2026-10-01", "2026-10-05", "2026-10-13"]
    assert weekly.iloc[2].high == 6 and weekly.iloc[2].low == 1 and weekly.iloc[2].volume == 20
    monthly = resample_ohlcv(daily, "M")
    assert len(monthly) == 1 and monthly.iloc[0].open == 1 and monthly.iloc[0].close == 5


@pytest.fixture
def db():
    conn = duckdb.connect()
    conn.execute(SCHEMA)
    return conn


def _insert_intraday(conn, interval, start, n, step_min):
    for i in range(n):
        conn.execute("INSERT INTO stock_intraday_ohlcv VALUES (?, 'TCS', ?, 1, 2, 1, 2, 10)",
                     [start + timedelta(minutes=step_min * i), interval])


def test_no_data_reports_empty_status_and_everything_missing(db):
    res = load_candles(db, "TCS", "15m", date.today() - timedelta(days=7), date.today(), None)
    assert res["bars"] == [] and res["status"]["total_bars"] == 0
    assert res["missing"]["total"] > 0 and res["fetch"]["interval"] == "15m"


def test_intraday_rows_keep_the_time_and_daily_rows_do_not(db):
    start = datetime.combine(date.today(), datetime.min.time()).replace(hour=9, minute=15)
    _insert_intraday(db, "15m", start, 3, 15)
    db.execute("INSERT INTO stock_ohlcv VALUES (?, 'TCS', 1, 2, 1, 2, 10)", [date.today()])
    assert load_candles(db, "TCS", "15m", None, None, None)["bars"][0]["date"].endswith("09:15:00")
    assert len(load_candles(db, "TCS", "1D", None, None, None)["bars"][0]["date"]) == 10


def test_limit_keeps_the_latest_bars(db):
    start = datetime.combine(date.today(), datetime.min.time()).replace(hour=9, minute=15)
    _insert_intraday(db, "5m", start, 10, 5)
    res = load_candles(db, "TCS", "5m", None, None, 4)
    assert len(res["bars"]) == 4 and res["status"]["total_bars"] == 10
    assert res["bars"][-1]["date"].endswith("10:00:00")


def test_range_beyond_lookback_is_clamped(db):
    res = load_candles(db, "TCS", "1m", date.today() - timedelta(days=30), date.today(), None)
    assert res["clamped_from"] == (date.today() - timedelta(days=7)).isoformat()
    assert res["fetch"]["days"] <= 8


def test_stored_history_that_covers_the_range_is_not_missing(db):
    for i in range(30):
        d = date.today() - timedelta(days=i)
        db.execute("INSERT INTO stock_ohlcv VALUES (?, 'TCS', 1, 2, 1, 2, 10)", [d])
    res = load_candles(db, "TCS", "1D", date.today() - timedelta(days=28), date.today(), None)
    assert res["missing"]["total"] == 0
