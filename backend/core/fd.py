"""Fixed deposit maths: what an FD is worth on a given day, from the terms the user typed in. Pure, so it is easy to test.

How the interest is worked out (the way Indian banks do it):
- Cumulative FD: interest is added to the deposit every compounding period (monthly, quarterly, half-yearly, yearly)
  and earns interest itself. The part of a period that has run since the last one earns simple interest, pro rata by days.
- Payout FD: interest is paid out to the user's account every month, quarter, half-year or year, as simple interest on
  the principal. The deposit itself stays the same; interest paid so far counts as money received.
- Nothing grows after the maturity date, and an FD that has not started yet is worth its principal.
"""

import calendar
from dataclasses import dataclass
from datetime import date
from typing import Optional

# months in one compounding / payout period
PERIOD_MONTHS = {"monthly": 1, "quarterly": 3, "half_yearly": 6, "yearly": 12}
COMPOUNDING = tuple(PERIOD_MONTHS)
PAYOUTS = ("cumulative", *PERIOD_MONTHS)


@dataclass(frozen=True)
class FdTerms:
    principal: float
    annual_rate: float          # percent, e.g. 7.25
    start: date
    maturity: date
    compounding: str = "quarterly"   # used by cumulative FDs
    payout: str = "cumulative"       # "cumulative" or how often interest is paid out


def validate_terms(t: FdTerms) -> Optional[str]:
    """Why these terms cannot be an FD, or None."""
    if t.principal <= 0:
        return "Principal must be above 0."
    if t.annual_rate < 0 or t.annual_rate > 100:
        return "Interest rate must be between 0 and 100 percent."
    if t.maturity <= t.start:
        return "Maturity date must be after the start date."
    if t.compounding not in COMPOUNDING:
        return "Compounding must be monthly, quarterly, half_yearly or yearly."
    if t.payout not in PAYOUTS:
        return "Payout must be cumulative, monthly, quarterly, half_yearly or yearly."
    return None


def add_months(d: date, months: int) -> date:
    """`d` moved by whole months, keeping the day where the month is long enough (31 Jan + 1 month = 28/29 Feb)."""
    index = d.year * 12 + d.month - 1 + months
    year, month = divmod(index, 12)
    month += 1
    return date(year, month, min(d.day, calendar.monthrange(year, month)[1]))


def _periods(start: date, on: date, months: int) -> tuple[int, date, date]:
    """Whole periods completed by `on`, the date the last one ended, and the date the running one ends."""
    k = 0
    while add_months(start, (k + 1) * months) <= on:
        k += 1
    return k, add_months(start, k * months), add_months(start, (k + 1) * months)


def _fraction(last: date, nxt: date, on: date) -> float:
    """How far through the running period `on` is, by days."""
    return (on - last).days / (nxt - last).days


def _cumulative_value(t: FdTerms, on: date) -> float:
    months = PERIOD_MONTHS[t.compounding]
    k, last, nxt = _periods(t.start, on, months)
    per_period = t.annual_rate / 100 * months / 12
    balance = t.principal * (1 + per_period) ** k
    return balance * (1 + per_period * _fraction(last, nxt, on))


def _payout_interest(t: FdTerms, on: date) -> tuple[float, float]:
    """(interest already paid out, interest earned but not yet paid) at `on`."""
    months = PERIOD_MONTHS[t.payout]
    k, last, nxt = _periods(t.start, on, months)
    per_period = t.principal * t.annual_rate / 100 * months / 12
    return k * per_period, per_period * _fraction(last, nxt, on)


def fd_status(t: FdTerms, as_of: date) -> dict:
    """Value of the FD on `as_of`, and what it will be worth at maturity."""
    on = min(max(as_of, t.start), t.maturity)
    if t.payout == "cumulative":
        value = _cumulative_value(t, on)
        received, accrued = 0.0, value - t.principal
        at_maturity = _cumulative_value(t, t.maturity)
    else:
        received, accrued = _payout_interest(t, on)
        value = t.principal + received + accrued
        paid_total, accrued_total = _payout_interest(t, t.maturity)
        at_maturity = t.principal + paid_total + accrued_total
    return {
        "status": "not_started" if as_of < t.start else "matured" if as_of >= t.maturity else "active",
        "days_left": max((t.maturity - as_of).days, 0),
        "interest_earned": value - t.principal,          # everything earned so far, paid out or not
        "interest_received": received,                   # paid into the account so far (payout FDs)
        "current_value": value,                          # principal + interest earned
        "maturity_value": at_maturity,
        "maturity_interest": at_maturity - t.principal,
    }
