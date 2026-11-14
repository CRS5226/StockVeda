"""Which of a portfolio's data is missing or out of date, and how Yahoo's ratios become a stored row. Pure, so it is easy to test."""

from datetime import date, datetime, timedelta
from typing import Optional

HOURLY_FIRST_LOAD_DAYS = 725      # Yahoo serves 60-minute bars for about the last two years
FUNDAMENTALS_STALE_DAYS = 120     # a company reports each quarter; a newest period older than this is probably missing results
EMPTY_RETRY_DAYS = 3              # do not ask again within this many days when Yahoo had nothing for a symbol


# (status, when) of the last try for one symbol in one dataset; the status is "success" or "empty" (Yahoo had nothing)
Attempt = tuple[str, datetime]


def recently_empty(attempt: Optional[Attempt], now: datetime) -> bool:
    """True when Yahoo had nothing for this symbol a moment ago, so asking again right away would only repeat the answer."""
    return attempt is not None and attempt[0] == "empty" and now - attempt[1] < timedelta(days=EMPTY_RETRY_DAYS)


def recently_tried(attempt: Optional[Attempt], now: datetime) -> bool:
    """True when this symbol was tried within the last few days, whatever the answer. For data that changes rarely."""
    return attempt is not None and now - attempt[1] < timedelta(days=EMPTY_RETRY_DAYS)


def stale_hourly(newest: dict[str, Optional[datetime]], expected: date, attempts: dict[str, Attempt], now: datetime) -> list[str]:
    """Symbols whose newest 60-minute bar is from before the latest finished trading day, or that have none."""
    return sorted(s for s, t in newest.items() if (t is None or t.date() < expected) and not recently_empty(attempts.get(s), now))


def hourly_days_needed(newest: Optional[datetime], today: date) -> int:
    """How many days back to ask Yahoo for: everything when nothing is stored, otherwise from the newest bar with a small margin."""
    if newest is None:
        return HOURLY_FIRST_LOAD_DAYS
    return min(max((today - newest.date()).days + 2, 5), HOURLY_FIRST_LOAD_DAYS)


def stale_fundamentals(newest_period: dict[str, Optional[date]], attempts: dict[str, Attempt], now: datetime) -> list[str]:
    """Symbols with no results stored or an old newest period, unless they were tried in the last few days.

    A company that has not reported lately keeps looking old however often Yahoo is asked, and results change only four
    times a year, so any recent try holds a symbol back, not only an empty one.
    """
    return sorted(s for s, period in newest_period.items()
                  if (period is None or (now.date() - period).days > FUNDAMENTALS_STALE_DAYS) and not recently_tried(attempts.get(s), now))


def stale_ratios(newest: dict[str, Optional[date]], today: date, attempts: dict[str, Attempt], now: datetime) -> list[str]:
    """Symbols with no ratio snapshot from today, unless Yahoo had nothing for them very recently."""
    return sorted(s for s, d in newest.items() if (d is None or d < today) and not recently_empty(attempts.get(s), now))


def _num(info: dict, key: str, scale: float = 1.0) -> Optional[float]:
    v = info.get(key)
    return round(float(v) * scale, 4) if isinstance(v, (int, float)) and v == v else None


def snapshot_row(symbol: str, info: dict, today: date) -> dict:
    """A `stock_ratios_snapshot` row from Yahoo's info. Yahoo gives return, margins and growth as fractions and the yield as a percent."""
    return {
        "symbol": symbol, "as_of": today,
        "pe": _num(info, "trailingPE"), "forward_pe": _num(info, "forwardPE"), "pb": _num(info, "priceToBook"),
        "roe_pct": _num(info, "returnOnEquity", 100), "debt_to_equity": _num(info, "debtToEquity"),
        "profit_margin_pct": _num(info, "profitMargins", 100), "revenue_growth_pct": _num(info, "revenueGrowth", 100),
        "earnings_growth_pct": _num(info, "earningsGrowth", 100), "dividend_yield_pct": _num(info, "dividendYield"),
        "market_cap": _num(info, "marketCap"), "ev_to_ebitda": _num(info, "enterpriseToEbitda"), "beta": _num(info, "beta"),
        "sector": info.get("sector") or None, "industry": info.get("industry") or None,
    }


def latest_quarter(rows: list[dict]) -> Optional[dict]:
    """The newest reported quarter of a stock and how revenue and profit changed from the same quarter a year before.

    `rows` are quarterly results (period as a date, revenue, ebitda, pat), any order. Growth is None when the same
    quarter a year earlier is not stored, or when it was zero or negative (a percent change would mean nothing).
    """
    if not rows:
        return None
    ordered = sorted(rows, key=lambda r: r["period"], reverse=True)
    newest = ordered[0]
    year_ago = next((r for r in ordered[1:] if 350 <= (newest["period"] - r["period"]).days <= 380), None)

    def growth(key: str) -> Optional[float]:
        a, b = newest.get(key), (year_ago or {}).get(key)
        return (a / b - 1) * 100 if a is not None and b is not None and b > 0 else None

    return {"period": newest["period"], "revenue": newest.get("revenue"), "ebitda": newest.get("ebitda"), "pat": newest.get("pat"),
            "revenue_yoy_pct": growth("revenue"), "pat_yoy_pct": growth("pat")}
