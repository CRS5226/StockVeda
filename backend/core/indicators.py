"""
Technical indicator calculations using pandas-ta.
Operates on a DataFrame with columns: date, open, high, low, close, volume.
"""

import pandas as pd
import pandas_ta as ta


def add_indicators(df: pd.DataFrame, indicators: list[str] | None = None) -> pd.DataFrame:
    """
    Add technical indicators to an OHLCV DataFrame.
    If indicators is None, add a standard set.
    Returns df with new columns appended.
    """
    df = df.copy().sort_values("date").reset_index(drop=True)

    if df.empty or len(df) < 5:
        return df

    # Ensure numeric types
    for col in ["open", "high", "low", "close", "volume"]:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")

    requested = set(indicators) if indicators else {
        "sma_20", "sma_50", "sma_200",
        "ema_20", "ema_50",
        "rsi_14",
        "macd",
        "bb",
        "atr_14",
        "volume_sma_20",
    }

    if "sma_20" in requested:
        df["sma_20"] = ta.sma(df["close"], length=20)
    if "sma_50" in requested:
        df["sma_50"] = ta.sma(df["close"], length=50)
    if "sma_200" in requested:
        df["sma_200"] = ta.sma(df["close"], length=200)
    if "ema_20" in requested:
        df["ema_20"] = ta.ema(df["close"], length=20)
    if "ema_50" in requested:
        df["ema_50"] = ta.ema(df["close"], length=50)
    if "rsi_14" in requested:
        df["rsi_14"] = ta.rsi(df["close"], length=14)
    if "macd" in requested:
        macd = ta.macd(df["close"])
        if macd is not None and not macd.empty:
            df["macd"] = macd.iloc[:, 0]
            df["macd_signal"] = macd.iloc[:, 1]
            df["macd_hist"] = macd.iloc[:, 2]
    if "bb" in requested:
        bb = ta.bbands(df["close"], length=20)
        if bb is not None and not bb.empty:
            df["bb_upper"] = bb.iloc[:, 0]
            df["bb_mid"] = bb.iloc[:, 1]
            df["bb_lower"] = bb.iloc[:, 2]
    if "atr_14" in requested:
        df["atr_14"] = ta.atr(df["high"], df["low"], df["close"], length=14)
    if "volume_sma_20" in requested and "volume" in df.columns:
        df["volume_sma_20"] = ta.sma(df["volume"].astype(float), length=20)

    return df


def compute_returns(df: pd.DataFrame) -> pd.DataFrame:
    """Add daily_return and cumulative_return columns."""
    df = df.copy().sort_values("date")
    df["daily_return"] = df["close"].pct_change()
    df["cumulative_return"] = (1 + df["daily_return"]).cumprod() - 1
    return df
