"""Dividends received on a portfolio's stocks: totals by financial year and by stock. Pure, so it is easy to test."""

from datetime import date


def financial_year(d: date) -> str:
    """Indian financial year (April to March) of a date, as "2025-26"."""
    start = d.year if d.month >= 4 else d.year - 1
    return f"{start}-{(start + 1) % 100:02d}"


def summarize(rows: list[dict], today: date) -> dict:
    """Totals of dividends received: all time, this financial year, and split by financial year and by stock.

    Each row needs `symbol`, `pay_date` (a date), `amount` and `tds`. `gross` is what the company paid out before TDS.
    """
    this_fy = financial_year(today)
    by_fy: dict[str, dict] = {}
    by_symbol: dict[str, float] = {}
    total = tds = this_year = 0.0
    for r in rows:
        total += r["amount"]
        tds += r["tds"]
        fy = financial_year(r["pay_date"])
        bucket = by_fy.setdefault(fy, {"fy": fy, "received": 0.0, "tds": 0.0})
        bucket["received"] += r["amount"]
        bucket["tds"] += r["tds"]
        by_symbol[r["symbol"]] = by_symbol.get(r["symbol"], 0.0) + r["amount"]
        if fy == this_fy:
            this_year += r["amount"]
    return {
        "received": total, "tds": tds, "gross": total + tds, "this_fy": this_year, "this_fy_label": this_fy,
        "by_fy": sorted(by_fy.values(), key=lambda b: b["fy"], reverse=True),
        "by_symbol": [{"symbol": s, "received": v} for s, v in sorted(by_symbol.items(), key=lambda kv: -kv[1])],
    }


def earliest_buy(lot_dates: list) -> date | None:
    """The date the stock was first bought, from the buy dates of its lots. None when any lot has no date, as then it cannot be known."""
    if not lot_dates or any(d is None for d in lot_dates):
        return None
    return min(lot_dates)


def dividend_date_problem(symbol: str, pay_date: date, lot_dates: list) -> str | None:
    """Why a dividend cannot be recorded on `pay_date`, or None. A stock pays dividends only after it was bought.

    `lot_dates` are the buy dates of the stock's lots in the portfolio (None for a lot without a date); an empty list
    means the portfolio does not hold the stock at all.
    """
    if not lot_dates:
        return f"{symbol} is not in this portfolio. Add the stock before recording its dividends."
    first = earliest_buy(lot_dates)
    if first is not None and pay_date < first:
        return f"{symbol} was bought on {first}, so it cannot have paid a dividend on {pay_date}."
    return None


def buy_date_problem(symbol: str, lot_dates_after: list, first_dividend: date | None) -> str | None:
    """Why the lots of a stock cannot have these buy dates, or None: it would put an existing dividend before the purchase."""
    first = earliest_buy(lot_dates_after)
    if first is not None and first_dividend is not None and first_dividend < first:
        return f"{symbol} has a dividend on {first_dividend}, before the buy date {first}. Delete or move that dividend first."
    return None
