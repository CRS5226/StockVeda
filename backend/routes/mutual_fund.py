"""
Mutual fund routes: category browsing, scheme list with returns, scheme detail
with NAV history + risk analytics, SIP/XIRR calculator, and GBM NAV projection.
"""

from typing import Optional
from datetime import date
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
import pandas as pd
from backend.db.connection import get_db, df_to_records
from backend.data_sync.base import get_client
from backend.core import mf_analytics

router = APIRouter(prefix="/mutual-fund", tags=["mutual-fund"])

_PERIODS = [("1m", 30), ("3m", 91), ("6m", 182), ("1y", 365), ("3y", 365 * 3), ("5y", 365 * 5)]
_MFAPI_URL = "https://api.mfapi.in/mf/{code}"


def _return_columns() -> str:
    parts = []
    for label, days in _PERIODS:
        parts.append(f"""(
            SELECT n.nav FROM mf_nav n
            WHERE n.scheme_code = s.scheme_code AND n.date <= s.latest_nav_date - INTERVAL '{days} days'
            ORDER BY n.date DESC LIMIT 1
        ) AS nav_{label}""")
    return ",\n".join(parts)


def _with_returns(rows: list, latest_key: str = "latest_nav") -> list:
    for row in rows:
        latest = row.get(latest_key)
        for label, days in _PERIODS:
            nav_key = f"nav_{label}"
            base = row.pop(nav_key, None)
            if latest is None or base in (None, 0):
                row[f"return_{label}"] = None
                continue
            ret = (latest / base - 1) * 100
            years = days / 365
            row[f"return_{label}"] = round(ret, 2)
            row[f"cagr_{label}"] = round(((latest / base) ** (1 / years) - 1) * 100, 2) if years >= 1 else None
    return rows


@router.get("/categories")
def get_categories():
    db = get_db()
    df = db.execute("""
        SELECT bucket, category, COUNT(*) AS scheme_count
        FROM mf_scheme_master
        GROUP BY bucket, category
        ORDER BY bucket, category
    """).df()
    if df.empty:
        raise HTTPException(404, "No mutual fund scheme data synced yet — run the mf_schemes sync first")
    return df_to_records(df)


def _add_stockveda_score(db, rows: list) -> list:
    """StockVeda Score: an open, in-house risk-adjusted ranking (0.5 * Sharpe percentile
    + 0.5 * 3Y-CAGR percentile, within the *current result set*) — NOT an official
    rating like Value Research/Morningstar's proprietary star system. Only computed
    for schemes whose NAV history is already cached locally (cache-first — no new
    mfapi.in calls from a list view)."""
    sharpes = {}
    for row in rows:
        code = row["scheme_code"]
        hist = db.execute(
            "SELECT date, nav FROM mf_nav WHERE scheme_code = ? ORDER BY date", [code]
        ).df()
        if len(hist) < 60:
            continue
        rf = mf_analytics.get_risk_free_rate(str(hist["date"].iloc[-1]))
        sharpes[code] = mf_analytics.sharpe_ratio(hist["nav"], rf)

    if not sharpes:
        for row in rows:
            row["stockveda_score"] = None
        return rows

    sharpe_series = pd.Series(sharpes)
    sharpe_pct = sharpe_series.rank(pct=True)
    cagr_series = pd.Series({r["scheme_code"]: r.get("cagr_3y") for r in rows if r.get("cagr_3y") is not None})
    cagr_pct = cagr_series.rank(pct=True)

    for row in rows:
        code = row["scheme_code"]
        sp = sharpe_pct.get(code)
        cp = cagr_pct.get(code)
        if sp is None or cp is None or pd.isna(sp) or pd.isna(cp):
            row["stockveda_score"] = None
        else:
            row["stockveda_score"] = round(float(0.5 * sp + 0.5 * cp) * 100, 1)
    return rows


@router.get("/schemes")
def get_schemes(
    bucket: Optional[str] = Query(None),
    category: Optional[str] = Query(None),
    q: Optional[str] = Query(None),
    limit: int = Query(200, le=1000),
    sort: Optional[str] = Query(None, description="'stockveda_score' to sort by in-house risk-adjusted score"),
):
    db = get_db()
    where = ["1=1"]
    params: list = []
    if bucket:
        where.append("s.bucket = ?")
        params.append(bucket)
    if category:
        where.append("s.category = ?")
        params.append(category)
    if q:
        where.append("(s.scheme_name ILIKE ? OR s.amc ILIKE ?)")
        params.append(f"%{q}%")
        params.append(f"%{q}%")

    sql = f"""
        SELECT
            s.scheme_code, s.scheme_name, s.amc, s.category, s.bucket, s.plan, s.option_type,
            s.latest_nav, s.latest_nav_date,
            {_return_columns()}
        FROM mf_scheme_master s
        WHERE {" AND ".join(where)}
        ORDER BY s.scheme_name
        LIMIT ?
    """
    params.append(limit)
    df = db.execute(sql, params).df()
    rows = df_to_records(df)
    rows = _with_returns(rows)

    if sort == "stockveda_score":
        rows = _add_stockveda_score(db, rows)
        rows.sort(key=lambda r: (r["stockveda_score"] is None, -(r["stockveda_score"] or 0)))

    return rows


