"""Portfolio data routes: what is stored for the holdings, a background sync that fills the gaps, and the fundamentals table."""

import uuid
from datetime import date, datetime, timezone

from fastapi import APIRouter, BackgroundTasks, HTTPException

from backend.core.portfolio_data import latest_quarter, stale_fundamentals, stale_hourly, stale_ratios
from backend.core.price_sync import expected_close_date
from backend.data_sync.sync_portfolio_data import data_jobs, new_job, run_data_sync
from backend.db.connection import get_db
from backend.routes.portfolio import portfolio_detail

router = APIRouter(prefix="/portfolios/{pid}/data", tags=["portfolio"])


def _marks(n: int) -> str:
    return ",".join("?" for _ in range(n))


def _state(db, pid: int) -> dict:
    """Newest stored date per symbol for each dataset, and the symbols each dataset applies to."""
    holdings = portfolio_detail(db, pid)["holdings"]
    kinds = {h["symbol"]: h["kind"] for h in holdings}
    symbols = sorted(kinds)
    stocks = sorted(s for s, k in kinds.items() if k == "stock")      # ETFs and REITs have no company results to fetch
    hourly = {s: None for s in symbols}
    fundamentals = {s: None for s in stocks}
    ratios = {s: None for s in stocks}
    if symbols:
        for sym, t in db.execute(f"SELECT symbol, MAX(datetime) FROM stock_intraday_ohlcv WHERE interval = '60m' AND symbol IN ({_marks(len(symbols))}) GROUP BY symbol", symbols).fetchall():
            hourly[sym] = t
    if stocks:
        m = _marks(len(stocks))
        for sym, d in db.execute(f"SELECT symbol, MAX(period) FROM stock_fundamentals WHERE period_type = 'Q' AND symbol IN ({m}) GROUP BY symbol", stocks).fetchall():
            fundamentals[sym] = d
        for sym, d in db.execute(f"SELECT symbol, MAX(as_of) FROM stock_ratios_snapshot WHERE symbol IN ({m}) GROUP BY symbol", stocks).fetchall():
            ratios[sym] = d
    attempts: dict[str, dict] = {"hourly": {}, "fundamentals": {}, "ratios": {}}
    for source, status, when in db.execute("SELECT source, status, last_synced_at FROM sync_log WHERE source LIKE 'pdata:%'").fetchall():
        _, key, sym = source.split(":", 2)
        if key in attempts:
            attempts[key][sym] = (status, when)
    return {"hourly": hourly, "fundamentals": fundamentals, "ratios": ratios, "attempts": attempts, "stocks": stocks, "symbols": symbols}


def _stale(state: dict, now: datetime) -> dict:
    expected = expected_close_date(now)
    local = now.astimezone().replace(tzinfo=None)         # the stored times have no zone
    a = state["attempts"]
    return {
        "hourly": stale_hourly(state["hourly"], expected, a["hourly"], local),
        "fundamentals": stale_fundamentals(state["fundamentals"], a["fundamentals"], local),
        "ratios": stale_ratios(state["ratios"], local.date(), a["ratios"], local),
    }


@router.get("/coverage")
def coverage(pid: int):
    db = get_db()
    state = _state(db, pid)
    stale = _stale(state, datetime.now(timezone.utc))
    out = []
    for key, label, note in (("hourly", "1-hour candles", "all holdings"), ("fundamentals", "Fundamentals (results)", "stocks only"), ("ratios", "Valuation ratios (PE, PB, ROE ...)", "stocks only")):
        newest = state[key]
        newest_values = [v for v in newest.values() if v is not None]
        out.append({"key": key, "label": label, "applies_to": note, "total": len(newest), "stored": len(newest_values),
                    "stale": len(stale[key]), "newest": str(max(newest_values)) if newest_values else None})
    return {"datasets": out, "up_to_date": not any(stale.values())}


@router.post("/sync")
def start_sync(pid: int, background_tasks: BackgroundTasks):
    """Fetch what is missing or old for this portfolio's holdings. Answers `up_to_date` straight away when nothing is."""
    db = get_db()
    state = _state(db, pid)       # 404s for an unknown portfolio
    running = next((jid for jid, j in data_jobs.items() if j["pid"] == pid and j["status"] in ("queued", "running")), None)
    if running:
        return {"status": "started", "job_id": running}
    now = datetime.now(timezone.utc)
    stale = _stale(state, now)
    if not any(stale.values()):
        return {"status": "up_to_date", "checked": len(state["symbols"])}
    job_id = uuid.uuid4().hex
    data_jobs[job_id] = new_job(pid, len(stale["hourly"]), len(stale["fundamentals"]), len(stale["ratios"]))
    hourly = {s: state["hourly"][s] for s in stale["hourly"]}
    background_tasks.add_task(run_data_sync, job_id, hourly, stale["fundamentals"], stale["ratios"], now.astimezone().date())
    return {"status": "started", "job_id": job_id}


@router.get("/sync/{job_id}")
def sync_progress(pid: int, job_id: str):
    job = data_jobs.get(job_id)
    if job is None or job["pid"] != pid:
        raise HTTPException(404, "No such sync.")
    return {k: v for k, v in job.items() if k != "pid"}


@router.get("/fundamentals")
def fundamentals_table(pid: int):
    """Per stock: the latest ratio snapshot and the newest quarter's results with growth over the year before."""
    db = get_db()
    state = _state(db, pid)
    stocks = state["stocks"]
    if not stocks:
        return {"rows": []}
    m = _marks(len(stocks))
    snapshots = {r["symbol"]: r for r in db.execute(
        f"SELECT * FROM stock_ratios_snapshot WHERE symbol IN ({m}) QUALIFY ROW_NUMBER() OVER (PARTITION BY symbol ORDER BY as_of DESC) = 1", stocks).df().to_dict("records")}
    quarters: dict[str, list[dict]] = {}
    for sym, period, revenue, ebitda, pat in db.execute(
            f"SELECT symbol, period, revenue, ebitda, pat FROM stock_fundamentals WHERE period_type = 'Q' AND is_consolidated AND symbol IN ({m}) ORDER BY symbol, period DESC", stocks).fetchall():
        quarters.setdefault(sym, []).append({"period": period, "revenue": revenue, "ebitda": ebitda, "pat": pat})
    rows = []
    for sym in stocks:
        snap = snapshots.get(sym)
        q = latest_quarter(quarters.get(sym, []))
        if snap is None and q is None:
            continue
        snap = {k: (None if v != v else v) for k, v in (snap or {}).items()}
        rows.append({
            "symbol": sym, "as_of": str(snap["as_of"].date()) if snap.get("as_of") is not None and hasattr(snap["as_of"], "date") else None,
            **{k: snap.get(k) for k in ("pe", "forward_pe", "pb", "roe_pct", "debt_to_equity", "profit_margin_pct", "dividend_yield_pct", "market_cap", "sector")},
            "quarter": None if q is None else {**q, "period": str(q["period"])},
        })
    return {"rows": rows}
