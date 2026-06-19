"""
Macro routes: indices, FII/DII flows, FnO OI, currency, macro monthly/quarterly, market breadth.
"""

from datetime import date, timedelta
from typing import Optional
from fastapi import APIRouter, HTTPException, Query
from backend.db.connection import get_db, df_to_records
import pandas as pd

router = APIRouter(prefix="/macro", tags=["macro"])

HEADLINE_INDICES = ["NIFTY 50", "NIFTY BANK", "SENSEX"]
SECTOR_INDICES   = ["NIFTY IT", "NIFTY BANK", "NIFTY AUTO", "NIFTY FMCG",
                    "NIFTY PHARMA", "NIFTY METAL", "NIFTY ENERGY", "NIFTY REALTY"]


@router.get("/dashboard")
def get_dashboard():
    """Single endpoint for the market dashboard — avoids N parallel DB hits."""
    db = get_db()
    today = date.today()
    from30 = (today - timedelta(days=35)).isoformat()  # a bit extra to ensure 30 trading days
    from5  = (today - timedelta(days=7)).isoformat()

    all_idx = list(dict.fromkeys(HEADLINE_INDICES + SECTOR_INDICES))
    ph = ", ".join("?" * len(all_idx))

    # Latest 2 rows per index for change calculation
    rows_latest = db.execute(f"""
        SELECT date, index_name, close FROM (
            SELECT date, index_name, close,
                   ROW_NUMBER() OVER (PARTITION BY index_name ORDER BY date DESC) AS rn
            FROM index_ohlcv WHERE index_name IN ({ph})
        ) WHERE rn <= 2 ORDER BY index_name, date DESC
    """, all_idx).fetchall()

    # Nifty 50 history for line chart
    rows_hist = db.execute("""
        SELECT date, close FROM index_ohlcv
        WHERE index_name = 'NIFTY 50' AND date >= ? ORDER BY date
    """, [from30]).fetchall()

    # Latest FII/DII row
    rows_fii = db.execute(
        "SELECT * FROM fii_dii_flows ORDER BY date DESC LIMIT 1"
    ).fetchone()
    fii_cols = ["date", "fii_buy", "fii_sell", "fii_net", "dii_buy", "dii_sell", "dii_net"]

    # USDINR last 2 days
    rows_cur = db.execute(
        "SELECT date, close FROM currency_ohlcv WHERE pair = 'USDINR' ORDER BY date DESC LIMIT 2"
    ).fetchall()

    # --- process latest 2 rows per index ---
    by_idx: dict[str, list] = {}
    for d, name, close in rows_latest:
        by_idx.setdefault(name, []).append({"date": str(d), "close": close})

    def _tile(name: str):
        rows = by_idx.get(name, [])
        if len(rows) < 2:
            return None
        c, p = rows[0]["close"], rows[1]["close"]
        chg = c - p
        return {"name": name, "close": c, "prev": p,
                "change": round(chg, 2), "change_pct": round(chg / p * 100, 4) if p else 0}

    headline = [t for name in HEADLINE_INDICES if (t := _tile(name))]
    sector_perf = []
    for name in SECTOR_INDICES:
        t = _tile(name)
        if t:
            sector_perf.append({"name": name.replace("NIFTY ", ""),
                                 "pct": round(t["change_pct"], 4)})
    sector_perf.sort(key=lambda x: x["pct"], reverse=True)

    nifty_hist = [{"date": str(d), "close": c} for d, c in rows_hist]

    fii_latest = None
    if rows_fii:
        fii_latest = dict(zip(fii_cols, rows_fii))
        fii_latest["date"] = str(fii_latest["date"])

    usdinr = None
    if rows_cur:
        usdinr = {"close": rows_cur[0][1]}
        if len(rows_cur) > 1:
            prev = rows_cur[1][1]
            usdinr["change_pct"] = round((rows_cur[0][1] - prev) / prev * 100, 4) if prev else 0

    return {
        "headline":    headline,
        "sector_perf": sector_perf,
        "nifty_hist":  nifty_hist,
        "fii_latest":  fii_latest,
        "usdinr":      usdinr,
    }


@router.get("/dashboard/status")
def dashboard_status():
    """Cheap check used by the frontend to decide whether a first-time bootstrap is needed."""
    db = get_db()
    n_idx = db.execute("SELECT COUNT(*) FROM index_ohlcv").fetchone()[0]
    n_sym = db.execute("SELECT COUNT(*) FROM nse_symbols").fetchone()[0]
    # "populated" = everything the front page needs is present (dashboard tiles + search dropdown)
    return {"populated": n_idx > 0 and n_sym > 0, "index_rows": n_idx, "symbol_rows": n_sym}


@router.post("/bootstrap")
def bootstrap():
    """
    First-run seeding for an empty database.

    Synchronously fetches the data that powers the front page:
      - NSE symbol master  -> the search-bar dropdown        (nsearchives CSV, any IP)
      - market indices     -> Nifty/Bank Nifty/Sensex tiles  (yfinance, any IP)
      - currency pairs     -> USD/INR card                   (yfinance, any IP)
      - FII/DII flows      -> flows card                     (NSE, needs Indian IP)

    Each source is seeded only if its table is still empty, so this is fully
    idempotent and safe to call on every page load. Per-stock OHLCV /
    fundamentals are NOT bulk-downloaded here — they are fetched on demand
    (yfinance) when a stock is opened.
    """
    db = get_db()
    results: dict[str, str] = {}

    def _seed(name: str, table: str, run):
        """Run a sync only if its table is empty; record the outcome."""
        try:
            n = db.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
            if n > 0:
                results[name] = "already_present"
                return
            run()
            results[name] = "ok"
        except Exception as e:  # noqa: BLE001 — one source failing must not abort the rest
            results[name] = f"failed: {e}"

    # Symbol master powers the search dropdown — seed it first so search works immediately.
    from backend.data_sync import seed_symbols, sync_indices, sync_currency
    _seed("symbols",  "nse_symbols",    seed_symbols.run)
    _seed("indices",  "index_ohlcv",    sync_indices.run)
    _seed("currency", "currency_ohlcv", sync_currency.run)

    # FII/DII is NSE-only (Indian IP); isolate its import too so it can never break setup.
    try:
        from backend.data_sync import sync_fii_dii
        _seed("fii_dii", "fii_dii_flows", sync_fii_dii.run)
    except Exception as e:  # noqa: BLE001
        results["fii_dii"] = f"failed: {e}"

    n_idx = db.execute("SELECT COUNT(*) FROM index_ohlcv").fetchone()[0]
    n_sym = db.execute("SELECT COUNT(*) FROM nse_symbols").fetchone()[0]
    return {"status": "ok", "index_rows": n_idx, "symbol_rows": n_sym, "sources": results}


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
    return df_to_records(df)


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
    return df_to_records(df)


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
    return df_to_records(df)


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
    return df_to_records(df)


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
    return df_to_records(df)


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
    return df_to_records(df)


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
    return df_to_records(df)
