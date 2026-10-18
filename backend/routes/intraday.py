"""
Intraday OHLCV routes — on-demand yfinance fetch (since intraday can't be bulk-
synced like EOD bhavcopy), and query endpoints for ORB backtesting.
"""

import uuid
from datetime import date
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, HTTPException, Query

from backend.core.timeframes import TIMEFRAMES, load_candles

from backend.data_sync.sync_intraday import (
    MAX_LOOKBACK_DAYS, VALID_INTERVALS, _run_intraday_fetch_job, intraday_fetch_jobs,
    sync_intraday_batch,
)
from backend.db.connection import get_db

router = APIRouter(prefix="/intraday", tags=["intraday"])


@router.get("/timeframes")
def list_timeframes():
    """Timeframes the SMC chart can show, with the per-day bar density and lookback cap the
    UI needs to link a date range to a candle count before any data is requested."""
    return [
        {"key": k, "kind": tf.source, "base_interval": tf.base_interval,
         "bars_per_day": tf.bars_per_day, "max_lookback_days": tf.max_lookback_days}
        for k, tf in TIMEFRAMES.items()
    ]


@router.get("/candles/{symbol}")
def get_timeframe_candles(
    symbol: str,
    interval: str = Query("1D"),
    from_date: Optional[date] = Query(None),
    to_date: Optional[date] = Query(None),
    limit: Optional[int] = Query(None, ge=1, le=50_000),
):
    """Stored bars for charting at any timeframe (1m–1M; 4h/1W/1M are resampled), plus data
    status and how many bars are missing for the requested range. Stored data only — an empty
    result is a normal 200 so the UI can offer to fetch it."""
    if interval not in TIMEFRAMES:
        raise HTTPException(400, f"interval must be one of {list(TIMEFRAMES)}")
    return load_candles(get_db(), symbol.strip().upper(), interval, from_date, to_date, limit)


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
