"""Tests for the price sync rules."""

from datetime import date, datetime, timezone, timedelta

from backend.core.price_sync import IST, expected_close_date, fetch_start, stale_keys

D = date


def at(y, m, d, hh, mm=0):
    return datetime(y, m, d, hh, mm, tzinfo=IST)


def test_expected_close_date_waits_for_the_close_and_skips_weekends():
    assert expected_close_date(at(2026, 11, 13, 17)) == D(2026, 11, 13)       # Friday evening: today
    assert expected_close_date(at(2026, 11, 13, 11)) == D(2026, 11, 12)       # Friday morning: Thursday
    assert expected_close_date(at(2026, 11, 14, 12)) == D(2026, 11, 13)       # Saturday: Friday
    assert expected_close_date(at(2026, 11, 16, 9)) == D(2026, 11, 13)        # Monday morning: Friday
    assert expected_close_date(datetime(2026, 11, 13, 11, 0, tzinfo=timezone.utc)) == D(2026, 11, 13)   # 16:30 IST


def test_stale_keys():
    latest = {"A": D(2026, 11, 13), "B": D(2026, 11, 12), "C": None}
    assert stale_keys(latest, D(2026, 11, 13)) == ["B", "C"]
    assert stale_keys({"A": D(2026, 11, 13)}, D(2026, 11, 13)) == []


def test_fetch_start():
    today = D(2026, 11, 14)
    assert fetch_start([D(2026, 11, 10), D(2026, 11, 12)], today) == D(2026, 11, 11)
    assert fetch_start([None], today) == today - timedelta(days=30)
    assert fetch_start([D(2026, 11, 12), None], today) == today - timedelta(days=30)      # a new symbol pulls the start back
