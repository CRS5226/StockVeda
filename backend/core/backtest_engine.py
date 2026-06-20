"""
Simple event-driven backtester.
Supports: buy/hold/sell on indicator crossovers or threshold triggers.
Returns equity curve, trades list, and summary stats.
"""

from __future__ import annotations
from dataclasses import dataclass, field
from typing import Literal, Optional
import pandas as pd
import numpy as np
from backend.core.indicators import add_indicators


@dataclass
class BacktestParams:
    symbol: str
    from_date: str
    to_date: str
    initial_capital: float = 100_000.0
    # Entry: buy when entry_col crosses above entry_threshold
    entry_col: str = "close"
    entry_op: Literal["gt", "lt", "cross_above", "cross_below"] = "cross_above"
    entry_threshold_col: str = "sma_50"   # column name or fixed number string
    # Exit: sell after exit_bars OR when exit_col crosses condition
    exit_bars: int | None = 20
    exit_col: str | None = None
    exit_op: Literal["gt", "lt", "cross_above", "cross_below"] | None = None
    exit_threshold_col: str | None = None
    # Position sizing
    position_pct: float = 1.0   # fraction of capital to invest per trade


def _resolve_threshold(df: pd.DataFrame, col_or_num: str) -> pd.Series:
    """Return a Series — either a column from df or a constant."""
    try:
        val = float(col_or_num)
        return pd.Series(val, index=df.index)
    except ValueError:
        return df[col_or_num]


def _check_signal(series: pd.Series, threshold: pd.Series,
                  op: str, prev_series: pd.Series, prev_threshold: pd.Series) -> pd.Series:
    if op == "gt":
        return series > threshold
    if op == "lt":
        return series < threshold
    if op == "cross_above":
        return (series > threshold) & (prev_series <= prev_threshold)
    if op == "cross_below":
        return (series < threshold) & (prev_series >= prev_threshold)
    return pd.Series(False, index=series.index)


