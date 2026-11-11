"""Risk-free rate for ratios such as Sharpe: the RBI repo rate already synced into rbi_rates."""

from backend.db.connection import get_db

DEFAULT_RISK_FREE_RATE = 0.065  # 6.5% fallback if rbi_rates has no row for the date


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
