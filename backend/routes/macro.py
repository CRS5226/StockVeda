"""
Macro routes: indices, FII/DII flows, FnO OI, currency, macro monthly/quarterly, market breadth.
"""

from datetime import date
from typing import Optional
from fastapi import APIRouter, HTTPException, Query
from backend.db.connection import get_db
import pandas as pd

router = APIRouter(prefix="/macro", tags=["macro"])


@router.get("/indices")
def get_indices(
    index_name: Optional[str] = Query(None, description="Partial match, e.g. NIFTY 50"),
    from_date:  Optional[date] = Query(None),
    to_date:    Optional[date] = Query(None),
    limit: int = Query(500, le=5000),
):
    db = get_db()
    sql = "SELECT date, index_name, open, high, low, close FROM index_ohlcv WHERE 1=1"
    params = []
    if index_name:
        sql += " AND index_name ILIKE ?"; params.append(f"%{index_name}%")
    if from_date:
        sql += " AND date >= ?"; params.append(from_date)
    if to_date:
        sql += " AND date <= ?"; params.append(to_date)
    sql += f" ORDER BY date DESC, index_name LIMIT {limit}"
    df = db.execute(sql, params).df()
    df["date"] = df["date"].astype(str)
    return df.where(pd.notna(df), None).to_dict(orient="records")


@router.get("/indices/list")
def list_indices():
    db = get_db()
    rows = db.execute("SELECT DISTINCT index_name FROM index_ohlcv ORDER BY index_name").fetchall()
    return [r[0] for r in rows]


@router.get("/fii-dii")
def get_fii_dii(
    from_date: Optional[date] = Query(None),
    to_date:   Optional[date] = Query(None),
    limit: int = Query(252, le=1000),
):
    db = get_db()
    sql = "SELECT * FROM fii_dii_flows WHERE 1=1"
    params = []
    if from_date:
        sql += " AND date >= ?"; params.append(from_date)
    if to_date:
        sql += " AND date <= ?"; params.append(to_date)
    sql += f" ORDER BY date DESC LIMIT {limit}"
    df = db.execute(sql, params).df()
    if df.empty:
        raise HTTPException(404, "No FII/DII data")
    df["date"] = df["date"].astype(str)
    return df.where(pd.notna(df), None).to_dict(orient="records")


@router.get("/fno-oi")
def get_fno_oi(
    instrument: Optional[str] = Query(None),
    from_date:  Optional[date] = Query(None),
    to_date:    Optional[date] = Query(None),
    limit: int = Query(500, le=5000),
):
    db = get_db()
    sql = "SELECT * FROM fno_oi WHERE 1=1"
    params = []
    if instrument:
        sql += " AND instrument = ?"; params.append(instrument.upper())
    if from_date:
        sql += " AND date >= ?"; params.append(from_date)
    if to_date:
        sql += " AND date <= ?"; params.append(to_date)
    sql += f" ORDER BY date DESC LIMIT {limit}"
    df = db.execute(sql, params).df()
    df["date"] = df["date"].astype(str)
    return df.where(pd.notna(df), None).to_dict(orient="records")


@router.get("/currency")
def get_currency(
    pair: Optional[str] = Query(None, description="e.g. USDINR"),
    from_date: Optional[date] = Query(None),
    to_date:   Optional[date] = Query(None),
    limit: int = Query(500, le=5000),
):
    db = get_db()
    sql = "SELECT date, pair, open, high, low, close FROM currency_ohlcv WHERE 1=1"
    params = []
    if pair:
        sql += " AND pair = ?"; params.append(pair.upper())
    if from_date:
        sql += " AND date >= ?"; params.append(from_date)
    if to_date:
        sql += " AND date <= ?"; params.append(to_date)
    sql += f" ORDER BY date DESC LIMIT {limit}"
    df = db.execute(sql, params).df()
    df["date"] = df["date"].astype(str)
    return df.where(pd.notna(df), None).to_dict(orient="records")


@router.get("/macro-data")
def get_macro_data(
    metric: Optional[str] = Query(None),
    from_date: Optional[date] = Query(None),
    to_date:   Optional[date] = Query(None),
    frequency: str = Query("monthly", pattern="^(monthly|quarterly)$"),
):
    db = get_db()
    table = "macro_monthly" if frequency == "monthly" else "macro_quarterly"
    sql = f"SELECT date, metric, value, unit FROM {table} WHERE 1=1"
    params = []
    if metric:
        sql += " AND metric = ?"; params.append(metric.upper())
    if from_date:
        sql += " AND date >= ?"; params.append(from_date)
    if to_date:
        sql += " AND date <= ?"; params.append(to_date)
    sql += " ORDER BY metric, date DESC LIMIT 1000"
    df = db.execute(sql, params).df()
    df["date"] = df["date"].astype(str)
    return df.where(pd.notna(df), None).to_dict(orient="records")


@router.get("/macro-data/metrics")
def list_macro_metrics():
    db = get_db()
    m = db.execute("SELECT DISTINCT metric FROM macro_monthly ORDER BY metric").fetchall()
    q = db.execute("SELECT DISTINCT metric FROM macro_quarterly ORDER BY metric").fetchall()
    return {"monthly": [r[0] for r in m], "quarterly": [r[0] for r in q]}


@router.get("/market-breadth")
def get_market_breadth(
    from_date: Optional[date] = Query(None),
    to_date:   Optional[date] = Query(None),
    limit: int = Query(252, le=1000),
):
    db = get_db()
    sql = "SELECT * FROM market_breadth WHERE 1=1"
    params = []
    if from_date:
        sql += " AND date >= ?"; params.append(from_date)
    if to_date:
        sql += " AND date <= ?"; params.append(to_date)
    sql += f" ORDER BY date DESC LIMIT {limit}"
    df = db.execute(sql, params).df()
    df["date"] = df["date"].astype(str)
    return df.where(pd.notna(df), None).to_dict(orient="records")


@router.get("/mf-nav")
def get_mf_nav(
    scheme_code: Optional[str] = Query(None),
    scheme_name: Optional[str] = Query(None),
    from_date:   Optional[date] = Query(None),
    to_date:     Optional[date] = Query(None),
    limit: int = Query(500, le=5000),
):
    db = get_db()
    sql = "SELECT date, scheme_code, scheme_name, isin, nav FROM mf_nav WHERE 1=1"
    params = []
    if scheme_code:
        sql += " AND scheme_code = ?"; params.append(scheme_code)
    if scheme_name:
        sql += " AND scheme_name ILIKE ?"; params.append(f"%{scheme_name}%")
    if from_date:
        sql += " AND date >= ?"; params.append(from_date)
    if to_date:
        sql += " AND date <= ?"; params.append(to_date)
    sql += f" ORDER BY date DESC, scheme_name LIMIT {limit}"
    df = db.execute(sql, params).df()
    df["date"] = df["date"].astype(str)
    return df.where(pd.notna(df), None).to_dict(orient="records")
