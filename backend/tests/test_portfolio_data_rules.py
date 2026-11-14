"""Tests for the portfolio data rules."""

from datetime import date, datetime, timedelta

import pytest

from backend.core.portfolio_data import (
    HOURLY_FIRST_LOAD_DAYS, hourly_days_needed, snapshot_row, stale_fundamentals, stale_hourly, stale_ratios,
)

D = date
NOW = datetime(2026, 11, 14, 12, 0)


def test_stale_hourly_and_days_needed():
    newest = {"A": datetime(2026, 11, 13, 15, 0), "B": datetime(2026, 11, 10, 15, 0), "C": None}
    assert stale_hourly(newest, D(2026, 11, 13)) == ["B", "C"]
    assert hourly_days_needed(None, D(2026, 11, 14)) == HOURLY_FIRST_LOAD_DAYS
    assert hourly_days_needed(datetime(2026, 11, 10, 15, 0), D(2026, 11, 14)) == 6
    assert hourly_days_needed(datetime(2026, 11, 14, 9, 0), D(2026, 11, 14)) == 5                    # never fewer than five days
    assert hourly_days_needed(datetime(2020, 1, 1), D(2026, 11, 14)) == HOURLY_FIRST_LOAD_DAYS      # nor more than Yahoo serves


def test_stale_fundamentals_skips_recent_tries():
    newest = {"NEW": D(2026, 9, 30), "OLD": D(2026, 3, 31), "NONE": None, "TRIED": D(2026, 3, 31)}
    attempted = {"TRIED": NOW - timedelta(days=1), "OLD": NOW - timedelta(days=10)}
    assert stale_fundamentals(newest, attempted, NOW) == ["NONE", "OLD"]


def test_stale_ratios():
    assert stale_ratios({"A": D(2026, 11, 14), "B": D(2026, 11, 13), "C": None}, D(2026, 11, 14)) == ["B", "C"]


def test_snapshot_row_scales_fractions_to_percent():
    info = {"trailingPE": 17.57, "priceToBook": 2.04, "returnOnEquity": 0.11005, "profitMargins": 0.26532, "revenueGrowth": 0.808,
            "dividendYield": 1.62, "marketCap": 1.24e13, "debtToEquity": None, "sector": "Financial Services", "beta": float("nan")}
    r = snapshot_row("HDFCBANK", info, D(2026, 11, 14))
    assert (r["pe"], r["pb"], r["roe_pct"], r["profit_margin_pct"], r["revenue_growth_pct"], r["dividend_yield_pct"]) == (17.57, 2.04, 11.005, 26.532, 80.8, 1.62)
    assert r["debt_to_equity"] is None and r["beta"] is None and r["sector"] == "Financial Services" and r["industry"] is None
    assert list(r)[:2] == ["symbol", "as_of"]


def test_latest_quarter_and_year_on_year_growth():
    from backend.core.portfolio_data import latest_quarter
    rows = [
        {"period": D(2025, 9, 30), "revenue": 100.0, "ebitda": 20.0, "pat": 10.0},
        {"period": D(2026, 9, 30), "revenue": 130.0, "ebitda": 30.0, "pat": 15.0},
        {"period": D(2026, 6, 30), "revenue": 120.0, "ebitda": 25.0, "pat": 12.0},
    ]
    q = latest_quarter(rows)
    assert q["period"] == D(2026, 9, 30) and q["revenue"] == 130.0
    assert q["revenue_yoy_pct"] == pytest.approx(30.0) and q["pat_yoy_pct"] == pytest.approx(50.0)
    assert latest_quarter([]) is None
    only = latest_quarter([{"period": D(2026, 9, 30), "revenue": 130.0, "ebitda": None, "pat": -5.0}])
    assert only["revenue_yoy_pct"] is None and only["pat_yoy_pct"] is None              # no year-ago quarter stored
    loss = latest_quarter([{"period": D(2025, 9, 30), "revenue": 100.0, "pat": -4.0}, {"period": D(2026, 9, 30), "revenue": 90.0, "pat": 3.0}])
    assert loss["revenue_yoy_pct"] == pytest.approx(-10.0) and loss["pat_yoy_pct"] is None            # a loss a year ago has no meaningful percent
