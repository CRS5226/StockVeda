"""
Stock routes: OHLCV, fundamentals, delivery, shareholding, corporate actions, insider trades.
"""

from datetime import date
from typing import Optional
from fastapi import APIRouter, HTTPException, Query
from backend.db.connection import get_db, df_to_records
from backend.core.indicators import add_indicators
import pandas as pd

router = APIRouter(prefix="/stock", tags=["stock"])


def _yfinance_ohlcv(symbol: str, from_date: Optional[date], to_date: Optional[date]) -> pd.DataFrame:
    """Fetch OHLCV from Yahoo Finance as fallback when DB is empty."""
    import yfinance as yf
    from datetime import timedelta
    start = (from_date or date(2020, 1, 1)).isoformat()
    end   = ((to_date or date.today()) + timedelta(days=1)).isoformat()
    t = yf.Ticker(f"{symbol}.NS")
    hist = t.history(start=start, end=end)
    if hist.empty:
        return pd.DataFrame()
    hist = hist.reset_index()
    hist["date"]   = pd.to_datetime(hist["Date"]).dt.date
    hist["symbol"] = symbol
    hist = hist.rename(columns={"Open": "open", "High": "high", "Low": "low",
                                 "Close": "close", "Volume": "volume"})
    return hist[["date", "open", "high", "low", "close", "volume"]].dropna(subset=["close"])


@router.get("/candles/{symbol}")
def get_candles(
    symbol: str,
    from_date: Optional[date] = Query(None),
    to_date:   Optional[date] = Query(None),
    indicators: bool = Query(False),
):
    """OHLCV for charting — DB first, yfinance fallback."""
    df = _fetch_ohlcv(symbol, from_date, to_date)
    if df.empty:
        df = _yfinance_ohlcv(symbol, from_date, to_date)
    if df.empty:
        raise HTTPException(404, f"No candle data for {symbol}")
    if indicators:
        df = add_indicators(df)
    return df_to_records(df)


def _fetch_ohlcv(symbol: str, from_date: Optional[date], to_date: Optional[date]) -> pd.DataFrame:
    db = get_db()
    sql = "SELECT date, open, high, low, close, volume FROM stock_ohlcv WHERE symbol = ?"
    params = [symbol.upper()]
    if from_date:
        sql += " AND date >= ?"
        params.append(from_date)
    if to_date:
        sql += " AND date <= ?"
        params.append(to_date)
    sql += " ORDER BY date"
    return db.execute(sql, params).df()


@router.get("/ohlcv/{symbol}")
def get_ohlcv(
    symbol: str,
    from_date: Optional[date] = Query(None),
    to_date:   Optional[date] = Query(None),
    indicators: bool = Query(False, description="Append technical indicators"),
):
    df = _fetch_ohlcv(symbol, from_date, to_date)
    if df.empty:
        raise HTTPException(404, f"No OHLCV data for {symbol}")
    if indicators:
        df = add_indicators(df)
    return df_to_records(df)


@router.get("/search")
def search_symbols(q: str = Query(..., min_length=1)):
    db = get_db()
    # Primary: nse_symbols table (always populated via seed_symbols)
    rows = db.execute(
        "SELECT symbol, company_name FROM nse_symbols WHERE symbol ILIKE ? ORDER BY symbol LIMIT 20",
        [f"{q.upper()}%"]
    ).fetchall()
    if rows:
        return [{"symbol": r[0], "name": r[1]} for r in rows]
    # Fallback: stock_ohlcv if symbols table not yet seeded
    rows = db.execute(
        "SELECT DISTINCT symbol FROM stock_ohlcv WHERE symbol ILIKE ? ORDER BY symbol LIMIT 20",
        [f"{q.upper()}%"]
    ).fetchall()
    return [{"symbol": r[0], "name": ""} for r in rows]


@router.get("/info/{symbol}")
def get_stock_info(symbol: str):
    db = get_db()
    row = db.execute(
        "SELECT symbol, company_name, series, isin FROM nse_symbols WHERE symbol = ?",
        [symbol.upper()]
    ).fetchone()
    if not row:
        return {"symbol": symbol.upper(), "company_name": None, "series": None, "isin": None}
    return {"symbol": row[0], "company_name": row[1], "series": row[2], "isin": row[3]}


