"""Mutual fund holdings in a portfolio: what a SIP or a lump sum bought, and what it is worth now, from stored NAV history.

A SIP buys once a month on the start date's day (clamped to short months) at the first NAV on or after that date,
the same rule the Mutual Funds page uses for its SIP calculator. A lump sum is one purchase. Pure, so it is easy to test.
"""

from bisect import bisect_left
from dataclasses import dataclass
from datetime import date
from typing import Optional

from backend.core.fd import add_months
from backend.core.mf_analytics import xirr

KINDS = ("sip", "lumpsum")


@dataclass(frozen=True)
class MfTerms:
    kind: str                       # "sip" or "lumpsum"
    amount: float                   # per instalment for a SIP, the whole amount for a lump sum
    start: date
    end: Optional[date] = None      # a SIP stopped on this date; None while it is still running


def purchase_dates(t: MfTerms, last_nav_date: date) -> list[date]:
    """Dates money went in, up to the latest NAV we have."""
    if t.kind == "lumpsum":
        return [t.start] if t.start <= last_nav_date else []
    stop = min(t.end, last_nav_date) if t.end else last_nav_date
    dates, k = [], 0
    while (d := add_months(t.start, k)) <= stop:
        dates.append(d)
        k += 1
    return dates


def evaluate(t: MfTerms, nav_dates: list[date], navs: list[float], today: date) -> dict:
    """Invested, units, current value and returns of one holding. `nav_dates` ascending, `navs` the same length.

    `flows` are the dated cash flows (purchases negative, today's value positive) for XIRR; they are not shown to the user.
    Figures are None when there is no NAV history or nothing was bought yet.
    """
    empty = {"invested": None, "units": None, "current_value": None, "returns": None, "returns_pct": None, "xirr_pct": None,
             "installments": 0, "last_nav": None, "last_nav_date": None, "active_sip": False, "flows": []}
    active = t.kind == "sip" and (t.end is None or t.end >= today)
    if not navs:
        return {**empty, "active_sip": active}

    invested = units = 0.0
    flows: list[tuple[date, float]] = []
    for d in purchase_dates(t, nav_dates[-1]):
        i = bisect_left(nav_dates, d)         # first NAV on or after the date
        if i >= len(navs):
            continue
        invested += t.amount
        units += t.amount / navs[i]
        flows.append((d, -t.amount))
    last_nav, last_date = navs[-1], nav_dates[-1]
    if not flows:
        return {**empty, "last_nav": last_nav, "last_nav_date": str(last_date), "active_sip": active}

    value = units * last_nav
    flows.append((last_date, value))
    rate = xirr(flows)
    return {
        "invested": invested, "units": units, "current_value": value, "returns": value - invested,
        "returns_pct": (value - invested) / invested * 100,
        "xirr_pct": rate * 100 if rate is not None else None,
        "installments": len(flows) - 1, "last_nav": last_nav, "last_nav_date": str(last_date), "active_sip": active, "flows": flows,
    }
