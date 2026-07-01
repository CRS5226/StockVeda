"""
Phase 3: Black-Scholes pricing + Newton-Raphson implied-vol solver.

Bhavcopy has no IV column — only premium (close), strike, and OI. IV/Greeks
have to be derived from what we do have: premium, spot, strike, days-to-expiry,
and a risk-free rate (RBI repo rate, already synced in rbi_rates — falls back
to a fixed 6.5% if that table is empty for the date in question).
"""

import math
from backend.db.connection import get_db

DEFAULT_RISK_FREE_RATE = 0.065  # 6.5% fallback if rbi_rates has no row for the date


def _norm_cdf(x: float) -> float:
    return 0.5 * (1.0 + math.erf(x / math.sqrt(2.0)))


def _norm_pdf(x: float) -> float:
    return math.exp(-x * x / 2.0) / math.sqrt(2.0 * math.pi)


def bs_price(spot: float, strike: float, dte_years: float, rate: float, iv: float, option_type: str) -> float:
    """Theoretical Black-Scholes price. dte_years <= 0 or iv <= 0 falls back to intrinsic value."""
    intrinsic = max(0.0, spot - strike) if option_type == "CE" else max(0.0, strike - spot)
    if dte_years <= 0 or iv <= 0 or spot <= 0 or strike <= 0:
        return intrinsic

    sqrt_t = math.sqrt(dte_years)
    d1 = (math.log(spot / strike) + (rate + 0.5 * iv * iv) * dte_years) / (iv * sqrt_t)
    d2 = d1 - iv * sqrt_t

    if option_type == "CE":
        return spot * _norm_cdf(d1) - strike * math.exp(-rate * dte_years) * _norm_cdf(d2)
    return strike * math.exp(-rate * dte_years) * _norm_cdf(-d2) - spot * _norm_cdf(-d1)


def _vega(spot: float, strike: float, dte_years: float, rate: float, iv: float) -> float:
    if dte_years <= 0 or iv <= 0 or spot <= 0 or strike <= 0:
        return 0.0
    sqrt_t = math.sqrt(dte_years)
    d1 = (math.log(spot / strike) + (rate + 0.5 * iv * iv) * dte_years) / (iv * sqrt_t)
    return spot * _norm_pdf(d1) * sqrt_t


def implied_vol(premium: float, spot: float, strike: float, dte_years: float, rate: float,
                 option_type: str, tol: float = 1e-4, max_iter: int = 50) -> float | None:
    """
    Newton-Raphson IV solve. Returns IV as a percentage (e.g. 18.5 for 18.5%), or
    None if the premium is below intrinsic value or the solver doesn't converge
    (illiquid/stale quotes near expiry are the common cause — skip rather than guess).
    """
    if dte_years <= 0 or spot <= 0 or strike <= 0 or premium <= 0:
        return None
    intrinsic = max(0.0, spot - strike) if option_type == "CE" else max(0.0, strike - spot)
    if premium < intrinsic - 1e-6:
        return None

    sigma = 0.3
    for _ in range(max_iter):
        price = bs_price(spot, strike, dte_years, rate, sigma, option_type)
        diff = price - premium
        if abs(diff) < tol:
            return round(sigma * 100, 2)
        vega = _vega(spot, strike, dte_years, rate, sigma)
        if vega < 1e-8:
            break
        sigma -= diff / vega
        if sigma <= 0.001:
            sigma = 0.001
        elif sigma > 5:
            sigma = 5
    return None


def greeks(spot: float, strike: float, dte_years: float, rate: float, iv_pct: float, option_type: str) -> dict:
    """delta (unitless), theta (₹/day), vega (₹ per 1 vol point). None fields if inputs are degenerate."""
    iv = iv_pct / 100.0
    if dte_years <= 0 or iv <= 0 or spot <= 0 or strike <= 0:
        return {"delta": None, "theta": None, "vega": None}

    sqrt_t = math.sqrt(dte_years)
    d1 = (math.log(spot / strike) + (rate + 0.5 * iv * iv) * dte_years) / (iv * sqrt_t)
    d2 = d1 - iv * sqrt_t
    disc = math.exp(-rate * dte_years)

    if option_type == "CE":
        delta = _norm_cdf(d1)
        theta = (-spot * _norm_pdf(d1) * iv / (2 * sqrt_t) - rate * strike * disc * _norm_cdf(d2)) / 365
    else:
        delta = _norm_cdf(d1) - 1
        theta = (-spot * _norm_pdf(d1) * iv / (2 * sqrt_t) + rate * strike * disc * _norm_cdf(-d2)) / 365

    vega = spot * _norm_pdf(d1) * sqrt_t / 100
    return {"delta": round(delta, 4), "theta": round(theta, 2), "vega": round(vega, 2)}


def get_risk_free_rate(as_of_date: str) -> float:
    """Latest RBI repo rate on or before as_of_date, as a decimal (0.065 = 6.5%). Falls back if unavailable."""
    try:
        db = get_db()
        row = db.execute(
            "SELECT repo_rate FROM rbi_rates WHERE date <= ? AND repo_rate IS NOT NULL ORDER BY date DESC LIMIT 1",
            [as_of_date],
        ).fetchone()
        if row and row[0]:
            return float(row[0]) / 100.0
    except Exception:
        pass
    return DEFAULT_RISK_FREE_RATE
