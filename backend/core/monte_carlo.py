"""
Phase 9: Monte Carlo / GBM price-path simulator — a forward-looking "what could
happen" scenario view, modeled on markov_chain.py's shape (params dataclass,
standalone run_*_analysis snapshot function, reuses get_spot_ohlcv for history).

Not risk-neutral option pricing (that would use get_risk_free_rate as drift and
serve a different downstream use case, e.g. Monte Carlo option pricing — NOT
selected here). This is a plain historical-drift scenario simulator: drift and
volatility are both estimated from the symbol's own trailing daily log returns.
"""

from dataclasses import dataclass

import numpy as np
import pandas as pd

from backend.core.fno_signals import get_spot_ohlcv

TRADING_DAYS_PER_YEAR = 252


@dataclass
class MonteCarloParams:
    n_simulations: int = 1000
    horizon_days: int = 30          # forward trading days to simulate
    lookback_days: int = 252        # trailing window used to estimate drift/vol
    seed: int | None = None         # None = nondeterministic; set for reproducibility


def _log_returns(closes: pd.Series) -> pd.Series:
    return np.log(closes / closes.shift(1)).dropna()


def estimate_drift_volatility(closes: pd.Series) -> tuple[float, float]:
    """Returns (daily_drift, daily_volatility) from log returns — daily_drift is
    the plain historical mean log return (NOT risk-free-rate-adjusted); daily_
    volatility is the sample std dev of log returns."""
    rets = _log_returns(closes)
    if len(rets) < 2:
        return 0.0, 0.0
    return float(rets.mean()), float(rets.std(ddof=1))


def simulate_gbm_paths(last_price: float, daily_drift: float, daily_vol: float,
                        horizon_days: int, n_simulations: int, seed: int | None = None) -> np.ndarray:
    """
    Returns an (n_simulations, horizon_days + 1) array; column 0 is last_price
    (t=0, identical across all sims), columns 1..horizon_days are simulated
    forward closes under GBM: S_t = S_{t-1} * exp((drift - 0.5*vol^2) + vol*Z),
    Z ~ N(0,1) i.i.d. per step per simulation.
    """
    rng = np.random.default_rng(seed)
    z = rng.standard_normal((n_simulations, horizon_days))
    step_log_returns = (daily_drift - 0.5 * daily_vol ** 2) + daily_vol * z
    cum_log_returns = np.cumsum(step_log_returns, axis=1)
    paths = np.empty((n_simulations, horizon_days + 1))
    paths[:, 0] = last_price
    paths[:, 1:] = last_price * np.exp(cum_log_returns)
    return paths


def _percentile_paths(paths: np.ndarray) -> dict:
    """Per-step (column-wise) p5/p50/p95 across simulations — a coherent band
    (the percentile of the cross-sectional distribution at each forward day),
    not three arbitrarily-chosen individual sample trajectories."""
    return {
        "p5": np.percentile(paths, 5, axis=0).round(2).tolist(),
        "p50": np.percentile(paths, 50, axis=0).round(2).tolist(),
        "p95": np.percentile(paths, 95, axis=0).round(2).tolist(),
    }


def run_monte_carlo_analysis(sym: str, from_date: str, to_date: str, params: MonteCarloParams) -> dict:
    """Standalone snapshot: estimates drift/vol from an extended-lookback-buffer
    fetch (so short requested ranges still get a full lookback_days estimation
    window, same idea as markov_chain.py's _prep_states), simulates
    n_simulations GBM paths from the latest close, and returns percentile bands
    over horizon_days."""
    sym = sym.strip().upper()
    buffer_days = params.lookback_days * 2 + 30
    extended_from = (pd.Timestamp(from_date) - pd.Timedelta(days=buffer_days)).date().isoformat()
    df = get_spot_ohlcv(sym, extended_from, to_date)
    if df.empty or len(df) < 10:
        return {"error": f"Insufficient price history for {sym} to run Monte Carlo simulation (need at least 10 trading days)."}

    df = df.sort_values("date").reset_index(drop=True)
    df["date"] = df["date"].astype(str)
    window = df["close"].iloc[-params.lookback_days:] if len(df) > params.lookback_days else df["close"]

    daily_drift, daily_vol = estimate_drift_volatility(window)
    last_price = float(df["close"].iloc[-1])
    as_of_date = df["date"].iloc[-1]

    paths = simulate_gbm_paths(last_price, daily_drift, daily_vol, params.horizon_days, params.n_simulations, params.seed)
    percentile_paths = _percentile_paths(paths)

    return {
        "symbol": sym,
        "drift_annualized": round(daily_drift * TRADING_DAYS_PER_YEAR, 4),
        "volatility_annualized": round(daily_vol * (TRADING_DAYS_PER_YEAR ** 0.5), 4),
        "horizon_days": params.horizon_days,
        "n_simulations": params.n_simulations,
        "percentile_paths": percentile_paths,
        "last_price": last_price,
        "as_of_date": as_of_date,
        "lookback_days_used": int(len(window)),
    }
