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
