"""Portfolio maths: value and profit/loss of stock holdings from the latest stored close. Pure where possible."""

from typing import Optional


def holding_metrics(qty: Optional[float], buy_price: Optional[float], last_price: Optional[float]) -> dict:
    """Invested amount, current value and profit/loss of one lot.

    Any figure that cannot be worked out (quantity or buy price not filled in yet, no stored price) is None.
    """
    invested = qty * buy_price if qty and buy_price else None
    value = qty * last_price if qty and last_price else None
    pnl = value - invested if invested is not None and value is not None else None
    pnl_pct = pnl / invested * 100 if pnl is not None and invested else None
    return {"invested": invested, "value": value, "pnl": pnl, "pnl_pct": pnl_pct}


def portfolio_totals(rows: list[dict]) -> dict:
    """Totals over the holdings that are fully filled in; `incomplete` counts the ones that are not."""
    complete = [r for r in rows if r["pnl"] is not None]
    invested = sum(r["invested"] for r in complete)
    value = sum(r["value"] for r in complete)
    pnl = value - invested
    return {
        "invested": invested,
        "value": value,
        "pnl": pnl,
        "pnl_pct": pnl / invested * 100 if invested else None,
        "incomplete": len(rows) - len(complete),
    }


def latest_closes(db, symbols: list[str]) -> dict[str, tuple[float, str]]:
    """Latest stored daily close and its date for each symbol, in one query."""
    if not symbols:
        return {}
    marks = ",".join("?" for _ in symbols)
    rows = db.execute(
        f"SELECT symbol, arg_max(close, date), max(date) FROM stock_ohlcv WHERE symbol IN ({marks}) GROUP BY symbol",
        symbols,
    ).fetchall()
    return {r[0]: (r[1], str(r[2])) for r in rows}
