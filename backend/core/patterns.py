"""
TA-Lib based candle pattern detection.
61 battle-tested CDL functions with proper academic thresholds.
"""
import talib
import numpy as np
import pandas as pd

# Registry: (talib_func, short_label, tip, bull_bias, bear_bias)
# bear_bias=None → pattern is always bullish; bull_bias=None → always bearish
# Both set → bidirectional (+100 bullish, -100 bearish)
PATTERNS: list[tuple[str, str, str, str | None, str | None]] = [
    # Multi-bar reversal patterns (highest quality signals)
    ("CDLMORNINGSTAR",    "MS",  "Morning Star — 3-bar bullish reversal pattern",               "bullish", None),
    ("CDLEVENINGSTAR",    "ES",  "Evening Star — 3-bar bearish reversal pattern",               None,      "bearish"),
    ("CDL3WHITESOLDIERS", "3W",  "Three White Soldiers — strong bullish continuation",         "bullish", None),
    ("CDL3BLACKCROWS",    "3B",  "Three Black Crows — strong bearish continuation",            None,      "bearish"),
    # 2-bar reversal patterns
    ("CDLENGULFING",      "E",   "Bullish Engulfing — buying pressure overwhelmed sellers",      "bullish", "bearish"),
    ("CDLPIERCING",       "P",   "Piercing Line — bullish reversal after downtrend",            "bullish", None),
    ("CDLDARKCLOUDCOVER", "DC",  "Dark Cloud Cover — bearish reversal after uptrend",           None,      "bearish"),
    # Single-bar reversal patterns
    ("CDLHAMMER",         "H",   "Hammer — buyers rejected lower prices",                       "bullish", None),
    ("CDLINVERTEDHAMMER", "IH",  "Inverted Hammer — potential bullish reversal",                 "bullish", None),
    ("CDLSHOOTINGSTAR",   "SS",  "Shooting Star — sellers rejected higher prices",              None,      "bearish"),
    ("CDLDRAGONFLYDOJI",  "DD",  "Dragonfly Doji — strong bullish reversal signal",             "bullish", None),
    ("CDLGRAVESTONEDOJI", "GD",  "Gravestone Doji — strong bearish reversal signal",            None,      "bearish"),
    ("CDLMARUBOZU",       "M",   "Marubozu — strong momentum candle with no wicks",            "bullish", "bearish"),
]

# Quick lookup by func name
_PATTERN_MAP = {p[0]: p[1:] for p in PATTERNS}


# Priority order for deduplication: multi-bar reversal > single-bar reversal > doji/neutral
_PRIORITY = {p[0]: i for i, p in enumerate(PATTERNS)}

# Minimum candle range as % of close to filter insignificant candles
_MIN_RANGE_PCT = 0.004   # 0.4% — skips dust candles on flat days


def detect_patterns(df: pd.DataFrame) -> list[dict]:
    """
    Run TA-Lib CDL functions on an OHLCV DataFrame.
    Applies:
      - minimum candle significance filter (range ≥ 0.4% of close)
      - one pattern per date (highest priority wins)
    Returns PatternHit dicts sorted by date.
    """
    if df.empty or len(df) < 10:
        return []

    o = df["open"].values.astype(float)
    h = df["high"].values.astype(float)
    l = df["low"].values.astype(float)
    c = df["close"].values.astype(float)
    dates = df["date"].astype(str).str[:10].values
    ranges = h - l   # per-bar range

    # Collect all raw hits
    raw: list[dict] = []
    for func_name, default_label, default_tip, bull_bias, bear_bias in PATTERNS:
        try:
            result: np.ndarray = getattr(talib, func_name)(o, h, l, c)
        except Exception:
            continue

        for i, val in enumerate(result):
            if val == 0:
                continue

            # Skip insignificant candles (e.g. flat low-volume days)
            if c[i] > 0 and (ranges[i] / c[i]) < _MIN_RANGE_PCT:
                continue

            bullish_signal = val > 0
            if bullish_signal:
                bias  = bull_bias or "bullish"
                label = default_label
                tip   = default_tip
            else:
                bias = bear_bias or "bearish"
                if func_name == "CDLENGULFING":
                    label, tip = "BE", "Bearish Engulfing — selling pressure overwhelmed buyers"
                elif func_name == "CDLHARAMI":
                    label, tip = "HR", "Bearish Harami — potential reversal down"
                elif func_name == "CDLMARUBOZU":
                    label, tip = "M",  "Bearish Marubozu — strong bearish momentum candle"
                else:
                    label, tip = default_label, default_tip

            raw.append({
                "date":     dates[i],
                "pattern":  func_name,
                "label":    label,
                "bias":     bias,
                "tip":      tip,
                "_priority": _PRIORITY.get(func_name, 99),
            })

    # Deduplicate: one pattern per date, keep highest priority (lowest index)
    by_date: dict[str, dict] = {}
    for hit in raw:
        d = hit["date"]
        if d not in by_date or hit["_priority"] < by_date[d]["_priority"]:
            by_date[d] = hit

    hits = sorted(by_date.values(), key=lambda x: x["date"])
    for h in hits:
        h.pop("_priority", None)
    return hits
