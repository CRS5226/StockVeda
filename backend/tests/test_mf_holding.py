"""Hand-checked cases for mutual fund holdings."""

from datetime import date, timedelta

import pytest

from backend.core.mf_holding import MfTerms, evaluate, purchase_dates

D = date


def series(start: date, days: int, nav_at):
    dates = [start + timedelta(days=i) for i in range(days)]
    return dates, [nav_at(i) for i in range(days)]


def test_lump_sum_after_a_year_at_a_20_percent_rise():
    dates, navs = series(D(2025, 1, 1), 366, lambda i: 10 + 2 * i / 365)       # NAV 10 -> 12
    r = evaluate(MfTerms("lumpsum", 10_000, D(2025, 1, 1)), dates, navs, D(2026, 1, 2))
    assert r["units"] == pytest.approx(1_000)
    assert r["invested"] == 10_000 and r["current_value"] == pytest.approx(12_000)
    assert r["returns_pct"] == pytest.approx(20) and r["xirr_pct"] == pytest.approx(20, abs=0.01)
    assert r["active_sip"] is False and r["installments"] == 1


def test_sip_buys_each_month_at_that_days_nav():
    # NAV is 10 in January, 11 in February, 12 in March
    nav_of = lambda d: {1: 10, 2: 11, 3: 12}[d.month]
    dates = [D(2026, 1, 1) + timedelta(days=i) for i in range(90)]
    navs = [nav_of(d) for d in dates]
    r = evaluate(MfTerms("sip", 1_000, D(2026, 1, 1)), dates, navs, D(2026, 3, 31))
    assert r["installments"] == 3 and r["invested"] == 3_000
    assert r["units"] == pytest.approx(1000 / 10 + 1000 / 11 + 1000 / 12)
    assert r["current_value"] == pytest.approx(r["units"] * 12)
    assert r["active_sip"] is True


def test_a_stopped_sip_buys_nothing_after_its_end_date():
    dates, navs = series(D(2026, 1, 1), 120, lambda i: 10)
    t = MfTerms("sip", 500, D(2026, 1, 1), end=D(2026, 2, 15))
    assert purchase_dates(t, dates[-1]) == [D(2026, 1, 1), D(2026, 2, 1)]
    assert evaluate(t, dates, navs, D(2026, 4, 1))["active_sip"] is False


def test_sip_day_is_kept_where_the_month_is_long_enough():
    t = MfTerms("sip", 500, D(2026, 1, 31))
    assert purchase_dates(t, D(2026, 4, 30)) == [D(2026, 1, 31), D(2026, 2, 28), D(2026, 3, 31), D(2026, 4, 30)]


def test_a_date_with_no_nav_uses_the_next_one_and_a_future_start_buys_nothing():
    dates = [D(2026, 1, 5), D(2026, 1, 6)]                  # the 1st is a holiday: first NAV is the 5th
    r = evaluate(MfTerms("lumpsum", 1_000, D(2026, 1, 1)), dates, [10, 20], D(2026, 1, 6))
    assert r["units"] == pytest.approx(100)
    future = evaluate(MfTerms("lumpsum", 1_000, D(2026, 6, 1)), dates, [10, 20], D(2026, 1, 6))
    assert future["invested"] is None and future["last_nav"] == 20


def test_no_nav_history_gives_no_figures():
    r = evaluate(MfTerms("sip", 1_000, D(2026, 1, 1)), [], [], D(2026, 3, 1))
    assert r["current_value"] is None and r["active_sip"] is True
