"""
Mutual fund risk analytics: volatility, Sharpe/Sortino, max drawdown, rolling
returns, SIP/XIRR, and GBM NAV projection + alpha/beta vs a benchmark index.

Reuses the generic GBM (monte_carlo.py) and OLS beta (beta_analysis.py)
primitives already built for stocks, and the RBI-repo-rate helper from
options_math.py — only the data source (mf_nav NAV series instead of
stock_ohlcv closes) and orchestration are new here.
"""

import pandas as pd

from backend.core.monte_carlo import estimate_drift_volatility, simulate_gbm_paths, _percentile_paths, TRADING_DAYS_PER_YEAR
from backend.core.beta_analysis import compute_beta
from backend.core.fno_signals import get_spot_ohlcv
from backend.core.options_math import get_risk_free_rate


def annualized_volatility(nav: pd.Series) -> float | None:
    rets = nav.pct_change().dropna()
    if len(rets) < 2:
        return None
    return round(float(rets.std(ddof=1) * (TRADING_DAYS_PER_YEAR ** 0.5) * 100), 2)


def sharpe_ratio(nav: pd.Series, risk_free_rate: float) -> float | None:
    rets = nav.pct_change().dropna()
    if len(rets) < 2:
        return None
    ann_return = float(rets.mean() * TRADING_DAYS_PER_YEAR)
    ann_vol = float(rets.std(ddof=1) * (TRADING_DAYS_PER_YEAR ** 0.5))
    if ann_vol == 0:
        return None
    return round((ann_return - risk_free_rate) / ann_vol, 2)


def sortino_ratio(nav: pd.Series, risk_free_rate: float) -> float | None:
    rets = nav.pct_change().dropna()
    if len(rets) < 2:
        return None
    ann_return = float(rets.mean() * TRADING_DAYS_PER_YEAR)
    downside = rets[rets < 0]
    if len(downside) < 2:
        return None
    downside_dev = float(downside.std(ddof=1) * (TRADING_DAYS_PER_YEAR ** 0.5))
    if downside_dev == 0:
        return None
    return round((ann_return - risk_free_rate) / downside_dev, 2)


def max_drawdown(nav: pd.Series) -> float | None:
    if nav.empty:
        return None
    running_max = nav.cummax()
    drawdown = (nav - running_max) / running_max
    return round(float(drawdown.min() * 100), 2)


def rolling_returns(nav_df: pd.DataFrame, window_days: int = 365 * 3, sample_step: int = 21) -> list[dict]:
    """Rolling window_days CAGR, sampled every sample_step rows (~monthly) to keep payload light."""
    df = nav_df.sort_values("date").reset_index(drop=True)
    df["_date"] = pd.to_datetime(df["date"])
    out = []
    years = window_days / 365
    for i in range(0, len(df), sample_step):
        end_date = df["_date"].iloc[i]
        start_target = end_date - pd.Timedelta(days=window_days)
        prior = df[df["_date"] <= start_target]
        if prior.empty:
            continue
        base_nav = prior["nav"].iloc[-1]
        if base_nav <= 0:
            continue
        cagr = ((df["nav"].iloc[i] / base_nav) ** (1 / years) - 1) * 100
        out.append({"date": end_date.date().isoformat(), "cagr": round(float(cagr), 2)})
    return out


def _xirr(cash_flows: list[tuple[pd.Timestamp, float]], guess: float = 0.12) -> float | None:
    """Newton-Raphson XIRR solve on a list of (date, amount) cash flows (mirrors the
    Newton-Raphson pattern in options_math.implied_vol, applied to an NPV root-find)."""
    if len(cash_flows) < 2:
        return None
    t0 = cash_flows[0][0]
    days = [(d - t0).days / 365.0 for d, _ in cash_flows]
    amounts = [a for _, a in cash_flows]

    def npv(rate: float) -> float:
        return sum(a / (1 + rate) ** t for a, t in zip(amounts, days))

    def dnpv(rate: float) -> float:
        return sum(-t * a / (1 + rate) ** (t + 1) for a, t in zip(amounts, days))

    rate = guess
    for _ in range(100):
        f = npv(rate)
        d = dnpv(rate)
        if abs(d) < 1e-10:
            break
        new_rate = rate - f / d
        if new_rate <= -0.99:
            new_rate = -0.99
        if abs(new_rate - rate) < 1e-6:
            return new_rate
        rate = new_rate
    return rate if abs(npv(rate)) < 1.0 else None


def sip_xirr(nav_df: pd.DataFrame, monthly_amount: float, start_date: str, end_date: str) -> dict:
    """Simulate a monthly SIP against real historical NAV (one purchase per calendar
    month, at the first available NAV on/after that month's start). Returns invested
    amount, current value, units accumulated, and annualized XIRR."""
    df = nav_df.copy()
    df["date"] = pd.to_datetime(df["date"])
    df = df[(df["date"] >= pd.Timestamp(start_date)) & (df["date"] <= pd.Timestamp(end_date))].sort_values("date").reset_index(drop=True)
    if df.empty or monthly_amount <= 0:
        return {"error": "no NAV data in the given date range"}

    df["month"] = df["date"].dt.to_period("M")
    monthly = df.groupby("month").first().reset_index()

    units = 0.0
    cash_flows: list[tuple[pd.Timestamp, float]] = []
    for _, row in monthly.iterrows():
        units += monthly_amount / row["nav"]
        cash_flows.append((pd.Timestamp(row["date"]), -monthly_amount))

    final_nav = float(df["nav"].iloc[-1])
    final_date = pd.Timestamp(df["date"].iloc[-1])
    current_value = units * final_nav
    cash_flows.append((final_date, current_value))

    invested = monthly_amount * len(monthly)
    xirr = _xirr(cash_flows)

    return {
        "invested": round(invested, 2),
        "current_value": round(current_value, 2),
        "units": round(units, 4),
        "xirr": round(xirr * 100, 2) if xirr is not None else None,
        "n_installments": len(monthly),
        "start_date": pd.Timestamp(monthly["date"].iloc[0]).strftime("%Y-%m-%d"),
        "end_date": final_date.strftime("%Y-%m-%d"),
    }


