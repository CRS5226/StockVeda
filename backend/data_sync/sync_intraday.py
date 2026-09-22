"""
On-demand intraday OHLCV fetch via yfinance — mirrors backend/routes/fno.py's
job-tracking dict pattern (background-task driven, polled via a fetch-job
endpoint), because intraday data cannot be bulk-backfilled the way EOD
bhavcopy is: yfinance intraday lookback is capped (~7 days for 1m bars, longer
for coarser intervals), and fetches are per-symbol, not exchange-wide.
"""

from datetime import datetime, timedelta

import pandas as pd
import yfinance as yf

from backend.data_sync.base import upsert_df
from backend.db.connection import get_db

VALID_INTERVALS = ("1m", "5m", "15m", "30m", "60m")

# yfinance's own lookback ceilings per interval (approximate, enforced client-side
# so we fail fast / clamp with a clear message instead of yfinance silently truncating).
MAX_LOOKBACK_DAYS = {"1m": 7, "5m": 60, "15m": 60, "30m": 60, "60m": 730}

intraday_fetch_jobs: dict = {}


def fetch_intraday_symbol(symbol: str, interval: str, days: int) -> pd.DataFrame:
    """Fetch up to `days` of intraday bars for one symbol at the given interval.
    Returns a DataFrame shaped [datetime, symbol, interval, open, high, low, close, volume]."""
    sym = symbol.strip().upper()
    max_days = MAX_LOOKBACK_DAYS.get(interval, 60)
    days = min(days, max_days)
    period = f"{days}d"
    t = yf.Ticker(f"{sym}.NS")
    hist = t.history(period=period, interval=interval)
    if hist.empty:
        return pd.DataFrame()
    hist = hist.reset_index()
    dt_col = "Datetime" if "Datetime" in hist.columns else "Date"
    hist["datetime"] = pd.to_datetime(hist[dt_col]).dt.tz_localize(None)
    hist["symbol"] = sym
    hist["interval"] = interval
    hist = hist.rename(columns={"Open": "open", "High": "high", "Low": "low", "Close": "close", "Volume": "volume"})
    return hist[["datetime", "symbol", "interval", "open", "high", "low", "close", "volume"]].dropna(subset=["close"])


def _run_intraday_fetch_job(job_id: str, symbol: str, interval: str, days: int) -> None:
    intraday_fetch_jobs[job_id]["status"] = "running"
    try:
        df = fetch_intraday_symbol(symbol, interval, days)
        if df.empty:
            intraday_fetch_jobs[job_id].update({"status": "empty", "inserted": 0, "done": 1, "total": 1})
            return
        count = upsert_df(df, "stock_intraday_ohlcv")
        intraday_fetch_jobs[job_id].update({"status": "done", "inserted": count, "done": 1, "total": 1})
    except Exception as e:
        intraday_fetch_jobs[job_id].update({"status": "error", "error": str(e), "done": 1, "total": 1})


def _existing_coverage(symbol: str, interval: str) -> tuple[datetime | None, datetime | None]:
    db = get_db()
    row = db.execute(
        "SELECT MIN(datetime), MAX(datetime) FROM stock_intraday_ohlcv WHERE symbol = ? AND interval = ?",
        [symbol, interval],
    ).fetchone()
    if not row or row[0] is None:
        return None, None
    earliest = row[0] if isinstance(row[0], datetime) else datetime.fromisoformat(str(row[0]))
    latest = row[1] if isinstance(row[1], datetime) else datetime.fromisoformat(str(row[1]))
    return earliest, latest


def sync_intraday_batch(symbols: list[str], interval: str, days: int, job_id: str) -> None:
    """Multi-symbol incremental intraday sync — mirrors screener_universe.smart_sync's
    per-symbol gap-fetch pattern (check what's already covered, fetch only what's
    missing), unlike fetch_intraday_symbol's single-shot full-window refetch. One
    job_id tracks progress across all symbols via intraday_fetch_jobs (same dict
    the single-symbol fetch job uses, since both are polled the same way)."""
    max_days = MAX_LOOKBACK_DAYS.get(interval, 60)
    days = min(days, max_days)
    required_from = datetime.now() - timedelta(days=days)

    intraday_fetch_jobs[job_id] = {
        "done": 0, "total": len(symbols), "inserted": 0,
        "status": "running", "current": "", "interval": interval,
    }

    for sym in symbols:
        s = sym.strip().upper()
        intraday_fetch_jobs[job_id]["current"] = s
        try:
            earliest, latest = _existing_coverage(s, interval)
            if earliest is not None and earliest <= required_from and latest is not None and \
                    latest >= datetime.now() - timedelta(minutes=30):
                # Already covers the requested window — skip re-fetching this symbol.
                pass
            else:
                df = fetch_intraday_symbol(s, interval, days)
                if not df.empty:
                    count = upsert_df(df, "stock_intraday_ohlcv")
                    intraday_fetch_jobs[job_id]["inserted"] += count
        except Exception:
            pass  # best-effort per symbol — one bad symbol shouldn't abort the batch
        intraday_fetch_jobs[job_id]["done"] += 1

    intraday_fetch_jobs[job_id]["status"] = "done"
