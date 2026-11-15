"""Indicator rules for the Signals tab: what standard price rules say about one stock on one timeframe.

Educational maths on candles. Each rule reports a state (bullish, neutral or bearish) and why; nothing here is a
recommendation, a forecast or a price target. ADX decides which rules are counted: trend rules in a trending market,
mean-reversion rules in a ranging one, as the usual rule of thumb goes.
"""

from typing import Optional

import numpy as np
import pandas as pd

ADX_TRENDING = 25.0
ADX_RANGING = 20.0
MIN_BARS = 60               # fewer candles than this and no rule is worked out
COLUMNS = ["date", "open", "high", "low", "close", "volume"]

TREND, MOMENTUM, REVERSION, BREAKOUT = "trend", "momentum", "mean_reversion", "breakout"


# ── Indicators (own small versions, so the rules are easy to test) ─────────────

def ema(close: pd.Series, n: int) -> pd.Series:
    return close.ewm(span=n, adjust=False).mean()


def rsi(close: pd.Series, n: int = 14) -> pd.Series:
    """Wilder's RSI."""
    delta = close.diff()
    gain = delta.clip(lower=0).ewm(alpha=1 / n, adjust=False).mean()
    loss = (-delta.clip(upper=0)).ewm(alpha=1 / n, adjust=False).mean()
    out = 100 - 100 / (1 + gain / loss.replace(0, np.nan))
    # no losses at all: 100 when it only went up, 50 when it did not move
    return out.where(loss != 0, np.where(gain > 0, 100.0, 50.0))


def macd(close: pd.Series, fast: int = 12, slow: int = 26, signal: int = 9) -> tuple[pd.Series, pd.Series]:
    line = ema(close, fast) - ema(close, slow)
    return line, ema(line, signal)


def adx(high: pd.Series, low: pd.Series, close: pd.Series, n: int = 14) -> pd.Series:
    """Wilder's ADX: how strong the trend is, whichever way it points."""
    up, down = high.diff(), -low.diff()
    plus_dm = pd.Series(np.where((up > down) & (up > 0), up, 0.0), index=close.index)
    minus_dm = pd.Series(np.where((down > up) & (down > 0), down, 0.0), index=close.index)
    tr = pd.concat([high - low, (high - close.shift()).abs(), (low - close.shift()).abs()], axis=1).max(axis=1)
    atr = tr.ewm(alpha=1 / n, adjust=False).mean()
    plus_di = 100 * plus_dm.ewm(alpha=1 / n, adjust=False).mean() / atr
    minus_di = 100 * minus_dm.ewm(alpha=1 / n, adjust=False).mean() / atr
    dx = 100 * (plus_di - minus_di).abs() / (plus_di + minus_di).replace(0, np.nan)
    return dx.ewm(alpha=1 / n, adjust=False).mean()


def to_weekly(df: pd.DataFrame) -> pd.DataFrame:
    """Daily candles as weekly ones (weeks end on Friday)."""
    d = df.set_index(pd.to_datetime(df["date"]))
    w = d.resample("W-FRI").agg({"open": "first", "high": "max", "low": "min", "close": "last", "volume": "sum"}).dropna(subset=["close"])
    out = w.reset_index().rename(columns={"index": "date", "date": "date"})
    out["date"] = out["date"].dt.date
    return out[COLUMNS]


# ── Helpers ─────────────────────────────────────────────────────────────────────

def _since(state_up: pd.Series, dates: pd.Series) -> Optional[str]:
    """The date a boolean state last flipped to its current value (None when it never changed in the data)."""
    changed = state_up != state_up.shift()
    idx = changed[changed].index
    idx = [i for i in idx if i != state_up.index[0]]
    return str(dates.loc[idx[-1]]) if idx else None


def _bars_since(state_up: pd.Series) -> Optional[int]:
    changed = state_up != state_up.shift()
    idx = [i for i in changed[changed].index if i != state_up.index[0]]
    return len(state_up) - 1 - state_up.index.get_loc(idx[-1]) if idx else None


def _rule(key: str, label: str, family: str, state: str, detail: str, since: Optional[str] = None, bars_ago: Optional[int] = None) -> dict:
    return {"key": key, "label": label, "family": family, "state": state, "detail": detail, "since": since,
            "fresh": bars_ago is not None and bars_ago <= 5, "counts": True}


def _unavailable(key: str, label: str, family: str, need: int) -> dict:
    r = _rule(key, label, family, "neutral", f"Needs {need} candles")
    r["counts"] = False
    return r


# ── The rules ───────────────────────────────────────────────────────────────────