def _backfill_from_mfapi(scheme_code: str, scheme_name: str, isin: Optional[str]) -> int:
    """Pull full NAV history from mfapi.in and cache it into mf_nav. Returns rows inserted."""
    try:
        with get_client(timeout=30) as client:
            resp = client.get(_MFAPI_URL.format(code=scheme_code))
            resp.raise_for_status()
            payload = resp.json()
    except Exception:
        return 0

    data = payload.get("data") or []
    if not data:
        return 0

    df = pd.DataFrame(data)
    df["date"] = pd.to_datetime(df["date"], format="%d-%m-%Y", errors="coerce").dt.date
    df["nav"] = pd.to_numeric(df["nav"], errors="coerce")
    df = df.dropna(subset=["date", "nav"])
    df["scheme_code"] = scheme_code
    df["scheme_name"] = scheme_name
    df["isin"] = isin
    df = df[["date", "scheme_code", "scheme_name", "isin", "nav"]]

    db = get_db()
    db.register("_mf_backfill_tmp", df)
    db.execute("INSERT OR REPLACE INTO mf_nav SELECT * FROM _mf_backfill_tmp")
    db.unregister("_mf_backfill_tmp")
    return len(df)


def _load_meta_and_history(scheme_code: str) -> tuple[dict, "pd.DataFrame"]:
    """Shared by detail/sip/projection: load scheme meta, backfill from mfapi.in on
    first touch if the local cache is sparse, then return the full NAV history."""
    db = get_db()
    meta_df = db.execute(
        "SELECT * FROM mf_scheme_master WHERE scheme_code = ?", [scheme_code]
    ).df()
    if meta_df.empty:
        raise HTTPException(404, f"Unknown scheme code {scheme_code}")
    meta = df_to_records(meta_df)[0]

    count = db.execute(
        "SELECT COUNT(*) FROM mf_nav WHERE scheme_code = ?", [scheme_code]
    ).fetchone()[0]
    if count < 30:
        _backfill_from_mfapi(scheme_code, meta["scheme_name"], meta.get("isin"))

    hist_df = db.execute(
        "SELECT date, nav FROM mf_nav WHERE scheme_code = ? ORDER BY date", [scheme_code]
    ).df()
    if hist_df.empty:
        raise HTTPException(404, f"No NAV history available for {scheme_code}")
    return meta, hist_df


@router.get("/scheme/{scheme_code}")
def get_scheme_detail(scheme_code: str):
    meta, hist_df = _load_meta_and_history(scheme_code)

    latest_row = hist_df.iloc[-1]
    latest_nav = float(latest_row["nav"])
    latest_date = latest_row["date"]

    returns: dict = {}
    for label, days in _PERIODS:
        target = latest_date - pd.Timedelta(days=days)
        prior = hist_df[hist_df["date"] <= target]
        if prior.empty:
            returns[f"return_{label}"] = None
            returns[f"cagr_{label}"] = None
            continue
        base = float(prior.iloc[-1]["nav"])
        years = days / 365
        returns[f"return_{label}"] = round((latest_nav / base - 1) * 100, 2)
        returns[f"cagr_{label}"] = round(((latest_nav / base) ** (1 / years) - 1) * 100, 2) if years >= 1 and base > 0 else None

    risk = mf_analytics.risk_summary(hist_df, str(latest_date))

    return {
        "meta": meta,
        "latest_nav": latest_nav,
        "latest_nav_date": str(latest_date),
        **returns,
        "risk": risk,
        "nav_history": df_to_records(hist_df),
    }


class SipRequest(BaseModel):
    monthly_amount: float
    start_date: str
    end_date: Optional[str] = None


@router.post("/scheme/{scheme_code}/sip")
def get_scheme_sip(scheme_code: str, req: SipRequest):
    _, hist_df = _load_meta_and_history(scheme_code)
    end_date = req.end_date or str(hist_df["date"].iloc[-1])
    result = mf_analytics.sip_xirr(hist_df, req.monthly_amount, req.start_date, end_date)
    if "error" in result:
        raise HTTPException(400, result["error"])
    return result


@router.get("/scheme/{scheme_code}/projection")
def get_scheme_projection(
    scheme_code: str,
    horizon_days: int = Query(90, ge=1, le=1825),
    n_simulations: int = Query(1000, ge=100, le=5000),
    lookback_days: int = Query(252, ge=10, le=1825),
):
    _, hist_df = _load_meta_and_history(scheme_code)
    result = mf_analytics.nav_projection(hist_df, horizon_days, n_simulations, lookback_days)
    if "error" in result:
        raise HTTPException(400, result["error"])
    return result
