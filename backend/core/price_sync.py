"""Deciding which prices are out of date. Pure, so it is easy to test."""

from datetime import date, datetime, timedelta, timezone
from typing import Optional

IST = timezone(timedelta(hours=5, minutes=30))
# The exchange's close is final a little after 15:30 IST; before 16:00 the latest settled day is the one before.
CLOSE_HOUR_IST = 16


def expected_close_date(now: datetime) -> date:
    """The latest trading day whose close should be stored by `now` (weekends skipped; holidays are not known here)."""
    ist = now.astimezone(IST)
    day = ist.date()
    if ist.hour < CLOSE_HOUR_IST:
        day -= timedelta(days=1)
    while day.weekday() >= 5:
        day -= timedelta(days=1)
    return day


def stale_keys(latest: dict[str, Optional[date]], expected: date) -> list[str]:
    """Symbols (or scheme codes) whose newest stored price is older than `expected`, or that have none."""
    return sorted(k for k, d in latest.items() if d is None or d < expected)


def fetch_start(latest: list[Optional[date]], today: date, first_load_days: int = 30) -> date:
    """Where to start downloading for a group: the day after the oldest newest-price, or a month back when any has none."""
    known = [d for d in latest if d is not None]
    start = min(known) + timedelta(days=1) if known else today - timedelta(days=first_load_days)
    if len(known) < len(latest):
        start = min(start, today - timedelta(days=first_load_days))
    return start
