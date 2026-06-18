"""
Simple event-driven backtester.
Supports: buy/hold/sell on indicator crossovers or threshold triggers.
Returns equity curve, trades list, and summary stats.
"""

from __future__ import annotations
from dataclasses import dataclass, field
from typing import Literal
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
