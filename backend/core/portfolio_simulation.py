"""Monte Carlo simulation of a portfolio from its own past returns, and the distributions that go with it.

Educational maths. The simulation resamples the past daily returns of the stocks and funds the portfolio holds and
assumes the future looks like that past. It is not a forecast. Fixed deposits grow by their terms, and assets with no
stored price history (crypto, US stocks, gold ...) are held at today's value.
"""

import math
from typing import Optional

import numpy as np
import pandas as pd

TRADING_DAYS_PER_MONTH = 21
TRADING_DAYS_PER_YEAR = 252
MIN_RETURN_DAYS = 120          # fewer past days than this and nothing is simulated
BLOCK_DAYS = 5                 # resampled in blocks of this many days, which keeps a little of the way returns cluster
SEED = 7                       # fixed, so the numbers do not move each time the page loads
BANDS = (5, 25, 50, 75, 95)


def sleeve_returns(price_columns: dict[str, pd.Series], values: dict[str, float]) -> pd.Series:
    """Daily return of the stocks and funds as one holding, weighted by what each is worth today.

    `price_columns` maps a name to its closes (or NAVs) indexed by date; `values` maps the same names to today's value.
    A day on which a holding has no price counts as no move for it, and days before most of the value has a price are dropped.
    """
    names = [n for n in price_columns if values.get(n, 0) > 0]
    if not names:
        return pd.Series(dtype=float)
    prices = pd.concat({n: price_columns[n] for n in names}, axis=1).sort_index()
    returns = prices.pct_change(fill_method=None)
    total = sum(values[n] for n in names)
    weights = pd.Series({n: values[n] / total for n in names})
    covered = returns.notna().mul(weights, axis=1).sum(axis=1)             # share of the value that has a return that day
    out = returns.fillna(0.0).mul(weights, axis=1).sum(axis=1)
    return out[covered >= 0.6]


def bootstrap_paths(daily: np.ndarray, days: int, paths: int, seed: int = SEED, block: int = BLOCK_DAYS) -> np.ndarray:
    """Growth of 1 over `days` days for `paths` random histories, each built from blocks of the past returns.

    Returns an array of shape (paths, days + 1); column 0 is 1.0.
    """
    rng = np.random.default_rng(seed)
    n = len(daily)
    blocks = math.ceil(days / block)
    starts = rng.integers(0, max(n - block, 1), size=(paths, blocks))
    idx = (starts[:, :, None] + np.arange(block)[None, None, :]).reshape(paths, -1)[:, :days] % n
    growth = np.cumprod(1.0 + daily[idx], axis=1)
    return np.concatenate([np.ones((paths, 1)), growth], axis=1)


def percentile_bands(values: np.ndarray) -> dict[str, list[float]]:
    """The 5th, 25th, 50th, 75th and 95th percentile of each column of `values` (paths by time)."""
    return {f"p{p}": np.percentile(values, p, axis=0).tolist() for p in BANDS}


def normal_pdf(x: np.ndarray, mean: float, std: float) -> np.ndarray:
    if std <= 0:
        return np.zeros_like(x)
    return np.exp(-0.5 * ((x - mean) / std) ** 2) / (std * math.sqrt(2 * math.pi))


def histogram_with_normal(values: np.ndarray, bins: int = 36) -> dict:
    """A histogram of `values` and a normal curve fitted to them, both as counts per bin so they can share an axis."""
    counts, edges = np.histogram(values, bins=bins)
    centers = (edges[:-1] + edges[1:]) / 2
    mean, std = float(np.mean(values)), float(np.std(values))
    width = float(edges[1] - edges[0])
    curve = normal_pdf(centers, mean, std) * len(values) * width
    return {
        "bins": [{"x0": float(edges[i]), "x1": float(edges[i + 1]), "count": int(counts[i])} for i in range(len(counts))],
        "curve": [{"x": float(c), "y": float(y)} for c, y in zip(centers, curve)],
        "mean": mean, "std": std,
    }


