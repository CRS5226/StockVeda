"""
Phase 2: continuous roll-adjusted futures series, so the existing technical-
indicator backtest engine (RSI/MACD/SMA/candle patterns) can run on futures
price action instead of only the cash price.

Method: ratio ("Panama") back-adjustment. Each day uses the front-month
contract's OHLC (front = nearest expiry >= that date, same rule used
throughout backend/core/fno_signals.py and backend/routes/fno.py). On a roll
day, both the expiring contract and the new front contract have a real quote
for the same last trading day (multiple monthly contracts trade concurrently
on NSE) — that gives a same-day price pair to compute an adjustment ratio
from, which is applied to every earlier bar. This keeps % returns continuous
across rolls (correct for RSI/MACD/SMA), instead of showing a fake price jump
that would trigger false signals.

The backtest should use the adjusted open/high/low/close consistently for
both signal generation and P&L — that's what makes the ratio-adjustment
technique valid; mixing adjusted and raw prices within one run would not be.
"""

import pandas as pd
from backend.db.connection import get_db
from backend.core.fno_signals import INDEX_SYMBOLS


def build_continuous_futures(symbol: str, from_date: str, to_date: str) -> pd.DataFrame:
    """
    Returns a DataFrame shaped like cash OHLCV (date, open, high, low, close, volume)
    plus open_interest and is_roll_day, ready to feed into add_indicators()/run_backtest_v2()
    exactly like a stock_ohlcv query. Empty DataFrame if the symbol has no futures data.
    """
    sym = symbol.strip().upper()
    instr = "FUTIDX" if sym in INDEX_SYMBOLS else "FUTSTK"
    db = get_db()

    front_expiry = db.execute("""
        SELECT date, MIN(expiry) AS front_expiry
        FROM fno_futures_ohlcv
        WHERE symbol = ? AND instrument = ? AND date BETWEEN ? AND ? AND expiry >= date
        GROUP BY date
        ORDER BY date
    """, [sym, instr, from_date, to_date]).df()

    if front_expiry.empty:
        return pd.DataFrame(columns=["date", "open", "high", "low", "close", "volume", "open_interest", "is_roll_day"])

    all_rows = db.execute("""
        SELECT date, expiry, open, high, low, close, contracts AS volume, open_interest
        FROM fno_futures_ohlcv
        WHERE symbol = ? AND instrument = ? AND date BETWEEN ? AND ?
    """, [sym, instr, from_date, to_date]).df()

    merged = all_rows.merge(front_expiry, on="date")
    front = merged[merged["expiry"] == merged["front_expiry"]].sort_values("date").reset_index(drop=True)
    front = front.drop(columns=["front_expiry"])

    if front.empty:
        return pd.DataFrame(columns=["date", "open", "high", "low", "close", "volume", "open_interest", "is_roll_day"])

    front["is_roll_day"] = front["expiry"].ne(front["expiry"].shift(1))
    front.loc[0, "is_roll_day"] = False  # first row isn't a "roll" — nothing preceded it

    cumulative_ratio = pd.Series(1.0, index=front.index)
    roll_indices = front.index[front["is_roll_day"]].tolist()

    for i in roll_indices:
        old_expiry = front.loc[i - 1, "expiry"]
        new_expiry = front.loc[i, "expiry"]
        transition_date = front.loc[i - 1, "date"]
        old_close = front.loc[i - 1, "close"]

        new_row = all_rows[(all_rows["date"] == transition_date) & (all_rows["expiry"] == new_expiry)]
        if not new_row.empty and old_close:
            ratio = float(new_row["close"].iloc[0]) / float(old_close)
        else:
            ratio = 1.0  # no overlapping quote (thin contract) — accept a small discontinuity rather than distort history

        cumulative_ratio.loc[: i - 1] *= ratio

    for col in ("open", "high", "low", "close"):
        front[col] = front[col] * cumulative_ratio

    front["date"] = front["date"].astype(str)
    return front[["date", "open", "high", "low", "close", "volume", "open_interest", "is_roll_day"]]
