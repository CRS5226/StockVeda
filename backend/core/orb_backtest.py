"""
Opening Range Breakout (ORB) backtester — standalone module, deliberately NOT
wired into backend/core/backtest_engine.py (which assumes one row per calendar
day; ORB needs intraday bars and produces at most one trade per trading day,
which is a different shape from the condition engine's bar-by-bar crossover
signals). Mirrors options_backtest.py's standalone, one-trade-per-period style.

Strategy: define the "opening range" as the high/low of the first
`or_minutes` minutes of each trading day (from the day's first available bar).
A breakout trade triggers when a later bar's close crosses above the opening-
range high (long) or below the opening-range low (short, if enabled). Exit on
target_pct / sl_pct (measured off entry price) or a forced end-of-day exit —
intraday positions are not held overnight by design (that's the whole point of
an ORB day-trading strategy).
"""

from dataclasses import dataclass
from typing import Literal

import pandas as pd

from backend.db.connection import get_db

DIRECTIONS = ("long_only", "short_only", "both")


@dataclass
class ORBParams:
    or_minutes: int = 15                 # opening-range window length in minutes
    direction: Literal["long_only", "short_only", "both"] = "long_only"
    target_pct: float = 1.0              # % move from entry that closes the trade in profit
    sl_pct: float = 0.5                  # % adverse move from entry that stops the trade out
    force_exit_time: str = "15:20"       # HH:MM, force-flatten before market close (15:30 NSE)
    capital_per_trade: float = 50_000.0
    interval: str = "5m"                 # must match a previously-fetched stock_intraday_ohlcv interval


def _load_intraday(sym: str, from_date: str, to_date: str, interval: str) -> pd.DataFrame:
    db = get_db()
    df = db.execute("""
        SELECT datetime, open, high, low, close, volume
        FROM stock_intraday_ohlcv
        WHERE symbol = ? AND interval = ? AND datetime BETWEEN ? AND ?
        ORDER BY datetime
    """, [sym.strip().upper(), interval, from_date, to_date]).df()
    if df.empty:
        return df
    df["datetime"] = pd.to_datetime(df["datetime"])
    df["trade_date"] = df["datetime"].dt.date.astype(str)
    return df


def _opening_range(day_df: pd.DataFrame, or_minutes: int) -> tuple[float, float] | None:
    """Returns (or_high, or_low) from the first or_minutes of a single day's bars."""
    if day_df.empty:
        return None
    start = day_df["datetime"].iloc[0]
    window = day_df[day_df["datetime"] < start + pd.Timedelta(minutes=or_minutes)]
    if window.empty:
        return None
    return float(window["high"].max()), float(window["low"].min())


def run_orb_backtest(symbol: str, from_date: str, to_date: str, params: ORBParams) -> dict:
    sym = symbol.strip().upper()
    df = _load_intraday(sym, from_date, to_date, params.interval)
    if df.empty:
        return {"trades": [], "stats": _empty_stats(), "note": "no_intraday_data"}

    force_exit_h, force_exit_m = map(int, params.force_exit_time.split(":"))
    trades = []

    for trade_date, day_df in df.groupby("trade_date"):
        day_df = day_df.sort_values("datetime").reset_index(drop=True)
        rng = _opening_range(day_df, params.or_minutes)
        if rng is None:
            continue
        or_high, or_low = rng
        start = day_df["datetime"].iloc[0]
        post_or = day_df[day_df["datetime"] >= start + pd.Timedelta(minutes=params.or_minutes)]
        if post_or.empty:
            continue

        force_exit_ts = pd.Timestamp.combine(day_df["datetime"].iloc[0].date(),
                                              pd.Timestamp(f"{force_exit_h}:{force_exit_m}").time())

        entry_row, direction = None, None
        for _, row in post_or.iterrows():
            if params.direction in ("long_only", "both") and row["close"] > or_high:
                entry_row, direction = row, 1
                break
            if params.direction in ("short_only", "both") and row["close"] < or_low:
                entry_row, direction = row, -1
                break
        if entry_row is None:
            continue

        entry_price = float(entry_row["close"])
        entry_time = entry_row["datetime"]
        target_price = entry_price * (1 + direction * params.target_pct / 100)
        sl_price = entry_price * (1 - direction * params.sl_pct / 100)

        remaining = post_or[post_or["datetime"] > entry_time]
        exit_price, exit_time, exit_reason = None, None, None
        for _, row in remaining.iterrows():
            if row["datetime"] >= force_exit_ts:
                exit_price, exit_time, exit_reason = float(row["close"]), row["datetime"], "eod"
                break
            hit_target = row["high"] >= target_price if direction == 1 else row["low"] <= target_price
            hit_sl = row["low"] <= sl_price if direction == 1 else row["high"] >= sl_price
            if hit_target:
                exit_price, exit_time, exit_reason = target_price, row["datetime"], "target"
                break
            if hit_sl:
                exit_price, exit_time, exit_reason = sl_price, row["datetime"], "sl"
                break
        if exit_price is None:
            last_row = remaining.iloc[-1] if not remaining.empty else entry_row
            exit_price, exit_time, exit_reason = float(last_row["close"]), last_row["datetime"], "data_end"

        pnl_pct = direction * (exit_price - entry_price) / entry_price * 100
        pnl_amount = round(params.capital_per_trade * pnl_pct / 100, 2)

        bars = [
            {
                "time": str(row["datetime"]),
                "open": round(float(row["open"]), 2), "high": round(float(row["high"]), 2),
                "low": round(float(row["low"]), 2), "close": round(float(row["close"]), 2),
            }
            for _, row in day_df.iterrows()
        ]

        trades.append({
            "trade_date": trade_date,
            "direction": "long" if direction == 1 else "short",
            "or_high": round(or_high, 2), "or_low": round(or_low, 2),
            "entry_time": str(entry_time), "entry_price": round(entry_price, 2),
            "target_price": round(target_price, 2), "sl_price": round(sl_price, 2),
            "exit_time": str(exit_time), "exit_price": round(exit_price, 2),
            "pnl_pct": round(pnl_pct, 2), "pnl_amount": pnl_amount, "exit_reason": exit_reason,
            "bars": bars,
        })

    return {"trades": trades, "stats": _compute_stats(trades)}


def _empty_stats() -> dict:
    return {"total_trades": 0, "win_rate_pct": 0.0, "total_pnl": 0.0, "avg_pnl_pct": 0.0}


def _compute_stats(trades: list) -> dict:
    if not trades:
        return _empty_stats()
    winners = [t for t in trades if t["pnl_amount"] > 0]
    return {
        "total_trades": len(trades),
        "win_rate_pct": round(len(winners) / len(trades) * 100, 1),
        "total_pnl": round(sum(t["pnl_amount"] for t in trades), 2),
        "avg_pnl_pct": round(sum(t["pnl_pct"] for t in trades) / len(trades), 2),
    }