def return_stats(daily: np.ndarray) -> dict:
    """Facts about a series of daily returns, set against a normal distribution with the same mean and spread."""
    mean, std = float(np.mean(daily)), float(np.std(daily, ddof=1))
    z = (daily - mean) / std if std > 0 else np.zeros_like(daily)
    skew = float(np.mean(z ** 3))
    excess_kurtosis = float(np.mean(z ** 4) - 3)
    return {
        "days": int(len(daily)), "mean_pct": mean * 100, "daily_vol_pct": std * 100,
        "annual_vol_pct": std * math.sqrt(TRADING_DAYS_PER_YEAR) * 100,
        "skew": skew, "excess_kurtosis": excess_kurtosis,
        "best_day_pct": float(np.max(daily)) * 100, "worst_day_pct": float(np.min(daily)) * 100,
        "var95_pct": float(np.percentile(daily, 5)) * 100, "var95_normal_pct": (mean - 1.645 * std) * 100,
        "var99_pct": float(np.percentile(daily, 1)) * 100, "var99_normal_pct": (mean - 2.326 * std) * 100,
        "days_beyond_3_sigma": int(np.sum(np.abs(z) > 3)), "expected_beyond_3_sigma": float(len(daily) * 0.0027),
    }


def simulate(sleeve: pd.Series, sleeve_value: float, fixed_path: list[float], months: int, paths: int = 2000) -> Optional[dict]:
    """Monte Carlo of the whole portfolio.

    `sleeve` is the daily return series of the stocks and funds, `sleeve_value` what they are worth today, and
    `fixed_path` the value at the end of each month 0..months of everything that does not move randomly (FDs and
    assets held flat). Returns None when there is too little past to resample.
    """
    daily = sleeve.to_numpy(dtype=float)
    if len(daily) < MIN_RETURN_DAYS or sleeve_value <= 0:
        return None
    days = months * TRADING_DAYS_PER_MONTH
    growth = bootstrap_paths(daily, days, paths)
    month_idx = [k * TRADING_DAYS_PER_MONTH for k in range(months + 1)]
    fixed = np.asarray(fixed_path, dtype=float)
    totals = sleeve_value * growth[:, month_idx] + fixed[None, :]
    start, end = float(totals[0, 0]), totals[:, -1]
    worst = np.sort(end)[: max(int(len(end) * 0.05), 1)]
    return {
        "months": months, "paths": paths, "start_value": start,
        "bands": percentile_bands(totals),
        "samples": totals[:20].tolist(),
        "outcome": {
            **histogram_with_normal(end),
            "p5": float(np.percentile(end, 5)), "median": float(np.percentile(end, 50)), "p95": float(np.percentile(end, 95)),
            "chance_below_start_pct": float(np.mean(end < start) * 100),
            "average_of_worst_5pct": float(np.mean(worst)),
            "skew": float(np.mean(((end - end.mean()) / end.std()) ** 3)) if end.std() > 0 else 0.0,
        },
        "returns": {**return_stats(daily), **{k: v for k, v in histogram_with_normal(daily * 100, 41).items()}},
        "sleeve_value": float(sleeve_value),
    }


def assemble(stock_closes: dict[str, pd.Series], stock_values: dict[str, float], fund_navs: dict[str, pd.Series], fund_values: dict[str, float],
             fd_values_by_month: list[list[float]], flat_value: float, months: int) -> tuple[pd.Series, float, list[float], dict]:
    """Sort a portfolio into what moves at random and what does not, for `simulate`.

    Returns the daily return series of the stocks and funds, their combined value, the month-end value of everything fixed
    (each FD's value per month, summed, plus the assets held flat), and how today's value is split.
    """
    names = {**{f"S:{k}": v for k, v in stock_closes.items()}, **{f"M:{k}": v for k, v in fund_navs.items()}}
    values = {**{f"S:{k}": v for k, v in stock_values.items()}, **{f"M:{k}": v for k, v in fund_values.items()}}
    values = {k: v for k, v in values.items() if k in names}
    fd_path = [sum(fd[k] for fd in fd_values_by_month) for k in range(months + 1)] if fd_values_by_month else [0.0] * (months + 1)
    return sleeve_returns(names, values), sum(values.values()), [fd + flat_value for fd in fd_path], {
        "stocks": sum(v for k, v in values.items() if k.startswith("S:")),
        "funds": sum(v for k, v in values.items() if k.startswith("M:")),
        "fixed_deposits": fd_path[0], "held_flat": flat_value,
    }
