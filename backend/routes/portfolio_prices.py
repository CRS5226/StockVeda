"""Price sync routes: refresh the latest closes and NAVs of a portfolio, in a background job."""

import uuid
from datetime import date, datetime, timezone

from fastapi import APIRouter, BackgroundTasks, HTTPException

from backend.core.price_sync import expected_close_date, stale_keys
from backend.data_sync.sync_portfolio_prices import price_jobs, run_price_sync
from backend.db.connection import get_db

router = APIRouter(prefix="/portfolios/{pid}/prices", tags=["portfolio"])


def _latest(db, sql: str, keys: list[str]) -> dict[str, date | None]:
    """Newest stored date per key; a key with no rows maps to None. `sql` takes a placeholder list for the keys."""
    if not keys:
        return {}
    marks = ",".join("?" for _ in keys)
    rows = db.execute(sql.format(marks=marks), keys).fetchall()
    found = {r[0]: r[1] for r in rows}
    return {k: found.get(k) for k in keys}


@router.post("/sync")
def start_sync(pid: int, background_tasks: BackgroundTasks):
    """Start fetching the prices that are out of date. Answers `up_to_date` straight away when nothing is."""
    db = get_db()
    if not db.execute("SELECT 1 FROM portfolios WHERE id = ?", [pid]).fetchall():
        raise HTTPException(404, "No such portfolio.")
    running = next((jid for jid, j in price_jobs.items() if j["pid"] == pid and j["status"] in ("queued", "running")), None)
    if running:
        return {"status": "started", "job_id": running, **{k: price_jobs[running][k] for k in ("total", "done")}}

    expected = expected_close_date(datetime.now(timezone.utc))
    symbols = [r[0] for r in db.execute("SELECT DISTINCT symbol FROM portfolio_holdings WHERE portfolio_id = ?", [pid]).fetchall()]
    schemes = {r[0]: (r[1], None) for r in db.execute("SELECT DISTINCT scheme_code, scheme_name FROM portfolio_mf WHERE portfolio_id = ?", [pid]).fetchall()}
    stock_latest = _latest(db, "SELECT symbol, MAX(date) FROM stock_ohlcv WHERE symbol IN ({marks}) GROUP BY symbol", sorted(symbols))
    nav_latest = _latest(db, "SELECT scheme_code, MAX(date) FROM mf_nav WHERE scheme_code IN ({marks}) GROUP BY scheme_code", sorted(schemes))
    stale_symbols = {s: stock_latest[s] for s in stale_keys(stock_latest, expected)}
    stale_schemes = {c: schemes[c] for c in stale_keys(nav_latest, expected)}

    if not stale_symbols and not stale_schemes:
        return {"status": "up_to_date", "as_of": str(expected), "checked": len(symbols) + len(schemes)}

    job_id = uuid.uuid4().hex
    total = len(stale_symbols) + len(stale_schemes)
    price_jobs[job_id] = {"pid": pid, "status": "queued", "total": total, "done": 0, "prices": 0, "updated_symbols": 0, "navs": 0,
                          "no_data": [], "as_of": str(expected)}
    background_tasks.add_task(run_price_sync, job_id, stale_symbols, stale_schemes, expected, date.today())
    return {"status": "started", "job_id": job_id, "total": total, "done": 0}


@router.get("/sync/{job_id}")
def sync_progress(pid: int, job_id: str):
    job = price_jobs.get(job_id)
    if job is None or job["pid"] != pid:
        raise HTTPException(404, "No such sync.")
    return {k: v for k, v in job.items() if k != "pid"}
