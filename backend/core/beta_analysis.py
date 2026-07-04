"""
Beta calculation (Phase 6a) — computed from our own OHLCV data (stock_ohlcv / index_ohlcv),
not yfinance. Plain OLS of daily stock returns against daily index returns.
"""

from dataclasses import dataclass

import numpy as np
import pandas as pd

from backend.core.fno_signals import get_spot_ohlcv


@dataclass
class BetaParams:
    lookback_days: int = 252
    index_symbol: str = "NIFTY"


def compute_beta(stock_returns: pd.Series, index_returns: pd.Series) -> dict:
    """OLS slope (beta) + intercept (alpha) + r_squared of stock_returns ~ index_returns."""
    n = len(stock_returns)
    if n < 2:
        return {"beta": None, "alpha": None, "r_squared": None, "n_obs": n}
    x = index_returns.to_numpy()
    y = stock_returns.to_numpy()
    var_x = x.var()
    if var_x == 0:
        return {"beta": None, "alpha": None, "r_squared": None, "n_obs": n}
    slope, intercept = np.polyfit(x, y, 1)
    y_pred = slope * x + intercept
    ss_res = ((y - y_pred) ** 2).sum()
    ss_tot = ((y - y.mean()) ** 2).sum()
    r_squared = 1 - ss_res / ss_tot if ss_tot != 0 else None
    return {
        "beta": round(float(slope), 4),
        "alpha": round(float(intercept), 6),
        "r_squared": round(float(r_squared), 4) if r_squared is not None else None,
        "n_obs": n,
    }


def _merged_returns(sym: str, index_symbol: str, from_date: str, to_date: str) -> pd.DataFrame:
    stock_df = get_spot_ohlcv(sym, from_date, to_date)
    index_df = get_spot_ohlcv(index_symbol, from_date, to_date)
    if stock_df.empty or index_df.empty:
        return pd.DataFrame()
    merged = pd.merge(
        stock_df[["date", "close"]].rename(columns={"close": "stock_close"}),
        index_df[["date", "close"]].rename(columns={"close": "index_close"}),
        on="date", how="inner",
    ).sort_values("date").reset_index(drop=True)
    merged["stock_return"] = merged["stock_close"].pct_change()
    merged["index_return"] = merged["index_close"].pct_change()
    return merged.dropna(subset=["stock_return", "index_return"]).reset_index(drop=True)


def get_current_beta(sym: str, params: BetaParams) -> dict:
    """Beta computed over the trailing lookback_days window, ending at the latest available date."""
    stock_df = get_spot_ohlcv(sym, "1990-01-01", "2100-01-01")
    if stock_df.empty:
        return {"error": f"No OHLCV data for {sym}"}
    to_date = stock_df["date"].iloc[-1]
    from_date = (pd.Timestamp(to_date) - pd.Timedelta(days=int(params.lookback_days * 1.6) + 30)).date().isoformat()
    merged = _merged_returns(sym, params.index_symbol, from_date, to_date)
    if merged.empty:
        return {"error": f"No overlapping data between {sym} and {params.index_symbol}"}
    window = merged.tail(params.lookback_days)
    result = compute_beta(window["stock_return"], window["index_return"])
    result["symbol"] = sym.upper()
    result["index_symbol"] = params.index_symbol.upper()
    result["lookback_days_used"] = len(window)
    result["as_of_date"] = window["date"].iloc[-1]
    return result


def rolling_beta(sym: str, index_symbol: str, from_date: str, to_date: str, window_days: int = 252) -> pd.DataFrame:
    """Rolling-window beta time series for charting. First `window_days` rows have no prior window and are dropped."""
    buffer_from = (pd.Timestamp(from_date) - pd.Timedelta(days=int(window_days * 1.6) + 30)).date().isoformat()
    merged = _merged_returns(sym, index_symbol, buffer_from, to_date)
    if merged.empty:
        return pd.DataFrame(columns=["date", "beta"])

    stock_ret = merged["stock_return"].to_numpy()
    index_ret = merged["index_return"].to_numpy()
    n = len(merged)
    betas = np.full(n, np.nan)
    for i in range(window_days, n):
        x = index_ret[i - window_days + 1 : i + 1]
        y = stock_ret[i - window_days + 1 : i + 1]
        var_x = x.var()
        if var_x > 0:
            betas[i] = np.polyfit(x, y, 1)[0]

    out = merged[["date"]].copy()
    out["beta"] = betas
    out = out.dropna(subset=["beta"])
    out = out[(out["date"] >= from_date) & (out["date"] <= to_date)]
    out["beta"] = out["beta"].round(4)
    return out.reset_index(drop=True)
