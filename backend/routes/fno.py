"""
F&O routes: option chain (from DB), lot sizes, F&O symbol list, on-demand history fetch.
Note: NSE real-time option chain API is Akamai-blocked on cloud IPs.
Data is served from the fno_ohlcv table populated via /fno/fetch-history.
"""

import uuid
from datetime import date
from fastapi import APIRouter, HTTPException, BackgroundTasks
from fastapi import Query as FQuery
from backend.db.connection import get_db

router = APIRouter(prefix="/fno", tags=["fno"])

INDEX_SYMBOLS = {"NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "SENSEX", "NIFTYBANK"}

_lot_cache: dict | None = None
_lot_cache_ts: float = 0.0


def _compute_pcr_db(rows: list) -> float | None:
    ce_oi = sum(r["ce_oi"] or 0 for r in rows)
    pe_oi = sum(r["pe_oi"] or 0 for r in rows)
    return round(pe_oi / ce_oi, 4) if ce_oi > 0 else None


def _compute_max_pain_db(rows: list) -> float:
    strikes = [r["strike"] for r in rows]
    if not strikes:
        return 0
    min_loss, mp = float("inf"), strikes[0]
    for s in strikes:
        loss = sum(
            max(0, r["strike"] - s) * (r["ce_oi"] or 0)
            + max(0, s - r["strike"]) * (r["pe_oi"] or 0)
            for r in rows
        )
        if loss < min_loss:
            min_loss, mp = loss, s
    return mp


@router.get("/option-chain/{symbol}")
def get_option_chain(symbol: str, expiry: str | None = None):
    """
    Returns EOD option chain for symbol from fno_ohlcv (latest available date).
    Includes PCR, Max Pain, and available expiries.
    """
    db = get_db()
    sym = symbol.strip().upper()

    # Determine instrument type
    inst = "OPTIDX" if sym in INDEX_SYMBOLS else "OPTSTK"

    # Check symbol exists in fno_ohlcv
    try:
        latest_date_row = db.execute(
            "SELECT MAX(date) FROM fno_ohlcv WHERE symbol = ? AND instrument = ?",
            [sym, inst],
        ).fetchone()
    except Exception:
        raise HTTPException(404, f"No F&O data for {sym}")

    latest_date = latest_date_row[0] if latest_date_row else None
    if not latest_date:
        raise HTTPException(404, f"No F&O data for {sym} — run fno_bhavcopy sync first")

    # Get all available expiries for this symbol on latest_date
    expiry_rows = db.execute(
        "SELECT DISTINCT expiry FROM fno_ohlcv WHERE symbol = ? AND instrument = ? AND date = ? ORDER BY expiry",
        [sym, inst, latest_date],
    ).fetchall()
    expiry_dates = [str(r[0]) for r in expiry_rows if r[0]]

    chosen = expiry if expiry in expiry_dates else (expiry_dates[0] if expiry_dates else None)
    if not chosen:
        raise HTTPException(404, f"No expiry data for {sym}")

    # Fetch all strikes for the chosen expiry, pivot CE/PE
    rows = db.execute("""
        SELECT
            strike,
            MAX(CASE WHEN option_type = 'CE' THEN close END) AS ce_ltp,
            MAX(CASE WHEN option_type = 'CE' THEN open_interest END) AS ce_oi,
            MAX(CASE WHEN option_type = 'CE' THEN oi_change END) AS ce_oi_change,
            MAX(CASE WHEN option_type = 'PE' THEN close END) AS pe_ltp,
            MAX(CASE WHEN option_type = 'PE' THEN open_interest END) AS pe_oi,
            MAX(CASE WHEN option_type = 'PE' THEN oi_change END) AS pe_oi_change
        FROM fno_ohlcv
        WHERE symbol = ? AND instrument = ? AND date = ? AND expiry = ?
        GROUP BY strike
        ORDER BY strike
    """, [sym, inst, latest_date, chosen]).fetchall()

    if not rows:
        raise HTTPException(404, f"No chain data for {sym} expiry {chosen}")

    # Get spot from underlying (index or stock)
    spot = 0.0
    try:
        if sym in INDEX_SYMBOLS:
            idx_map = {
                "NIFTY": "NIFTY 50", "BANKNIFTY": "NIFTY BANK", "NIFTYBANK": "NIFTY BANK",
                "FINNIFTY": "NIFTY FIN SERVICE", "MIDCPNIFTY": "NIFTY MIDCAP 100",
                "SENSEX": "S&P BSE SENSEX",
            }
            idx_name = idx_map.get(sym, sym)
            spot_row = db.execute(
                "SELECT close FROM index_ohlcv WHERE index_name = ? ORDER BY date DESC LIMIT 1",
                [idx_name],
            ).fetchone()
        else:
            spot_row = db.execute(
                "SELECT close FROM stock_ohlcv WHERE symbol = ? ORDER BY date DESC LIMIT 1",
                [sym],
            ).fetchone()
        if spot_row:
            spot = float(spot_row[0])
    except Exception:
        pass

    # Build chain rows
    chain = []
    for r in rows:
        chain.append({
            "strike": float(r[0]),
            "ce_ltp": float(r[1]) if r[1] is not None else None,
            "ce_oi": int(r[2]) if r[2] is not None else None,
            "ce_oi_change": int(r[3]) if r[3] is not None else None,
            "ce_iv": None,
            "pe_ltp": float(r[4]) if r[4] is not None else None,
            "pe_oi": int(r[5]) if r[5] is not None else None,
            "pe_oi_change": int(r[6]) if r[6] is not None else None,
            "is_atm": False,
        })

    # Mark ATM
    if spot and chain:
        atm = min(chain, key=lambda r: abs(r["strike"] - spot))["strike"]
        for r in chain:
            r["is_atm"] = r["strike"] == atm

    pcr = _compute_pcr_db(chain)
    max_pain = _compute_max_pain_db(chain)

    return {
        "symbol": sym,
        "spot": spot,
        "expiry": chosen,
        "expiry_dates": expiry_dates,
        "data_date": str(latest_date),
        "pcr": pcr,
        "max_pain": max_pain,
        "chain": chain,
    }


@router.get("/lot-sizes")
def get_lot_sizes():
    global _lot_cache, _lot_cache_ts
    import time, requests as _req
    if _lot_cache is None or time.time() - _lot_cache_ts > 21600:
        try:
            url = "https://archives.nseindia.com/content/fo/fo_mktlots.csv"
            txt = _req.get(url, timeout=10, allow_redirects=False).text
            res: dict = {}
            for line in txt.split("\n"):
                if line and "," in line and "symbol" not in line.casefold():
                    parts = [x.strip() for x in line.split(",")]
                    if len(parts) >= 3:
                        try:
                            res[parts[1]] = int(parts[2])
                        except ValueError:
                            pass
            if res:
                _lot_cache = res
                _lot_cache_ts = time.time()
        except Exception:
            pass
        if not _lot_cache:
            # Fallback: derive from fno_ohlcv contracts column or known values
            db = get_db()
            try:
                rows = db.execute(
                    "SELECT DISTINCT symbol FROM fno_ohlcv WHERE instrument IN ('OPTSTK','OPTIDX') ORDER BY symbol"
                ).fetchall()
                _lot_cache = {r[0]: 0 for r in rows}
            except Exception:
                _lot_cache = {}
            _lot_cache_ts = time.time()
    return {"lot_sizes": _lot_cache}


@router.get("/symbols")
def get_fno_symbols():
    db = get_db()
    try:
        rows = db.execute(
            "SELECT DISTINCT symbol FROM fno_ohlcv WHERE instrument IN ('OPTSTK','OPTIDX') ORDER BY symbol"
        ).fetchall()
        return {"symbols": [r[0] for r in rows]}
    except Exception:
        return {"symbols": []}


# ── On-demand historical data fetch ──────────────────────────────────────────

_fetch_jobs: dict = {}


def _run_fetch_job(job_id: str, from_date: date, to_date: date) -> None:
    from backend.data_sync.sync_fno_bhavcopy import fetch_fno_day
    from backend.data_sync.base import upsert_df, log_sync, business_days_between
    from backend.data_sync.nse_session import get_nse_client
    import pandas as pd

    days = business_days_between(from_date, to_date)
    _fetch_jobs[job_id].update({"total": len(days), "done": 0, "inserted": 0, "status": "running", "current_date": ""})

    get_nse_client()

    batch_rows: list = []
    total_inserted = 0
    BATCH = 5

    for i, d in enumerate(days):
        _fetch_jobs[job_id]["current_date"] = str(d)
        try:
            df = fetch_fno_day(d)
            if df is not None:
                batch_rows.append(df)
        except Exception as e:
            print(f"[fno_fetch:{job_id}] WARN {d}: {e}")

        _fetch_jobs[job_id]["done"] = i + 1

        if batch_rows and (len(batch_rows) >= BATCH or i == len(days) - 1):
            try:
                combined = pd.concat(batch_rows, ignore_index=True)
                count = upsert_df(combined, "fno_ohlcv")
                total_inserted += count
                _fetch_jobs[job_id]["inserted"] = total_inserted
                log_sync("nse_fno_bhavcopy", "partial", total_inserted, d)
            except Exception as e:
                print(f"[fno_fetch:{job_id}] WARN flush failed: {e}")
            batch_rows = []

    _fetch_jobs[job_id]["status"] = "done" if total_inserted > 0 else "empty"
    print(f"[fno_fetch:{job_id}] complete — {total_inserted} rows")


@router.post("/fetch-history")
async def fetch_history(
    background_tasks: BackgroundTasks,
    from_date: str = FQuery(..., description="Start date YYYY-MM-DD"),
    to_date: str = FQuery(..., description="End date YYYY-MM-DD"),
):
    """Download index F&O bhavcopy for a date range and insert into fno_ohlcv."""
    try:
        fd = date.fromisoformat(from_date)
        td = date.fromisoformat(to_date)
    except ValueError:
        raise HTTPException(400, "Invalid date format — use YYYY-MM-DD")
    if td < fd:
        raise HTTPException(400, "to_date must be >= from_date")
    if (td - fd).days > 366:
        raise HTTPException(400, "Date range cannot exceed 1 year")

    from backend.data_sync.base import business_days_between
    days = business_days_between(fd, td)

    job_id = uuid.uuid4().hex[:8]
    _fetch_jobs[job_id] = {"total": len(days), "done": 0, "inserted": 0, "status": "queued", "current_date": ""}
    background_tasks.add_task(_run_fetch_job, job_id, fd, td)
    return {"job_id": job_id, "total_days": len(days)}


@router.get("/fetch-job/{job_id}")
def get_fetch_job(job_id: str):
    """Poll progress of a fetch-history job."""
    job = _fetch_jobs.get(job_id)
    if job is None:
        raise HTTPException(404, "Job not found")
    return job
