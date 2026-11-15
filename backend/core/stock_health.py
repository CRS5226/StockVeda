"""Facts about the stocks of a portfolio: how big each position is among the stocks, and where each price stands.

Everything here is arithmetic on the user's own numbers. It makes no forecast and gives no recommendation.
Only stocks are looked at; fixed deposits, mutual funds and the like are managed in a different way.
"""

import math

import pandas as pd

DEFAULT_MAX_POSITION_PCT = 10.0     # largest share of the stock holdings one stock should have
DEEP_DRAWDOWN_PCT = 25.0            # a stock this far below its 52-week high is flagged


def positions(holdings: list[dict]) -> list[dict]:
    """One row per stock (lots added together) with its invested amount, value and average buy price.

    Only lots with a quantity and a stored price have a value; the rest are counted in `unpriced`.
    """
    by_symbol: dict[str, dict] = {}
    for h in holdings:
        row = by_symbol.setdefault(h["symbol"], {"symbol": h["symbol"], "kind": h["kind"], "qty": 0.0, "invested": 0.0, "value": 0.0, "last_price": h["last_price"], "lots": 0, "unpriced": 0})
        row["lots"] += 1
        if h["value"] is None or h["qty"] is None or h["invested"] is None:
            row["unpriced"] += 1
            continue
        row["qty"] += h["qty"]
        row["invested"] += h["invested"]
        row["value"] += h["value"]
    out = [r for r in by_symbol.values() if r["value"] > 0]
    for r in out:
        r["avg_price"] = r["invested"] / r["qty"]
    return out


def concentration(rows: list[dict], total_value: float, max_pct: float) -> dict:
    """Each stock's share of the stock holdings (`total_value` is their combined value), those above the limit, and the
    shares to sell to be back at it."""
    ranked = []
    for r in sorted(rows, key=lambda r: -r["value"]):
        weight = r["value"] / total_value * 100 if total_value else 0.0
        excess_value = max(r["value"] - total_value * max_pct / 100, 0.0)
        over = weight > max_pct
        shares = math.ceil(excess_value / r["last_price"]) if over and r["last_price"] else 0
        ranked.append({
            "symbol": r["symbol"], "kind": r["kind"], "weight_pct": weight, "value": r["value"], "over_limit": over,
            "excess_value": excess_value, "shares_to_trim": min(shares, math.floor(r["qty"])) if over else 0,
        })
    weights = [p["weight_pct"] / 100 for p in ranked]
    return {
        "positions": ranked,
        "top5_pct": sum(p["weight_pct"] for p in ranked[:5]),
        "effective_holdings": 1 / sum(w * w for w in weights) if weights else 0.0,   # 80 equal holdings count as 80; one big one drags it down
        "over_limit": sum(1 for p in ranked if p["over_limit"]),
        "max_pct": max_pct,
    }


def trend_stats(closes: pd.Series) -> dict:
    """Where the latest close stands against its 50 and 200-day averages and its 52-week high. `closes` oldest first."""
    closes = closes.dropna()
    n = len(closes)
    last = float(closes.iloc[-1]) if n else None
    sma50 = float(closes.tail(50).mean()) if n >= 50 else None
    sma200 = float(closes.tail(200).mean()) if n >= 200 else None
    year = closes.tail(252)
    high = float(year.max()) if n else None
    return {
        "bars": n, "last": last, "sma50": sma50, "sma200": sma200,
        "above_sma50": None if sma50 is None else last > sma50,
        "above_sma200": None if sma200 is None else last > sma200,
        "from_high_pct": (last / high - 1) * 100 if high else None,                  # 0 or negative
        "return_1y_pct": (last / float(closes.iloc[-253]) - 1) * 100 if n >= 253 else None,
        "deep_drawdown": bool(high and (last / high - 1) * 100 <= -DEEP_DRAWDOWN_PCT),
    }
