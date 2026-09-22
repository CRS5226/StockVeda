"""
Intraday OHLCV routes — on-demand yfinance fetch (since intraday can't be bulk-
synced like EOD bhavcopy), and query endpoints for ORB backtesting.
"""

import uuid

from fastapi import APIRouter, BackgroundTasks, HTTPException, Query

from backend.data_sync.sync_intraday import (
    MAX_LOOKBACK_DAYS, VALID_INTERVALS, _run_intraday_fetch_job, intraday_fetch_jobs,
    sync_intraday_batch,
)
from backend.db.connection import get_db

router = APIRouter(prefix="/intraday", tags=["intraday"])


@router.post("/fetch")
async def fetch_intraday(
    background_tasks: BackgroundTasks,
    symbol: str = Query(...),
    interval: str = Query("5m"),
    days: int = Query(30, ge=1, le=730),
):
    if interval not in VALID_INTERVALS:
        raise HTTPException(400, f"interval must be one of {VALID_INTERVALS}")
    sym = symbol.strip().upper()
    max_days = MAX_LOOKBACK_DAYS.get(interval, 60)
    if days > max_days:
        days = max_days  # silently clamp rather than error — yfinance would truncate anyway

    job_id = uuid.uuid4().hex[:8]
    intraday_fetch_jobs[job_id] = {"total": 1, "done": 0, "inserted": 0, "status": "queued", "symbol": sym, "interval": interval}
    background_tasks.add_task(_run_intraday_fetch_job, job_id, sym, interval, days)
    return {"job_id": job_id, "symbol": sym, "interval": interval, "days": days, "max_lookback_days": max_days}


@router.get("/fetch-job/{job_id}")
def get_intraday_fetch_job(job_id: str):
    job = intraday_fetch_jobs.get(job_id)
    if not job:
        raise HTTPException(404, "Unknown job_id")
    return job


@router.get("/data-status/{symbol}")
def intraday_data_status(symbol: str, interval: str = Query("5m")):
    """Mirrors the F&O option-chain data-status endpoint pattern, for the ORB
    fetch panel to show what's already synced before triggering a new fetch."""
    db = get_db()
    row = db.execute(
        "SELECT MIN(datetime), MAX(datetime), COUNT(*) FROM stock_intraday_ohlcv WHERE symbol = ? AND interval = ?",
        [symbol.strip().upper(), interval],
    ).fetchone()
    earliest, latest, total = row if row else (None, None, 0)
    return {
        "earliest_datetime": str(earliest) if earliest else None,
        "latest_datetime": str(latest) if latest else None,
        "total_bars": total or 0,
    }


@router.post("/fetch-batch")
async def fetch_intraday_batch(
    background_tasks: BackgroundTasks,
    symbols: str = Query(..., description="Comma-separated symbols"),
    interval: str = Query("5m"),
    days: int = Query(30, ge=1, le=730),
):
    """Multi-symbol version of /fetch, for the ML section's stock-picker (which
    can have many symbols at once, unlike ORB's single-symbol flow) — one job_id
    tracks progress across the whole list, same polling contract as /fetch-job."""
    if interval not in VALID_INTERVALS:
        raise HTTPException(400, f"interval must be one of {VALID_INTERVALS}")
    syms = [s.strip().upper() for s in symbols.split(",") if s.strip()]
    if not syms:
        raise HTTPException(400, "No symbols given.")
    max_days = MAX_LOOKBACK_DAYS.get(interval, 60)
    if days > max_days:
        days = max_days

    job_id = uuid.uuid4().hex[:8]
    intraday_fetch_jobs[job_id] = {
        "total": len(syms), "done": 0, "inserted": 0, "status": "queued",
        "symbols": syms, "interval": interval,
    }
    background_tasks.add_task(sync_intraday_batch, syms, interval, days, job_id)
    return {"job_id": job_id, "symbols": syms, "interval": interval, "days": days, "max_lookback_days": max_days}


@router.get("/data-status-batch")
def intraday_data_status_batch(symbols: str = Query(..., description="Comma-separated symbols"), interval: str = Query("5m")):
    """Batch version of /data-status/{symbol} — one call for the whole picked
    stock list instead of N separate requests."""
    syms = [s.strip().upper() for s in symbols.split(",") if s.strip()]
    db = get_db()
    out = {}
    for sym in syms:
        row = db.execute(
            "SELECT MIN(datetime), MAX(datetime), COUNT(*) FROM stock_intraday_ohlcv WHERE symbol = ? AND interval = ?",
            [sym, interval],
        ).fetchone()
        earliest, latest, total = row if row else (None, None, 0)
        out[sym] = {
            "earliest_datetime": str(earliest) if earliest else None,
            "latest_datetime": str(latest) if latest else None,
            "total_bars": total or 0,
        }
    return out
