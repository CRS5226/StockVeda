"""One total across everything in a portfolio: stocks, fixed deposits and the other investments, split by type."""

from datetime import date

from backend.core.mf_analytics import xirr

ASSET_LABELS = {
    "crypto": "Crypto", "us_stock": "US stocks", "mutual_fund": "Other funds", "bond": "Bonds", "gold": "Gold", "other": "Other",
}


def _part(key: str, label: str, invested: float, value: float) -> dict:
    pnl = value - invested
    return {"key": key, "label": label, "invested": invested, "value": value, "pnl": pnl, "pnl_pct": pnl / invested * 100 if invested else None}


def combine(stock_totals: dict, fd_totals: dict, assets: list[dict], mf_totals: dict | None = None) -> dict:
    """Total invested, current value and profit/loss in rupees, and each type's share of the current value.

    Stocks count only when quantity and buy price are filled in, and dollar assets only once a USD to INR rate is
    entered; `left_out` says how many of each are missing from the total.
    """
    parts = [
        _part("stocks", "Stocks", stock_totals["invested"], stock_totals["value"]),
        _part("fixed_deposits", "Fixed deposits", fd_totals["principal"], fd_totals["current_value"]),
        _part("mutual_funds", "Mutual funds", (mf_totals or {}).get("invested", 0.0), (mf_totals or {}).get("current_value", 0.0)),
    ]
    for key, label in ASSET_LABELS.items():
        rows = [a for a in assets if a["asset_type"] == key and a["value_inr"] is not None]
        parts.append(_part(key, label, sum(a["invested_inr"] for a in rows), sum(a["value_inr"] for a in rows)))
    parts = [p for p in parts if p["invested"] or p["value"]]

    invested = sum(p["invested"] for p in parts)
    value = sum(p["value"] for p in parts)
    for p in parts:
        p["share_pct"] = p["value"] / value * 100 if value else 0.0
    pnl = value - invested
    return {
        "invested": invested, "value": value, "pnl": pnl, "pnl_pct": pnl / invested * 100 if invested else None,
        "parts": parts,
        "left_out": {
            "stocks": stock_totals["incomplete"],
            "assets": sum(1 for a in assets if a["value_inr"] is None),
        },
    }


def build_flows(stocks: list[dict], fds: list[dict], assets: list[dict], mf_flows: list, today: date) -> tuple[list, int, int]:
    """Dated cash flows of everything that has a buy date, for the portfolio XIRR.

    Returns (flows, items with a date, items counted). Each dated item pays its cost on its start date and "receives"
    its current value today; stocks and assets without a buy date cannot be placed in time and are left out of the XIRR.
    """
    flows = list(mf_flows)
    dated = counted = 0
    for s in stocks:
        if s["invested"] is None or s["value"] is None:
            continue
        counted += 1
        if s["buy_date"]:
            dated += 1
            flows += [(date.fromisoformat(s["buy_date"]), -s["invested"]), (today, s["value"])]
    for a in assets:
        if a["value_inr"] is None:
            continue
        counted += 1
        if a["buy_date"]:
            dated += 1
            flows += [(date.fromisoformat(a["buy_date"]), -a["invested_inr"]), (today, a["value_inr"])]
    for f in fds:
        counted += 1
        start = date.fromisoformat(f["start_date"])
        if start <= today:
            dated += 1
            flows += [(start, -f["principal"]), (today, f["current_value"])]
    return flows, dated, counted


def portfolio_xirr(flows: list) -> float | None:
    """Annualised return in percent over the flows, or None when there is not enough to work it out."""
    rate = xirr(flows) if flows else None
    return rate * 100 if rate is not None else None
