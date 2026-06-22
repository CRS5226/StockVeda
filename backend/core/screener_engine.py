"""
Stock screener engine. Runs filter conditions against DuckDB tables.
Conditions are AND-ed together.
"""

from __future__ import annotations
from dataclasses import dataclass
from typing import Optional
import pandas as pd
from backend.db.connection import get_db

ALLOWED_METRICS = {
    # OHLCV
    "close", "volume", "open", "high", "low",
    # Fundamentals
    "revenue", "pat", "ebitda", "eps_basic", "eps_diluted",
    "total_debt", "total_assets", "total_equity",
    # Computed ratios
    "pe_ratio", "debt_to_equity",
    # Delivery / shareholding
    "delivery_pct", "promoter_pct", "fii_pct",
    # Moving averages
    "sma_5", "sma_10", "sma_20", "sma_50", "sma_100", "sma_200",
    "ema_9", "ema_12", "ema_20", "ema_26", "ema_50", "ema_100", "ema_200",
    "wma_20", "vwma_20",
    "volume_sma_20", "volume_ratio",
    # Momentum
    "rsi_9", "rsi_14", "rsi_21",
    "macd", "macd_signal", "macd_hist",
    "ppo", "trix_15",
    "stoch_k", "stoch_d",
    "willr", "cci_20",
    "roc_10", "roc_20",
    "mfi_14",
    # Volatility
    "atr_7", "atr_14", "atr_21",
    "bb_upper", "bb_lower", "bb_width", "bb_pct", "std_20",
    # Trend
    "adx_14", "adx_pos", "adx_neg",
    # Volume
    "cmf_20",
    # Price levels
    "high_52w", "low_52w", "pct_from_52w_high", "pct_from_52w_low",
    # Price change
    "change_1d", "change_5d", "change_20d",
}

ALLOWED_OPS = {"gt": ">", "lt": "<", "gte": ">=", "lte": "<=", "eq": "="}

# All columns from stock_technical_cache to pull into the combined CTE
_TECH_COLS = [
    "sma_5", "sma_10", "sma_20", "sma_50", "sma_100", "sma_200",
    "ema_9", "ema_12", "ema_20", "ema_26", "ema_50", "ema_100", "ema_200",
    "wma_20", "vwma_20", "volume_sma_20", "volume_ratio",
    "rsi_9", "rsi_14", "rsi_21",
    "macd", "macd_signal", "macd_hist", "ppo", "trix_15",
    "stoch_k", "stoch_d", "willr", "cci_20",
    "roc_10", "roc_20", "mfi_14",
    "atr_7", "atr_14", "atr_21",
    "bb_upper", "bb_lower", "bb_width", "bb_pct", "std_20",
    "adx_14", "adx_pos", "adx_neg",
    "cmf_20",
    "high_52w", "low_52w", "pct_from_52w_high", "pct_from_52w_low",
    "change_1d", "change_5d", "change_20d",
]


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


def run_screen(
    conditions: list[Condition],
    limit: int = 200,
    symbols: Optional[list[str]] = None,
) -> list[dict]:
    _validate(conditions)
    db = get_db()

    tech_select = ", ".join(f"t.{col}" for col in _TECH_COLS)
    tech_cols_list = ", ".join(f"tc.{col}" for col in _TECH_COLS)

    ctes = [
        """
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
        f"""
        latest_technicals AS (
            SELECT t.symbol, {tech_select}
            FROM stock_technical_cache t
            INNER JOIN (
                SELECT symbol, MAX(date) AS max_date FROM stock_technical_cache GROUP BY symbol
            ) m ON t.symbol = m.symbol AND t.date = m.max_date
        )
        """,
        f"""
        combined AS (
            SELECT
                o.symbol, o.date, o.open, o.high, o.low, o.close, o.volume,
                f.revenue, f.pat, f.ebitda, f.eps_basic, f.eps_diluted,
                f.total_debt, f.total_assets, f.total_equity,
                d.delivery_pct,
                s.promoter_pct, s.fii_pct,
                {tech_cols_list},
                CASE WHEN f.eps_basic > 0 THEN o.close / f.eps_basic ELSE NULL END AS pe_ratio,
                CASE WHEN f.total_equity > 0 THEN f.total_debt / f.total_equity ELSE NULL END AS debt_to_equity
            FROM latest_ohlcv o
            LEFT JOIN latest_fundamentals f  ON o.symbol = f.symbol
            LEFT JOIN latest_delivery d      ON o.symbol = d.symbol
            LEFT JOIN latest_shareholding s  ON o.symbol = s.symbol
            LEFT JOIN latest_technicals tc   ON o.symbol = tc.symbol
        )
        """,
    ]

    where_clauses = []
    if symbols:
        quoted = ", ".join(f"'{s}'" for s in symbols)
        where_clauses.append(f"symbol IN ({quoted})")

    for c in conditions:
        op = ALLOWED_OPS[c.op]
        where_clauses.append(f"{c.metric} {op} {c.value}")

    where_sql = " AND ".join(where_clauses) if where_clauses else "1=1"

    tech_result_cols = ", ".join(_TECH_COLS)
    sql = f"""
    WITH {', '.join(ctes)}
    SELECT symbol, date, close, volume,
           rsi_14, sma_20, sma_50, sma_200, ema_20, ema_50,
           macd, macd_signal, bb_upper, bb_lower, atr_14,
           pe_ratio, debt_to_equity,
           promoter_pct, fii_pct, delivery_pct,
           eps_basic, pat, ebitda,
           change_1d, change_5d, change_20d,
           pct_from_52w_high, pct_from_52w_low,
           rsi_9, rsi_21, adx_14, volume_ratio, cmf_20
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