@router.get("/fundamentals/{symbol}")
def get_fundamentals(
    symbol: str,
    period_type: str = Query("Q", pattern="^(Q|A)$"),
    is_consolidated: bool = Query(True),
    limit: int = Query(20, le=40),
):
    db = get_db()
    rows = db.execute(
        """SELECT period, period_type, is_consolidated, revenue, gross_profit, ebitda, ebit,
                  pbt, pat, eps_basic, eps_diluted, total_assets, total_equity, total_debt,
                  cash, cfo, cfi, cff, capex
           FROM stock_fundamentals
           WHERE symbol = ? AND period_type = ? AND is_consolidated = ?
           ORDER BY period DESC LIMIT ?""",
        [symbol.upper(), period_type, is_consolidated, limit]
    ).df()
    if rows.empty:
        raise HTTPException(404, f"No fundamentals for {symbol}")
    return df_to_records(rows)


@router.get("/delivery/{symbol}")
def get_delivery(
    symbol: str,
    from_date: Optional[date] = Query(None),
    to_date:   Optional[date] = Query(None),
):
    db = get_db()
    sql = "SELECT date, delivery_qty, delivery_pct FROM stock_delivery WHERE symbol = ?"
    params = [symbol.upper()]
    if from_date:
        sql += " AND date >= ?"; params.append(from_date)
    if to_date:
        sql += " AND date <= ?"; params.append(to_date)
    sql += " ORDER BY date"
    df = db.execute(sql, params).df()
    if df.empty:
        raise HTTPException(404, f"No delivery data for {symbol}")
    return df_to_records(df)


@router.get("/shareholding/{symbol}")
def get_shareholding(symbol: str):
    db = get_db()
    df = db.execute(
        """SELECT period, promoter_pct, promoter_pledge_pct, fii_pct, dii_pct, mf_pct, retail_pct
           FROM shareholding WHERE symbol = ? ORDER BY period DESC LIMIT 12""",
        [symbol.upper()]
    ).df()
    if df.empty:
        raise HTTPException(404, f"No shareholding data for {symbol}")
    return df_to_records(df)


@router.get("/corporate-actions/{symbol}")
def get_corporate_actions(symbol: str):
    db = get_db()
    df = db.execute(
        """SELECT ex_date, action_type, value, ratio, record_date
           FROM corporate_actions WHERE symbol = ? ORDER BY ex_date DESC LIMIT 50""",
        [symbol.upper()]
    ).df()
    return df_to_records(df)


@router.get("/insider-trades/{symbol}")
def get_insider_trades(
    symbol: str,
    from_date: Optional[date] = Query(None),
    to_date:   Optional[date] = Query(None),
):
    db = get_db()
    sql = """SELECT person_name, person_category, trade_date, transaction_type, quantity, price, filing_date
             FROM insider_trades WHERE symbol = ?"""
    params = [symbol.upper()]
    if from_date:
        sql += " AND trade_date >= ?"; params.append(from_date)
    if to_date:
        sql += " AND trade_date <= ?"; params.append(to_date)
    sql += " ORDER BY trade_date DESC LIMIT 100"
    df = db.execute(sql, params).df()
    return df_to_records(df)


@router.get("/fno/{symbol}")
def get_fno_ohlcv(
    symbol: str,
    instrument: Optional[str] = Query(None, description="FUTSTK, OPTSTK etc."),
    from_date:  Optional[date] = Query(None),
    to_date:    Optional[date] = Query(None),
    limit: int = Query(500, le=5000),
):
    db = get_db()
    sql = "SELECT * FROM fno_ohlcv WHERE symbol = ?"
    params = [symbol.upper()]
    if instrument:
        sql += " AND instrument = ?"; params.append(instrument.upper())
    if from_date:
        sql += " AND date >= ?"; params.append(from_date)
    if to_date:
        sql += " AND date <= ?"; params.append(to_date)
    sql += f" ORDER BY date DESC, expiry LIMIT {limit}"
    df = db.execute(sql, params).df()
    return df_to_records(df)