def nav_projection(nav_df: pd.DataFrame, horizon_days: int = 90, n_simulations: int = 1000,
                    lookback_days: int = 252, seed: int | None = None) -> dict:
    """GBM NAV projection — a probability fan of *plausible future paths* estimated from
    the fund's own historical drift/volatility, not a forecast promise. Reuses
    monte_carlo.py's GBM primitives directly on the NAV series."""
    df = nav_df.sort_values("date").reset_index(drop=True)
    window = df["nav"].iloc[-lookback_days:] if len(df) > lookback_days else df["nav"]
    if len(window) < 10:
        return {"error": "insufficient NAV history for projection (need at least 10 points)"}

    daily_drift, daily_vol = estimate_drift_volatility(window)
    last_nav = float(df["nav"].iloc[-1])
    as_of_date = pd.Timestamp(df["date"].iloc[-1]).strftime("%Y-%m-%d")

    paths = simulate_gbm_paths(last_nav, daily_drift, daily_vol, horizon_days, n_simulations, seed)
    percentile_paths = _percentile_paths(paths)

    return {
        "drift_annualized": round(daily_drift * TRADING_DAYS_PER_YEAR, 4),
        "volatility_annualized": round(daily_vol * (TRADING_DAYS_PER_YEAR ** 0.5), 4),
        "horizon_days": horizon_days,
        "n_simulations": n_simulations,
        "percentile_paths": percentile_paths,
        "last_nav": last_nav,
        "as_of_date": as_of_date,
        "lookback_days_used": int(len(window)),
    }


def fund_beta(nav_df: pd.DataFrame, benchmark_symbol: str = "NIFTY", lookback_days: int = 252) -> dict:
    """Alpha/beta/R² of the fund's NAV returns vs a benchmark price-return index
    (NIFTY by default). Uses the existing price-return index_ohlcv data, not TRI —
    alpha is understated vs the TRI benchmark funds are actually measured against
    (a disclosed simplification; NSE's free TRI series is a natural follow-up)."""
    df = nav_df.sort_values("date").reset_index(drop=True)
    if df.empty:
        return {"beta": None, "alpha_annualized_pct": None, "r_squared": None, "note": "no NAV history"}
    df["_date_ts"] = pd.to_datetime(df["date"])

    to_date = df["_date_ts"].iloc[-1].strftime("%Y-%m-%d")
    from_date = (df["_date_ts"].iloc[-1] - pd.Timedelta(days=int(lookback_days * 1.6) + 30)).strftime("%Y-%m-%d")

    index_df = get_spot_ohlcv(benchmark_symbol, from_date, to_date)
    if index_df.empty:
        return {"beta": None, "alpha_annualized_pct": None, "r_squared": None, "note": f"no benchmark data for {benchmark_symbol}"}

    fund_df = df[(df["_date_ts"] >= from_date) & (df["_date_ts"] <= to_date)][["_date_ts", "nav"]].copy()
    fund_df["date"] = fund_df["_date_ts"].dt.strftime("%Y-%m-%d")
    merged = pd.merge(fund_df, index_df[["date", "close"]], on="date", how="inner").sort_values("date")
    merged["fund_return"] = merged["nav"].pct_change()
    merged["index_return"] = merged["close"].pct_change()
    merged = merged.dropna(subset=["fund_return", "index_return"])
    window = merged.tail(lookback_days)
    if len(window) < 10:
        return {"beta": None, "alpha_annualized_pct": None, "r_squared": None, "note": "insufficient overlapping data"}

    result = compute_beta(window["fund_return"], window["index_return"])
    alpha_daily = result.pop("alpha", None)
    result["alpha_annualized_pct"] = round(alpha_daily * TRADING_DAYS_PER_YEAR * 100, 2) if alpha_daily is not None else None
    result["benchmark"] = benchmark_symbol
    result["benchmark_type"] = "price-return"  # not TRI — documented simplification
    result["lookback_days_used"] = len(window)
    return result


def risk_summary(nav_df: pd.DataFrame, as_of_date: str, benchmark_symbol: str = "NIFTY") -> dict:
    """Full risk block for a scheme detail response — bundles all metrics above."""
    nav = nav_df.sort_values("date")["nav"]
    rf = get_risk_free_rate(as_of_date)
    return {
        "volatility_annualized_pct": annualized_volatility(nav),
        "sharpe": sharpe_ratio(nav, rf),
        "sortino": sortino_ratio(nav, rf),
        "max_drawdown_pct": max_drawdown(nav),
        "risk_free_rate_pct": round(rf * 100, 2),
        **fund_beta(nav_df, benchmark_symbol),
        "rolling_3y_cagr": rolling_returns(nav_df, window_days=365 * 3),
    }
