"""Value and profit/loss of the other investments in a portfolio (crypto, US stocks, gold ...), from prices the user typed in."""

from typing import Optional

ASSET_TYPES = ("crypto", "us_stock", "mutual_fund", "bond", "gold", "other")
CURRENCIES = ("INR", "USD")


def asset_metrics(qty: float, buy_price: float, current_price: float, currency: str, usd_inr: Optional[float]) -> dict:
    """Invested, value and profit/loss in the asset's own currency, and the same in rupees.

    The rupee figures are None for a USD asset until a USD to INR rate is entered.
    """
    invested, value = qty * buy_price, qty * current_price
    pnl = value - invested
    rate = 1.0 if currency == "INR" else usd_inr
    inr = (lambda x: x * rate) if rate else (lambda x: None)
    return {
        "invested": invested, "value": value, "pnl": pnl, "pnl_pct": pnl / invested * 100 if invested else None,
        "invested_inr": inr(invested), "value_inr": inr(value), "pnl_inr": inr(pnl),
    }


def asset_totals(rows: list[dict]) -> dict:
    """Totals in rupees over the assets that could be converted; `unconverted` counts the USD assets still waiting for a rate."""
    ok = [r for r in rows if r["value_inr"] is not None]
    invested = sum(r["invested_inr"] for r in ok)
    value = sum(r["value_inr"] for r in ok)
    pnl = value - invested
    return {
        "invested": invested, "value": value, "pnl": pnl,
        "pnl_pct": pnl / invested * 100 if invested else None,
        "unconverted": len(rows) - len(ok),
    }
