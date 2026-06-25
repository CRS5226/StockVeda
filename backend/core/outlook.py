"""
Trend outlook: indicator confluence score + historical pattern win-rate.
Zero ML, zero external APIs — purely OHLCV + pandas-ta + TA-Lib patterns.
"""
import talib
import numpy as np
import pandas as pd
import pandas_ta as ta

from backend.core.patterns import detect_patterns, PATTERNS


def compute_outlook(df: pd.DataFrame) -> dict:
    """
    Compute trend outlook from an OHLCV DataFrame (full history of a symbol).
    Score range: –8 to +8. Degrades gracefully with fewer bars (minimum 15).
    """
    if len(df) < 15:
        return {"error": "Insufficient data (need ≥15 bars)"}

    df = df.copy().sort_values("date").reset_index(drop=True)

    close  = df["close"].astype(float)
    volume = df["volume"].astype(float) if "volume" in df.columns else None

    # ── Indicators — skip gracefully when insufficient bars ──────────────────────
    n_bars = len(df)
    rsi_s   = ta.rsi(close, length=14) if n_bars >= 15 else None
    macd_df = ta.macd(close)           if n_bars >= 35 else None
    sma20_s = ta.sma(close, length=20) if n_bars >= 20 else None
    sma50_s = ta.sma(close, length=50) if n_bars >= 50 else None

    def safe(s, idx=-1):
        val = s.iloc[idx] if s is not None else float("nan")
        return float(val) if not np.isnan(val) else None

    latest_close = float(close.iloc[-1])
    rsi_val      = safe(rsi_s) or 50.0
    sma20_val    = safe(sma20_s)
    sma50_val    = safe(sma50_s)

    macd_hist_val = None
    macd_hist_prev = None
    if macd_df is not None and not macd_df.empty:
        hist_col = macd_df.iloc[:, 2]
        macd_hist_val  = safe(hist_col, -1)
        macd_hist_prev = safe(hist_col, -2)

    # ── Component scores ─────────────────────────────────────────────────────────

    # RSI: oversold = bullish, overbought = bearish
    if rsi_val < 30:   rsi_score = 2
    elif rsi_val < 45: rsi_score = 1
    elif rsi_val < 55: rsi_score = 0
    elif rsi_val < 70: rsi_score = -1
    else:              rsi_score = -2

    # MACD histogram: crossover or direction
    macd_score = 0.0
    if macd_hist_val is not None and macd_hist_prev is not None:
        if macd_hist_prev < 0 and macd_hist_val > 0:
            macd_score = 2.0   # bullish crossover
        elif macd_hist_prev > 0 and macd_hist_val < 0:
            macd_score = -2.0  # bearish crossover
        elif macd_hist_val > 0:
            macd_score = 1.0 if macd_hist_val > macd_hist_prev else 0.5
        else:
            macd_score = -1.0 if macd_hist_val < macd_hist_prev else -0.5

    # SMA position
    sma20_score = (1 if latest_close > sma20_val else -1) if sma20_val else 0
    sma50_score = (1 if latest_close > sma50_val else -1) if sma50_val else 0
    sma20_diff  = ((latest_close - sma20_val) / sma20_val * 100) if sma20_val else None

    # Volume: recent 3-bar avg vs 20-bar avg
    vol_score = 0.0
    if volume is not None:
        vsma = ta.sma(volume, length=20)
        if vsma is not None:
            avg_v    = safe(vsma) or 0
            recent_v = float(volume.iloc[-3:].mean())
            vol_score = 0.5 if (avg_v > 0 and recent_v > avg_v) else -0.5

    # Recent patterns (last 5 trading dates)
    all_hits = detect_patterns(df)
    recent_dates = sorted(set(df["date"].astype(str).str[:10]))[-5:]
    recent_hits  = [h for h in all_hits if h["date"] in recent_dates]
    bull_cnt = sum(1 for h in recent_hits if h["bias"] == "bullish")
    bear_cnt = sum(1 for h in recent_hits if h["bias"] == "bearish")
    pat_score = 1 if bull_cnt > bear_cnt else (-1 if bear_cnt > bull_cnt else 0)

    # ── Total ────────────────────────────────────────────────────────────────────
    total = rsi_score + macd_score + sma20_score + sma50_score + vol_score + pat_score
    total = round(max(-8.0, min(8.0, total)), 1)

    if total >= 4:    label = "Bullish"
    elif total >= 2:  label = "Mild Bullish"
    elif total >= -1: label = "Neutral"
    elif total >= -3: label = "Mild Bearish"
    else:             label = "Bearish"

    # ── Historical pattern win-rate stats ─────────────────────────────────────
    pattern_stats: list[dict] = []
    recent_pattern_funcs = list({h["pattern"] for h in recent_hits})

    o_arr = df["open"].values.astype(float)
    h_arr = df["high"].values.astype(float)
    l_arr = df["low"].values.astype(float)
    c_arr = df["close"].values.astype(float)

    for func_name in recent_pattern_funcs:
        try:
            result = getattr(talib, func_name)(o_arr, h_arr, l_arr, c_arr)
        except Exception:
            continue

        # Only use historical instances (leave 20 bars clearance at the tail)
        tail_cutoff = len(df) - 21
        occurrences = [i for i, v in enumerate(result) if v != 0 and i <= tail_cutoff]

        if len(occurrences) < 3:
            continue

        up5 = up10 = up20 = 0
        move5_sum = 0.0
        for idx in occurrences:
            base = c_arr[idx]
            if base == 0:
                continue
            if c_arr[idx + 5]  > base: up5  += 1
            if c_arr[idx + 10] > base: up10 += 1
            if c_arr[idx + 20] > base: up20 += 1
            move5_sum += (c_arr[idx + 5] - base) / base * 100

        n = len(occurrences)
        meta = next((p for p in PATTERNS if p[0] == func_name), None)
        pat_label = meta[1] if meta else func_name
        pat_name  = meta[2].split(" — ")[0] if meta else func_name

        pattern_stats.append({
            "pattern":    func_name,
            "label":      pat_label,
            "name":       pat_name,
            "occurrences": n,
            "up5d_pct":   round(up5  / n * 100),
            "up10d_pct":  round(up10 / n * 100),
            "up20d_pct":  round(up20 / n * 100),
            "avg_move5d": round(move5_sum / n, 2),
        })

    return {
        "score": total,
        "label": label,
        "components": {
            "rsi":      round(rsi_score, 1),
            "macd":     round(macd_score, 1),
            "sma20":    sma20_score,
            "sma50":    sma50_score,
            "volume":   vol_score,
            "patterns": pat_score,
        },
        "indicators": {
            "rsi":           round(rsi_val, 1),
            "macd_hist":     round(macd_hist_val, 4) if macd_hist_val is not None else None,
            "sma20_diff_pct": round(sma20_diff, 2)  if sma20_diff   is not None else None,
            "close":         round(latest_close, 2),
        },
        "recent_patterns": [h["label"] for h in recent_hits],
        "pattern_stats":   pattern_stats,
    }