def evaluate_rules(df: pd.DataFrame) -> Optional[dict]:
    """Every rule on the candles of one timeframe (columns date, open, high, low, close, volume, oldest first).

    Returns None when there are too few candles. Otherwise the rule list, the ADX regime, the votes of the rules that
    count in that regime, the overall lean, and the numbers the zone check needs.
    """
    df = df.dropna(subset=["close"]).reset_index(drop=True)
    n = len(df)
    if n < MIN_BARS:
        return None
    close, high, low = df["close"], df["high"], df["low"]
    volume = df["volume"].fillna(0)
    dates = df["date"]
    last = float(close.iloc[-1])
    rules: list[dict] = []

    # Trend: EMA 20 against EMA 50
    e20, e50 = ema(close, 20), ema(close, 50)
    up = e20 > e50
    rules.append(_rule("ema_cross", "EMA 20 / 50", TREND, "bullish" if up.iloc[-1] else "bearish",
                       f"EMA 20 is {'above' if up.iloc[-1] else 'below'} EMA 50", _since(up, dates), _bars_since(up)))

    # Trend: price against the 200-candle average
    if n >= 200:
        sma200 = close.rolling(200).mean()
        above = (close > sma200).iloc[200 - 1:].reset_index(drop=True)
        d200 = dates.iloc[200 - 1:].reset_index(drop=True)
        rules.append(_rule("sma200", "Price vs 200 average", TREND, "bullish" if above.iloc[-1] else "bearish",
                           f"Close is {abs(last / sma200.iloc[-1] - 1) * 100:.1f}% {'above' if above.iloc[-1] else 'below'} its 200-candle average", _since(above, d200), _bars_since(above)))
    else:
        rules.append(_unavailable("sma200", "Price vs 200 average", TREND, 200))

    # Momentum: MACD line against its signal line
    line, sig = macd(close)
    m_up = line > sig
    rules.append(_rule("macd", "MACD (12, 26, 9)", MOMENTUM, "bullish" if m_up.iloc[-1] else "bearish",
                       f"MACD is {'above' if m_up.iloc[-1] else 'below'} its signal line", _since(m_up, dates), _bars_since(m_up)))

    # Mean reversion: RSI at an extreme
    r = rsi(close)
    rv = float(r.iloc[-1])
    rsi_state = "bearish" if rv >= 70 else "bullish" if rv <= 30 else "neutral"
    rules.append(_rule("rsi", "RSI 14", REVERSION, rsi_state, f"RSI is {rv:.0f}" + (" (overbought)" if rv >= 70 else " (oversold)" if rv <= 30 else " (middle range)")))

    # Mean reversion: close outside the Bollinger bands
    mid, sd = close.rolling(20).mean(), close.rolling(20).std()
    upper, lower = mid + 2 * sd, mid - 2 * sd
    pct_b = float((last - lower.iloc[-1]) / (upper.iloc[-1] - lower.iloc[-1])) if upper.iloc[-1] != lower.iloc[-1] else 0.5
    bb_state = "bearish" if last > upper.iloc[-1] else "bullish" if last < lower.iloc[-1] else "neutral"
    rules.append(_rule("bollinger", "Bollinger bands (20, 2)", REVERSION, bb_state,
                       "Close is above the upper band" if bb_state == "bearish" else "Close is below the lower band" if bb_state == "bullish" else "Close is inside the bands"))

    # Breakout: close beyond the previous 20 candles' range, with a volume check
    prior_high, prior_low = high.shift().rolling(20).max(), low.shift().rolling(20).min()
    heavy = bool(volume.iloc[-1] > 1.5 * volume.rolling(20).mean().iloc[-1]) if volume.iloc[-1] > 0 else False
    if last > prior_high.iloc[-1]:
        rules.append(_rule("breakout", "20-candle breakout", BREAKOUT, "bullish", "Close is above the previous 20-candle high" + (", on heavy volume" if heavy else "")))
    elif last < prior_low.iloc[-1]:
        rules.append(_rule("breakout", "20-candle breakout", BREAKOUT, "bearish", "Close is below the previous 20-candle low" + (", on heavy volume" if heavy else "")))
    else:
        rules.append(_rule("breakout", "20-candle breakout", BREAKOUT, "neutral", "Close is inside the previous 20-candle range"))

    # Regime: which rules to count
    a = adx(high, low, close)
    adx_value = float(a.iloc[-1]) if pd.notna(a.iloc[-1]) else None
    regime = None if adx_value is None else "trending" if adx_value >= ADX_TRENDING else "ranging" if adx_value <= ADX_RANGING else "mixed"
    for rule in rules:
        if rule["detail"].startswith("Needs"):
            continue
        if regime == "ranging" and rule["family"] in (TREND, BREAKOUT, MOMENTUM):
            rule["counts"] = False
        elif regime == "trending" and rule["family"] == REVERSION:
            rule["counts"] = False

    counted = [r for r in rules if r["counts"]]
    bull = sum(r["state"] == "bullish" for r in counted)
    bear = sum(r["state"] == "bearish" for r in counted)
    return {
        "bars": n, "adx": adx_value, "regime": regime, "rules": rules,
        "votes": {"bullish": bull, "bearish": bear, "neutral": len(counted) - bull - bear, "counted": len(counted)},
        "lean": "bullish" if bull > bear else "bearish" if bear > bull else "neutral",
        "metrics": {"close": last, "rsi": rv, "pct_b": pct_b, "ema20": float(e20.iloc[-1]), "macd_bullish": bool(m_up.iloc[-1])},
        "as_of": str(dates.iloc[-1]),
    }


def alignment(leans: list[Optional[str]]) -> Optional[str]:
    """Whether the timeframes agree: bullish or bearish when every available one leans that way, else mixed."""
    known = [l for l in leans if l is not None]
    if len(known) < 2:
        return None
    if all(l == "bullish" for l in known):
        return "bullish"
    if all(l == "bearish" for l in known):
        return "bearish"
    return "mixed"
