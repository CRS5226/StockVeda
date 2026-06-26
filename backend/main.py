from fastapi import FastAPI, BackgroundTasks, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from backend.config import settings
from backend.routes import stock, screener, macro, backtest, analysis

app = FastAPI(title="StockVeda API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        f"http://localhost:{settings.frontend_port}",
        "http://localhost:5173",
        "http://localhost:4173",
        "https://harshitkotak.duckdns.org",
    ],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(stock.router, prefix="/api")
app.include_router(screener.router, prefix="/api")
app.include_router(macro.router, prefix="/api")
app.include_router(backtest.router, prefix="/api")
app.include_router(analysis.router)


@app.get("/api/health")
def health():
    from backend.db.connection import get_db
    db = get_db()
    tables = db.execute("SHOW TABLES").fetchall()
    return {"status": "ok", "tables": len(tables)}


@app.get("/api/sync/status")
def sync_status():
    from backend.db.connection import get_db, df_to_records
    db = get_db()
    df = db.execute("SELECT * FROM sync_log ORDER BY last_synced_at DESC").df()
    return df_to_records(df)


_SYNC_MODULES = {
    "symbols":           "backend.data_sync.seed_symbols",
    "bhavcopy":          "backend.data_sync.sync_bhavcopy",
    "delivery":          "backend.data_sync.sync_bhavcopy",
    "indices":           "backend.data_sync.sync_indices",
    "fno_oi":            "backend.data_sync.sync_fno",
    "fno_participant":   "backend.data_sync.sync_fno_participant",
    "fno_bhavcopy":      "backend.data_sync.sync_fno_bhavcopy",
    "fii_dii":           "backend.data_sync.sync_fii_dii",
    "corporate_actions": "backend.data_sync.sync_corporate_actions",
    "shareholding":      "backend.data_sync.sync_shareholding",
    "fundamentals":      "backend.data_sync.sync_fundamentals",
    "currency":          "backend.data_sync.sync_currency",
    "amfi":              "backend.data_sync.sync_amfi",
    "global_macro":      "backend.data_sync.sync_global",
    "india_macro":       "backend.data_sync.sync_macro_india",
    "rbi":               "backend.data_sync.sync_rbi",
    "bse_market":        "backend.data_sync.sync_bse_market",
}


def _run_sync(source: str):
    import importlib, traceback
    mod_path = _SYNC_MODULES.get(source)
    if not mod_path:
        return
    try:
        mod = importlib.import_module(mod_path)
        mod.run()
    except Exception:
        traceback.print_exc()


@app.post("/api/sync/trigger/{source}")
def trigger_sync(source: str, background_tasks: BackgroundTasks):
    if source not in _SYNC_MODULES:
        raise HTTPException(400, f"Unknown source. Valid: {sorted(_SYNC_MODULES)}")
    background_tasks.add_task(_run_sync, source)
    return {"status": "queued", "source": source}
