"""One total across everything in a portfolio: stocks, fixed deposits and the other investments, split by type."""

ASSET_LABELS = {
    "crypto": "Crypto", "us_stock": "US stocks", "mutual_fund": "Mutual funds", "bond": "Bonds", "gold": "Gold", "other": "Other",
}


def _part(key: str, label: str, invested: float, value: float) -> dict:
    pnl = value - invested
    return {"key": key, "label": label, "invested": invested, "value": value, "pnl": pnl, "pnl_pct": pnl / invested * 100 if invested else None}


def combine(stock_totals: dict, fd_totals: dict, assets: list[dict]) -> dict:
    """Total invested, current value and profit/loss in rupees, and each type's share of the current value.

    Stocks count only when quantity and buy price are filled in, and dollar assets only once a USD to INR rate is
    entered; `left_out` says how many of each are missing from the total.
    """
    parts = [
        _part("stocks", "Stocks", stock_totals["invested"], stock_totals["value"]),
        _part("fixed_deposits", "Fixed deposits", fd_totals["principal"], fd_totals["current_value"]),
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
