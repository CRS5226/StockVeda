"""
Stock screener engine. Runs filter conditions against DuckDB tables.
Conditions are AND-ed together.
"""

from __future__ import annotations
from dataclasses import dataclass
from typing import Any
import pandas as pd
from backend.db.connection import get_db

ALLOWED_METRICS = {
    # OHLCV-derived
    "close", "volume", "open", "high", "low",
    # Fundamentals
    "revenue", "pat", "ebitda", "eps_basic", "eps_diluted",
    "total_debt", "total_assets", "total_equity",
    # Technicals (computed at screen time via subquery)
    "rsi_14", "sma_20", "sma_50", "sma_200",
    # Ratios (computed)
    "pe_ratio", "debt_to_equity",
    # Delivery
    "delivery_pct",
    # Shareholding
    "promoter_pct", "fii_pct",
}

ALLOWED_OPS = {"gt": ">", "lt": "<", "gte": ">=", "lte": "<=", "eq": "="}


@dataclass
class Condition:
    metric: str
    op: str       # "gt" | "lt" | "gte" | "lte" | "eq"
    value: float


def _validate(conditions: list[Condition]):
    for c in conditions:
        if c.metric not in ALLOWED_METRICS:
            raise ValueError(f"Unknown metric: {c.metric}")
        if c.op not in ALLOWED_OPS:
            raise ValueError(f"Unknown operator: {c.op}")


def run_screen(conditions: list[Condition], limit: int = 200) -> list[dict]:
    _validate(conditions)
    db = get_db()

    # Build the screening query using latest available data per symbol
    # Base CTE: latest OHLCV
    ctes = ["""
    latest_ohlcv AS (
        SELECT o.symbol, o.date, o.open, o.high, o.low, o.close, o.volume
        FROM stock_ohlcv o
        INNER JOIN (
            SELECT symbol, MAX(date) AS max_date FROM stock_ohlcv GROUP BY symbol
        ) m ON o.symbol = m.symbol AND o.date = m.max_date
    )
    """,
    """
    latest_fundamentals AS (
        SELECT f.symbol, f.revenue, f.pat, f.ebitda, f.eps_basic, f.eps_diluted,
               f.total_debt, f.total_assets, f.total_equity
        FROM stock_fundamentals f
        INNER JOIN (
            SELECT symbol, MAX(period) AS max_period
            FROM stock_fundamentals WHERE period_type='Q'
            GROUP BY symbol
        ) m ON f.symbol = m.symbol AND f.period = m.max_period AND f.period_type='Q'
    )
    """,
    """
    latest_delivery AS (
        SELECT d.symbol, d.delivery_pct
        FROM stock_delivery d
        INNER JOIN (
            SELECT symbol, MAX(date) AS max_date FROM stock_delivery GROUP BY symbol
        ) m ON d.symbol = m.symbol AND d.date = m.max_date
    )
    """,
    """
    latest_shareholding AS (
        SELECT s.symbol, s.promoter_pct, s.fii_pct
        FROM shareholding s
        INNER JOIN (
            SELECT symbol, MAX(period) AS max_period FROM shareholding GROUP BY symbol
        ) m ON s.symbol = m.symbol AND s.period = m.max_period
    )
    """,
    """
    combined AS (
        SELECT
            o.symbol, o.date, o.open, o.high, o.low, o.close, o.volume,
            f.revenue, f.pat, f.ebitda, f.eps_basic, f.eps_diluted,
            f.total_debt, f.total_assets, f.total_equity,
            d.delivery_pct,
            s.promoter_pct, s.fii_pct,
            CASE WHEN f.eps_basic > 0 THEN o.close / f.eps_basic ELSE NULL END AS pe_ratio,
            CASE WHEN f.total_equity > 0 THEN f.total_debt / f.total_equity ELSE NULL END AS debt_to_equity
        FROM latest_ohlcv o
        LEFT JOIN latest_fundamentals f ON o.symbol = f.symbol
        LEFT JOIN latest_delivery d ON o.symbol = d.symbol
        LEFT JOIN latest_shareholding s ON o.symbol = s.symbol
    )
    """]

    where_clauses = []
    for c in conditions:
        op = ALLOWED_OPS[c.op]
        where_clauses.append(f"{c.metric} {op} {c.value}")

    where_sql = " AND ".join(where_clauses) if where_clauses else "1=1"

    sql = f"""
    WITH {', '.join(ctes)}
    SELECT symbol, date, close, volume, pe_ratio, debt_to_equity,
           promoter_pct, fii_pct, delivery_pct, eps_basic, pat
    FROM combined
    WHERE {where_sql}
    ORDER BY close DESC
    LIMIT {limit}
    """

    try:
        from backend.db.connection import df_to_records
        result = db.execute(sql).df()
        return df_to_records(result)
    except Exception as e:
        raise RuntimeError(f"Screen query failed: {e}")
