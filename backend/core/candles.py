"""Loading stored candles for several symbols in one query each."""

import pandas as pd

COLUMNS = ["date", "open", "high", "low", "close", "volume"]


def load_daily(db, symbols: list[str], days: int = 800) -> dict[str, pd.DataFrame]:
    """Daily candles per symbol for roughly the last `days` calendar days, oldest first."""
    if not symbols:
        return {}
    marks = ",".join("?" for _ in symbols)
    df = db.execute(
        f"SELECT symbol, {', '.join(COLUMNS)} FROM stock_ohlcv WHERE symbol IN ({marks}) AND date >= current_date - INTERVAL {int(days)} DAY ORDER BY symbol, date", symbols,
    ).df()
    return {sym: g[COLUMNS].reset_index(drop=True) for sym, g in df.groupby("symbol")}


def load_hourly(db, symbols: list[str], days: int = 400) -> dict[str, pd.DataFrame]:
    """60-minute candles per symbol for roughly the last `days` calendar days, oldest first."""
    if not symbols:
        return {}
    marks = ",".join("?" for _ in symbols)
    df = db.execute(
        f"SELECT symbol, datetime AS date, open, high, low, close, volume FROM stock_intraday_ohlcv WHERE interval = '60m' AND symbol IN ({marks}) "
        f"AND datetime >= current_timestamp - INTERVAL {int(days)} DAY ORDER BY symbol, datetime", symbols,
    ).df()
    return {sym: g[COLUMNS].reset_index(drop=True) for sym, g in df.groupby("symbol")}
