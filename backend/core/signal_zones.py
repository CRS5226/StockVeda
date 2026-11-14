"""Zones and share arithmetic for the Signals tab: the user's own thresholds, applied to the user's own numbers.

A zone says that the conditions the user wrote down are met today. It is not a recommendation to buy or sell.
"""

import math
from typing import Optional

DEFAULT_SETTINGS = {
    "profit_gain_pct": 40.0,    # profit-booking zone needs a gain of at least this much on the position ...
    "profit_rsi": 70.0,         # ... and the daily RSI at or above this (or the close above the upper Bollinger band)
    "loss_pct": 25.0,           # recovery zone needs a loss of at least this much ...
    "trim_pct": 25.0,           # share of the position used in the "if you trimmed" arithmetic
    "add_budget": 5000.0,       # rupees used in the "if you added" arithmetic
}


def clean_settings(raw: Optional[dict]) -> dict:
    """The thresholds with defaults filled in; a value that is not a positive number falls back to its default."""
    out = dict(DEFAULT_SETTINGS)
    for key in out:
        v = (raw or {}).get(key)
        if isinstance(v, (int, float)) and v > 0:
            out[key] = float(v)
    out["trim_pct"] = min(out["trim_pct"], 100.0)
    return out


def classify_zone(pnl_pct: Optional[float], daily: Optional[dict], settings: dict) -> tuple[str, list[dict]]:
    """The zone of a position and the conditions behind it, each marked met or not.

    `daily` is the daily result of `evaluate_rules`. Without it, or without a profit figure, the position stays in the hold zone.
    """
    if pnl_pct is None or daily is None:
        return "hold", []
    m = daily["metrics"]
    profit = [
        {"text": f"Gain {pnl_pct:.0f}% is at least {settings['profit_gain_pct']:.0f}%", "met": pnl_pct >= settings["profit_gain_pct"]},
        {"text": f"Daily RSI {m['rsi']:.0f} is at least {settings['profit_rsi']:.0f}, or the close is above the upper Bollinger band",
         "met": m["rsi"] >= settings["profit_rsi"] or m["pct_b"] > 1},
    ]
    recovery = [
        {"text": f"Loss {abs(pnl_pct):.0f}% is at least {settings['loss_pct']:.0f}%", "met": pnl_pct <= -settings["loss_pct"]},
        {"text": "Daily MACD is above its signal line", "met": m["macd_bullish"]},
        {"text": "Close is above the 20-day EMA", "met": m["close"] > m["ema20"]},
    ]
    if all(c["met"] for c in profit):
        return "profit", profit
    if all(c["met"] for c in recovery):
        return "recovery", recovery
    # not in a zone: show the conditions of whichever zone the position is nearer to
    return "hold", profit if pnl_pct >= 0 else recovery


def sizing(qty: float, avg_price: float, last: float, value: float, total_value: float, max_pct: float, settings: dict) -> dict:
    """Share arithmetic for the two zones, always worked out so the user can see the numbers before a zone is reached."""
    invested = qty * avg_price
    cost_out = min(math.ceil(invested / last), math.floor(qty)) if last else 0          # shares whose sale returns the money put in
    trim = math.floor(qty * settings["trim_pct"] / 100)
    headroom = max(total_value * max_pct / 100 - value, 0.0)                             # room before the position passes the size limit
    budget = min(settings["add_budget"], headroom)
    add = math.floor(budget / last) if last else 0
    new_avg = (invested + add * last) / (qty + add) if qty + add else avg_price
    return {
        "trim": {"shares": trim, "value": trim * last, "pct": settings["trim_pct"]},
        "cost_out": {"shares": cost_out, "value": cost_out * last, "possible": cost_out < qty or invested <= value},
        "add": {
            "shares": add, "value": add * last, "budget": settings["add_budget"], "headroom": headroom,
            "limited_by_size": settings["add_budget"] > headroom,
            "avg_before": avg_price, "avg_after": new_avg,
            "breakeven_before_pct": (avg_price / last - 1) * 100 if last else None,      # how far the price must rise to reach the average
            "breakeven_after_pct": (new_avg / last - 1) * 100 if last else None,
        },
    }
