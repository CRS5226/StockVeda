"""
Intraday OHLCV routes — on-demand yfinance fetch (since intraday can't be bulk-
synced like EOD bhavcopy), and query endpoints for ORB backtesting.
"""

import uuid

from fastapi import APIRouter, BackgroundTasks, HTTPException, Query

from backend.data_sync.sync_intraday import (
    MAX_LOOKBACK_DAYS, VALID_INTERVALS, _run_intraday_fetch_job, intraday_fetch_jobs,
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