def run_backtest(df: pd.DataFrame, params: BacktestParams) -> dict:
    """
    df: OHLCV DataFrame for one symbol, date range already filtered.
    Returns dict with equity_curve, trades, stats.
    """
    # Add indicators needed
    indicators = {"sma_20", "sma_50", "sma_200", "ema_20", "ema_50", "rsi_14", "macd", "atr_14"}
    df = add_indicators(df, indicators)
    df = df.dropna(subset=[params.entry_col]).reset_index(drop=True)

    if df.empty:
        return {"error": "insufficient data after indicator calculation"}

    capital = params.initial_capital
    position = 0       # shares held
    entry_price = 0.0
    entry_idx = None
    trades = []
    equity = []

    entry_thr = _resolve_threshold(df, params.entry_threshold_col)

    exit_thr = None
    if params.exit_col and params.exit_threshold_col:
        exit_thr = _resolve_threshold(df, params.exit_threshold_col)

    for i, row in df.iterrows():
        close = float(row["close"])
        portfolio_value = capital + position * close
        equity.append({"date": str(row["date"]), "value": round(portfolio_value, 2)})

        if i == 0:
            continue

        prev = df.iloc[i - 1]

        # Check exit first
        if position > 0:
            should_exit = False
            if params.exit_bars and entry_idx is not None and (i - entry_idx) >= params.exit_bars:
                should_exit = True
            if params.exit_col and exit_thr is not None and params.exit_op:
                sig = _check_signal(
                    pd.Series([row[params.exit_col]]),
                    pd.Series([exit_thr.iloc[i]]),
                    params.exit_op,
                    pd.Series([prev[params.exit_col]]),
                    pd.Series([exit_thr.iloc[i - 1]]),
                )
                if sig.iloc[0]:
                    should_exit = True

            if should_exit:
                proceeds = position * close
                pnl = proceeds - (position * entry_price)
                trades.append({
                    "entry_date": str(df.iloc[entry_idx]["date"]),
                    "exit_date":  str(row["date"]),
                    "entry_price": round(entry_price, 2),
                    "exit_price":  round(close, 2),
                    "shares":      position,
                    "pnl":         round(pnl, 2),
                    "pnl_pct":     round(pnl / (position * entry_price) * 100, 2),
                })
                capital += proceeds
                position = 0
                entry_price = 0.0
                entry_idx = None

        # Check entry
        if position == 0:
            sig = _check_signal(
                pd.Series([row[params.entry_col]]),
                pd.Series([entry_thr.iloc[i]]),
                params.entry_op,
                pd.Series([prev[params.entry_col]]),
                pd.Series([entry_thr.iloc[i - 1]]),
            )
            if sig.iloc[0] and close > 0:
                invest = capital * params.position_pct
                shares = int(invest // close)
                if shares > 0:
                    position = shares
                    entry_price = close
                    entry_idx = i
                    capital -= shares * close

    # Close open position at last price
    if position > 0 and not df.empty:
        last = df.iloc[-1]
        close = float(last["close"])
        proceeds = position * close
        pnl = proceeds - (position * entry_price)
        trades.append({
            "entry_date": str(df.iloc[entry_idx]["date"]),
            "exit_date":  str(last["date"]) + " (open)",
            "entry_price": round(entry_price, 2),
            "exit_price":  round(close, 2),
            "shares":      position,
            "pnl":         round(pnl, 2),
            "pnl_pct":     round(pnl / (position * entry_price) * 100, 2),
        })
        capital += proceeds

    # Stats
    final_value = capital
    total_return = (final_value - params.initial_capital) / params.initial_capital * 100
    winning = [t for t in trades if t["pnl"] > 0]
    win_rate = len(winning) / len(trades) * 100 if trades else 0

    equity_values = [e["value"] for e in equity]
    peak = params.initial_capital
    max_dd = 0.0
    for v in equity_values:
        if v > peak:
            peak = v
        dd = (peak - v) / peak * 100
        if dd > max_dd:
            max_dd = dd

    stats = {
        "initial_capital": params.initial_capital,
        "final_value":     round(final_value, 2),
        "total_return_pct": round(total_return, 2),
        "total_trades":    len(trades),
        "winning_trades":  len(winning),
        "win_rate_pct":    round(win_rate, 2),
        "max_drawdown_pct": round(max_dd, 2),
        "avg_pnl":         round(sum(t["pnl"] for t in trades) / len(trades), 2) if trades else 0,
    }

    return {
        "equity_curve": equity,
        "trades":       trades,
        "stats":        stats,
    }


# ── V2: multi-condition target/SL based backtest ──────────────────────────

ENTRY_CONDITIONS = [
    {"id": "rsi_lt",             "label": "RSI(14) below threshold",        "has_threshold": True},
    {"id": "close_above_sma50",  "label": "Close crosses above SMA 50",     "has_threshold": False},
    {"id": "close_above_sma200", "label": "Close crosses above SMA 200",    "has_threshold": False},
    {"id": "close_above_ema20",  "label": "Close crosses above EMA 20",     "has_threshold": False},
    {"id": "macd_cross",         "label": "MACD line crosses above signal", "has_threshold": False},
    {"id": "52wk_high",          "label": "Close breaks 52-week high",      "has_threshold": False},
]

VALID_INDICATORS = [
    "close", "open", "high", "low", "volume",
    "rsi_14",
    "sma_20", "sma_50", "sma_200",
    "ema_20", "ema_50",
    "macd", "macd_signal", "macd_hist",
    "bb_upper", "bb_lower",
    "atr_14",
]

VALID_OPERATORS = ["crosses_above", "crosses_below", "above", "below"]

ALL_INDICATORS_NEEDED = {
    "sma_20", "sma_50", "sma_200", "ema_20", "ema_50",
    "rsi_14", "macd", "bb", "atr_14",
}


@dataclass
class ConditionRow:
    left: str       # indicator id
    operator: str   # crosses_above | crosses_below | above | below
    right: str      # indicator id OR numeric string e.g. "30"


@dataclass
class BacktestParamsV2:
    entry_conditions: list  # list[ConditionRow]
    exit_conditions: list   # list[ConditionRow], empty = no indicator exit
    target_pct: float = 15.0
    sl_pct: float = 7.0
    max_bars: int = 30
    capital_per_trade: float = 10_000.0


def _get_series(df: pd.DataFrame, name: str) -> pd.Series:
    """Return a column from df, or a constant Series if name is numeric."""
    try:
        val = float(name)
        return pd.Series(val, index=df.index, dtype=float)
    except ValueError:
        return df[name].astype(float)


def _eval_single_row(df: pd.DataFrame, row: ConditionRow) -> pd.Series:
    """Evaluate one condition row → bool Series."""
    L  = _get_series(df, row.left)
    R  = _get_series(df, row.right)
    Lp = L.shift(1)
    Rp = R.shift(1)

    if row.operator == "crosses_above":
        return (L > R) & (Lp <= Rp)
    if row.operator == "crosses_below":
        return (L < R) & (Lp >= Rp)
    if row.operator == "above":
        return L > R
    if row.operator == "below":
        return L < R
    return pd.Series(False, index=df.index)


def _eval_conditions(df: pd.DataFrame, rows: list) -> pd.Series:
    """AND-combine all condition rows → bool Series. Empty list → all True."""
    if not rows:
        return pd.Series(True, index=df.index)
    result = _eval_single_row(df, rows[0])
    for row in rows[1:]:
        result = result & _eval_single_row(df, row)
    return result.fillna(False)


def run_backtest_v2(df: pd.DataFrame, params: BacktestParamsV2) -> dict:
    """
    Multi-condition target/SL based backtester.
    Entry fires when ALL entry_conditions are True on the same bar.
    Exit fires on: target%, SL%, max_bars timeout, OR (if set) all exit_conditions True.
    Returns ohlcv array + trades + per-symbol stats.
    """
    df = add_indicators(df.copy(), list(ALL_INDICATORS_NEEDED))
    df = df.reset_index(drop=True)

    signals = _eval_conditions(df, params.entry_conditions)
    exit_signals = _eval_conditions(df, params.exit_conditions) if params.exit_conditions else None

    trades = []
    in_trade = False
    entry_idx = 0
    entry_price = 0.0
    target_price = 0.0
    sl_price = 0.0
    shares = 0

    for i in range(1, len(df)):
        row = df.iloc[i]
        close = float(row["close"])
        if pd.isna(close):
            continue

        if in_trade:
            bars_held = i - entry_idx
            exit_reason: Optional[str] = None

            if close >= target_price:
                exit_reason = "target"
            elif close <= sl_price:
                exit_reason = "sl"
            elif exit_signals is not None and bool(exit_signals.iloc[i]):
                exit_reason = "indicator"
            elif bars_held >= params.max_bars:
                exit_reason = "timeout"

            if exit_reason:
                pnl = (close - entry_price) * shares
                trades.append({
                    "entry_date":   str(df.iloc[entry_idx]["date"]),
                    "exit_date":    str(row["date"]),
                    "entry_price":  round(entry_price, 2),
                    "target_price": round(target_price, 2),
                    "sl_price":     round(sl_price, 2),
                    "exit_price":   round(close, 2),
                    "exit_reason":  exit_reason,
                    "shares":       shares,
                    "pnl":          round(pnl, 2),
                    "pnl_pct":      round((close / entry_price - 1) * 100, 2),
                })
                in_trade = False

        if not in_trade and bool(signals.iloc[i]) and close > 0:
            shares = max(1, int(params.capital_per_trade // close))
            entry_price  = close
            target_price = close * (1 + params.target_pct / 100)
            sl_price     = close * (1 - params.sl_pct / 100)
            entry_idx    = i
            in_trade     = True

    # Close any open trade at last price
    if in_trade:
        last = df.iloc[-1]
        close = float(last["close"])
        pnl = (close - entry_price) * shares
        trades.append({
            "entry_date":   str(df.iloc[entry_idx]["date"]),
            "exit_date":    str(last["date"]),
            "entry_price":  round(entry_price, 2),
            "target_price": round(target_price, 2),
            "sl_price":     round(sl_price, 2),
            "exit_price":   round(close, 2),
            "exit_reason":  "timeout",
            "shares":       shares,
            "pnl":          round(pnl, 2),
            "pnl_pct":      round((close / entry_price - 1) * 100, 2),
        })

    # Stats
    winners = [t for t in trades if t["exit_reason"] == "target"]
    total_pnl = sum(t["pnl"] for t in trades)
    stats = {
        "total_trades":  len(trades),
        "win_rate_pct":  round(len(winners) / len(trades) * 100, 1) if trades else 0,
        "total_pnl":     round(total_pnl, 2),
        "avg_pnl_pct":   round(sum(t["pnl_pct"] for t in trades) / len(trades), 2) if trades else 0,
    }

    ohlcv = [
        {"date": str(r["date"]), "open": r["open"], "high": r["high"],
         "low": r["low"], "close": r["close"]}
        for _, r in df.iterrows()
        if not pd.isna(r["close"])
    ]

    return {"ohlcv": ohlcv, "trades": trades, "stats": stats}
