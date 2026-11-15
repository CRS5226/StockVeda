"""
Company events and board meetings, market-wide, from NSE (session-gated, via nse_get).

Announcements: /api/corporate-announcements?index=equities&from_date=&to_date= returns every
company's announcements for the range (about 1,000 a day), so a week is one call. Only the
categories in core.company_events.EVENT_KINDS are kept.
Board meetings: /api/corporate-board-meetings?index=equities&from_date=&to_date= (all companies).
Tables: company_events, board_meetings
"""

import time
from datetime import date, timedelta

import pandas as pd

from backend.core.company_events import EVENT_COLUMNS, MEETING_COLUMNS, parse_events, parse_meetings
from backend.data_sync.base import last_synced_date, log_sync
from backend.data_sync.nse_session import nse_get
from backend.db.connection import get_db

EVENTS_SOURCE = "nse_company_events"
MEETINGS_SOURCE = "nse_board_meetings"
ANNOUNCEMENTS_URL = "https://www.nseindia.com/api/corporate-announcements"
MEETINGS_URL = "https://www.nseindia.com/api/corporate-board-meetings"
DEFAULT_BACKFILL_DAYS = 90
CHUNK_DAYS = 7              # calendar days per announcements call
MEETING_CHUNK_DAYS = 14
UPCOMING_DAYS = 60          # how far ahead board meetings are fetched each run
PAUSE_SECONDS = 1.0         # between NSE calls (each returns a large response)


def date_chunks(start: date, end: date, size: int) -> list[tuple[date, date]]:
    """Consecutive (from, to) ranges of at most `size` days covering start..end."""
    chunks, cursor = [], start
    while cursor <= end:
        chunk_end = min(cursor + timedelta(days=size - 1), end)
        chunks.append((cursor, chunk_end))
        cursor = chunk_end + timedelta(days=1)
    return chunks


def _fetch(url: str, start: date, end: date) -> list[dict]:
    """One NSE call for a date range. Raises on an HTTP or JSON problem so the range is retried later."""
    resp = nse_get(url, params={"index": "equities", "from_date": start.strftime("%d-%m-%Y"), "to_date": end.strftime("%d-%m-%Y")})
    resp.raise_for_status()
    data = resp.json()
    if not isinstance(data, list):
        raise ValueError("unexpected response shape")
    return data


def _replace(table: str, date_expr: str, start: date, end: date, df: pd.DataFrame, columns: list[str]) -> int:
    """Replace the rows whose date falls in start..end, so re-running a range never duplicates rows."""
    db = get_db()
    db.execute(f"DELETE FROM {table} WHERE CAST({date_expr} AS DATE) BETWEEN ? AND ?", [start, end])
    if df.empty:
        return 0
    db.register("_events_tmp", df)
    db.execute(f"INSERT INTO {table} ({', '.join(columns)}) SELECT {', '.join(columns)} FROM _events_tmp")
    db.unregister("_events_tmp")
    return len(df)


def _sync_range(source: str, start: date, end: date, size: int, url: str, parse, table: str, date_expr: str, columns: list[str]) -> tuple[int, date | None, list[date]]:
    """Fetch and store start..end in chunks. Returns rows stored, the last date fetched in a row, and failed chunk starts."""
    total, last_ok, failed = 0, None, []
    for chunk_start, chunk_end in date_chunks(start, end, size):
        try:
            df = parse(_fetch(url, chunk_start, chunk_end))
        except Exception as e:
            failed.append(chunk_start)
            print(f"[{source}] {chunk_start}..{chunk_end}: FAILED — {e}")
            time.sleep(PAUSE_SECONDS)
            continue
        total += _replace(table, date_expr, chunk_start, chunk_end, df, columns)
        # The bookmark only advances up to the first failed chunk, so it is retried next run.
        if not failed:
            last_ok = chunk_end
        time.sleep(PAUSE_SECONDS)
    return total, last_ok, failed


def run(backfill_days: int = DEFAULT_BACKFILL_DAYS) -> int:
    """Fetch announcements and board meetings since the last run. Returns the rows stored."""
    today = date.today()
    stored = 0

    # Announcements: up to today.
    last = last_synced_date(EVENTS_SOURCE)
    start = last + timedelta(days=1) if last else today - timedelta(days=backfill_days)
    if start <= today:
        print(f"[{EVENTS_SOURCE}] fetching {start}..{today}")
        n, last_ok, failed = _sync_range(EVENTS_SOURCE, start, today, CHUNK_DAYS, ANNOUNCEMENTS_URL,
                                         parse_events, "company_events", "event_time", EVENT_COLUMNS)
        stored += n
        if last_ok:
            # Today is not final until the day ends, so the bookmark stays one day behind and it is refetched.
            log_sync(EVENTS_SOURCE, "partial" if failed else "success", n, min(last_ok, today - timedelta(days=1)))
        elif failed:
            log_sync(EVENTS_SOURCE, "failed", 0, last, f"failed from {failed[0]}")

    # Board meetings: past ones once, then upcoming ones replaced on every run.
    last = last_synced_date(MEETINGS_SOURCE)
    start = last + timedelta(days=1) if last else today - timedelta(days=backfill_days)
    if start < today:
        n, last_ok, failed = _sync_range(MEETINGS_SOURCE, start, today - timedelta(days=1), MEETING_CHUNK_DAYS, MEETINGS_URL,
                                         parse_meetings, "board_meetings", "meeting_date", MEETING_COLUMNS)
        stored += n
        if last_ok:
            log_sync(MEETINGS_SOURCE, "partial" if failed else "success", n, last_ok)
    n, _, failed = _sync_range(MEETINGS_SOURCE, today, today + timedelta(days=UPCOMING_DAYS), UPCOMING_DAYS + 1, MEETINGS_URL,
                               parse_meetings, "board_meetings", "meeting_date", MEETING_COLUMNS)
    stored += n
    print(f"[{EVENTS_SOURCE}] stored {stored} rows")
    return stored


if __name__ == "__main__":
    run()
