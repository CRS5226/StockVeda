from datetime import date, timedelta
from typing import Optional
import httpx
import pandas as pd
from backend.db.connection import get_db
from backend.config import settings

NSE_HEADERS = {
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    "Referer": "https://www.nseindia.com/",
    "Connection": "keep-alive",
}

NSEARCHIVES_BASE = "https://nsearchives.nseindia.com"


def get_client(timeout: int = None) -> httpx.Client:
    t = timeout or settings.sync_timeout_seconds
    return httpx.Client(headers=NSE_HEADERS, timeout=t, follow_redirects=True)


def last_business_day(d: date) -> date:
    while d.weekday() >= 5:
        d -= timedelta(days=1)
    return d


def business_days_between(start: date, end: date) -> list[date]:
    days = []
    d = start
    while d <= end:
        if d.weekday() < 5:
            days.append(d)
        d += timedelta(days=1)
    return days


def last_synced_date(source_id: str) -> Optional[date]:
    db = get_db()
    row = db.execute(
        "SELECT last_date_fetched FROM sync_log WHERE source = ?", [source_id]
    ).fetchone()
    return row[0] if row and row[0] else None


def log_sync(source_id: str, status: str, records_added: int, last_date: Optional[date], error: str = None):
    db = get_db()
    db.execute("""
        INSERT OR REPLACE INTO sync_log
            (source, last_synced_at, last_date_fetched, status, records_added, error_message)
        VALUES (?, now(), ?, ?, ?, ?)
    """, [source_id, last_date, status, records_added, error])


def upsert_df(df: pd.DataFrame, table_name: str) -> int:
    if df.empty:
        return 0
    db = get_db()
    db.register("_upsert_tmp", df)
    db.execute(f"INSERT OR REPLACE INTO {table_name} SELECT * FROM _upsert_tmp")
    db.unregister("_upsert_tmp")
    return len(df)
