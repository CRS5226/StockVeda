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
        "stoch",
        "willr",
        "cci",
        "adx",
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
    if "stoch" in requested:
        stoch = ta.stoch(df["high"], df["low"], df["close"])
        if stoch is not None and not stoch.empty:
            df["stoch_k"] = stoch.iloc[:, 0]
            df["stoch_d"] = stoch.iloc[:, 1]
    if "willr" in requested:
        df["willr"] = ta.willr(df["high"], df["low"], df["close"])
    if "cci" in requested:
        df["cci"] = ta.cci(df["high"], df["low"], df["close"])
    if "adx" in requested:
        adx = ta.adx(df["high"], df["low"], df["close"])
        if adx is not None and not adx.empty:
            df["adx"] = adx.iloc[:, 0]
            df["adx_pos"] = adx.iloc[:, 1]
            df["adx_neg"] = adx.iloc[:, 2]
    if "volume_sma_20" in requested and "volume" in df.columns:
        df["volume_sma_20"] = ta.sma(df["volume"].astype(float), length=20)

    return df


PARAMETRIC_FAMILIES = {"rsi", "sma", "ema", "atr", "adx", "willr", "cci"}


def add_parametric_indicators(df: pd.DataFrame, names: list[str] | None) -> pd.DataFrame:
    """
    Add arbitrary-period indicator columns parsed from a "family_period" name,
    e.g. "rsi_21", "sma_35", "atr_20", "adx_10". Columns already present are skipped.
    Used by grid-search to sweep indicator *periods*. Raises ValueError on an
    unknown family so the route can surface a 400.
    """
    if not names:
        return df

    for name in names:
        if name in df.columns:
            continue
        family, _, period_str = name.rpartition("_")
        if not family or not period_str.isdigit():
            raise ValueError(f"Cannot parse parametric indicator: {name!r}")
        if family not in PARAMETRIC_FAMILIES:
            raise ValueError(
                f"Unsupported parametric family {family!r} (from {name!r}); "
                f"allowed: {sorted(PARAMETRIC_FAMILIES)}"
            )
        p = int(period_str)
        if p < 2 or p > 400:
            raise ValueError(f"Period out of range (2-400) for {name!r}")

        if family == "rsi":
            df[name] = ta.rsi(df["close"], length=p)
        elif family == "sma":
            df[name] = ta.sma(df["close"], length=p)
        elif family == "ema":
            df[name] = ta.ema(df["close"], length=p)
        elif family == "atr":
            df[name] = ta.atr(df["high"], df["low"], df["close"], length=p)
        elif family == "willr":
            df[name] = ta.willr(df["high"], df["low"], df["close"], length=p)
        elif family == "cci":
            df[name] = ta.cci(df["high"], df["low"], df["close"], length=p)
        elif family == "adx":
            adx = ta.adx(df["high"], df["low"], df["close"], length=p)
            df[name] = adx.iloc[:, 0] if adx is not None and not adx.empty else pd.NA

    return df


def compute_returns(df: pd.DataFrame) -> pd.DataFrame:
    """Add daily_return and cumulative_return columns."""
    df = df.copy().sort_values("date")
    df["daily_return"] = df["close"].pct_change()
    df["cumulative_return"] = (1 + df["daily_return"]).cumprod() - 1
    return df
