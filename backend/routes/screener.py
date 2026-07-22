"""
Screener routes — stock filtering, universe management, smart sync, watchlists.
"""

from typing import Optional
from fastapi import APIRouter, HTTPException, BackgroundTasks
from pydantic import BaseModel
from backend.core.screener_engine import Condition, run_screen
from backend.core.screener_universe import (
    PRESETS, resolve_preset, top_n_by_volume,
    get_watchlist_symbols, smart_sync, get_job, new_job_id,
)
from backend.db.connection import get_db

router = APIRouter(prefix="/screener", tags=["screener"])


# ── Request models ─────────────────────────────────────────────────────────

class ConditionIn(BaseModel):
    metric: str
    op: str
    value: float


class ScreenRequest(BaseModel):
    conditions: list[ConditionIn]
    limit: int = 200
    symbols: Optional[list[str]] = None   # scope results to synced universe


class SyncRequest(BaseModel):
    symbols: list[str]
    candle_days: int = 180


class WatchlistCreate(BaseModel):
    name: str
    symbols: list[str]


# ── Screener run ───────────────────────────────────────────────────────────

@router.post("/run")
def run_screener(req: ScreenRequest):
    try:
        conditions = [Condition(metric=c.metric, op=c.op, value=c.value) for c in req.conditions]
        results = run_screen(conditions, limit=min(req.limit, 500), symbols=req.symbols or None)
        return {"count": len(results), "results": results}
    except ValueError as e:
        raise HTTPException(400, str(e))
    except RuntimeError as e:
        raise HTTPException(500, str(e))


# ── Universe presets ───────────────────────────────────────────────────────

@router.get("/presets")
def get_presets():
    """Named universe presets (Nifty 50 / 100) for the stock picker."""
    return [
        {"id": pid, "label": p["label"], "count": len(p["symbols"]), "symbols": p["symbols"]}
        for pid, p in PRESETS.items()
    ]


@router.get("/preset/{preset_id}/symbols")
def get_preset_symbols(preset_id: str):
    syms = resolve_preset(preset_id)
    if syms is None:
        raise HTTPException(404, f"Unknown preset: {preset_id}")
    return {"id": preset_id, "symbols": syms}


# ── Smart sync ─────────────────────────────────────────────────────────────

@router.post("/sync")
def start_sync(req: SyncRequest, background_tasks: BackgroundTasks):
    if not req.symbols:
        raise HTTPException(400, "symbols list is empty")
    if req.candle_days < 1 or req.candle_days > 1500:
        raise HTTPException(400, "candle_days must be between 1 and 1500")

    job_id = new_job_id()
    background_tasks.add_task(smart_sync, list(req.symbols), req.candle_days, job_id)
    return {"job_id": job_id, "total": len(req.symbols)}


@router.get("/sync/{job_id}")
def sync_progress(job_id: str):
    job = get_job(job_id)
    if job is None:
        raise HTTPException(404, "Job not found")
    done  = job["done"]
    total = job["total"]
    pct   = round(done / total * 100) if total > 0 else 0
    return {
        "done":           done,
        "total":          total,
        "pct":            pct,
        "status":         job["status"],
        "current_symbol": job.get("current", ""),
    }


# ── Watchlists ─────────────────────────────────────────────────────────────

@router.post("/watchlists")
def create_watchlist(body: WatchlistCreate):
    db = get_db()
    # Derived from the table's actual max id rather than the watchlist_id_seq
    # sequence — the sequence's counter had desynced from the table (DuckDB
    # per-connection nextval caching vs. this app's thread-local connections),
    # causing a duplicate-key error on insert. Single-writer app, so the tiny
    # race window here is not a practical concern.
    wid = db.execute("SELECT COALESCE(MAX(id), 0) + 1 FROM watchlists").fetchone()[0]
    db.execute(
        "INSERT INTO watchlists (id, name, symbols) VALUES (?, ?, ?)",
        [wid, body.name, body.symbols],
    )
    row = db.execute(
        "SELECT id, name, symbols, created_at FROM watchlists WHERE id = ?", [wid]
    ).fetchone()
    return {"id": row[0], "name": row[1], "symbols": list(row[2]), "created_at": str(row[3])}


@router.get("/watchlists")
def list_watchlists():
    db = get_db()
    rows = db.execute(
        "SELECT id, name, symbols, created_at FROM watchlists ORDER BY created_at DESC"
    ).fetchall()
    return [
        {"id": r[0], "name": r[1], "symbols": list(r[2]), "created_at": str(r[3])}
        for r in rows
    ]


@router.delete("/watchlists/{wid}")
def delete_watchlist(wid: int):
    db = get_db()
    db.execute("DELETE FROM watchlists WHERE id = ?", [wid])
    return {"ok": True}


# ── Metrics ────────────────────────────────────────────────────────────────

@router.get("/metrics")
def get_allowed_metrics():
    from backend.core.screener_engine import ALLOWED_METRICS, ALLOWED_OPS
    return {"metrics": sorted(ALLOWED_METRICS), "operators": list(ALLOWED_OPS.keys())}


# ── Saved Screeners ────────────────────────────────────────────────────────

import json as _json

class SavedScreenerCreate(BaseModel):
    name: str
    conditions: list[ConditionIn]


@router.post("/saved-screeners")
def create_saved_screener(body: SavedScreenerCreate):
    db = get_db()
    sid = db.execute("SELECT nextval('screener_id_seq')").fetchone()[0]
    conditions_json = _json.dumps([c.dict() for c in body.conditions])
    db.execute(
        "INSERT INTO saved_screeners (id, name, conditions) VALUES (?, ?, ?)",
        [sid, body.name, conditions_json],
    )
    row = db.execute(
        "SELECT id, name, conditions, created_at FROM saved_screeners WHERE id = ?", [sid]
    ).fetchone()
    return {"id": row[0], "name": row[1], "conditions": _json.loads(row[2]), "created_at": str(row[3])}


@router.get("/saved-screeners")
def list_saved_screeners():
    db = get_db()
    rows = db.execute(
        "SELECT id, name, conditions, created_at FROM saved_screeners ORDER BY created_at DESC"
    ).fetchall()
    return [
        {"id": r[0], "name": r[1], "conditions": _json.loads(r[2]), "created_at": str(r[3])}
        for r in rows
    ]


@router.delete("/saved-screeners/{sid}")
def delete_saved_screener(sid: int):
    db = get_db()
    db.execute("DELETE FROM saved_screeners WHERE id = ?", [sid])
    return {"ok": True}


@router.delete("/stock-data")
def delete_all_stock_data():
    """Wipe all fetched OHLCV and technical cache data. Watchlists are preserved."""
    db = get_db()
    db.execute("DELETE FROM stock_ohlcv")
    db.execute("DELETE FROM stock_technical_cache")
    return {"ok": True, "message": "All stock OHLCV and indicator data deleted. Watchlists intact."}
