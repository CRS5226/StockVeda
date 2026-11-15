"""
NSE equity bhavcopy + delivery data.
Source: nsearchives.nseindia.com/archives/equities/bhavcopy/pr/PR{DDMMYY}.zip
One ZIP per day contains: pd (price+symbol), mcap, etf, sme, corpbond files.
Tables: stock_ohlcv, stock_delivery
"""

import io
import time
import zipfile
from datetime import date, timedelta
import pandas as pd
from backend.config import settings
from backend.data_sync.base import (
    NSEARCHIVES_BASE, get_client, upsert_df, insert_missing_df, log_sync,
    last_synced_date, business_days_between, last_business_day
)
from backend.db.connection import get_db

SOURCE_ID = "nse_bhavcopy_equity"
BHAV_URL = NSEARCHIVES_BASE + "/archives/equities/bhavcopy/pr/PR{ddmmyy}.zip"
MTO_URL  = NSEARCHIVES_BASE + "/archives/equities/mto/MTO_{ddmmyyyy}.DAT"
HISTORY_SOURCE = "nse_bhavcopy_history"   # sync_log marker: every business day from here on is stored
MIN_LOOKBACK_DAYS, MAX_LOOKBACK_DAYS = 30, 1500
CHUNK_DAYS = 20                 # days fetched, then stored and bookmarked together, so an interrupted run keeps its progress
PAUSE_SECONDS = 0.3             # between days; each day is two downloads
HISTORY_TOLERANCE_DAYS = 7      # a stored history starting within this many days of the window counts as covering it
MAX_MISSING_STREAK = 6          # NSE answers 403/404 for a holiday, but also when it blocks us; this many missing business days in a row is a block
FULL_MARKET_MIN_SYMBOLS = 1000  # a day with this many symbols came from the full bhavcopy, not a handful of yfinance stocks


def _fetch_bhavcopy(client, d: date):
    """Download PR zip and extract equity OHLCV from pd{ddmmyy}.csv."""
    url = BHAV_URL.format(ddmmyy=d.strftime("%d%m%y"))   # 2-digit year
    resp = client.get(url)
    if resp.status_code in (404, 403):
        return None
    resp.raise_for_status()

    with zipfile.ZipFile(io.BytesIO(resp.content)) as z:
        # ZIP uses 2-digit year; files inside use 4-digit year
        pd_name = f"pd{d.strftime('%d%m%Y')}.csv"
        if pd_name not in z.namelist():
            return None
        df = pd.read_csv(z.open(pd_name))

    df.columns = [c.strip() for c in df.columns]

    # Filter equity series only
    df = df[df["SERIES"].str.strip() == "EQ"].copy()

    df = df.rename(columns={
        "SYMBOL":      "symbol",
        "OPEN_PRICE":  "open",
        "HIGH_PRICE":  "high",
        "LOW_PRICE":   "low",
        "CLOSE_PRICE": "close",
        "NET_TRDQTY":  "volume",
    })
    df["date"] = d
    df["symbol"] = df["symbol"].str.strip()
    # Older files leave some prices blank (a lone space), which would make the whole column text and fail to insert.
    for col in ("open", "high", "low", "close", "volume"):
        df[col] = pd.to_numeric(df[col], errors="coerce")

    return df[["date", "symbol", "open", "high", "low", "close", "volume"]].dropna(subset=["symbol", "close"])


def _fetch_delivery(client, d: date):
    """Download MTO delivery file — pipe-separated."""
    url = MTO_URL.format(ddmmyyyy=d.strftime("%d%m%Y"))   # 4-digit year
    resp = client.get(url)
    if resp.status_code in (404, 403):
        return None
    resp.raise_for_status()

    rows = []
    for line in resp.text.strip().splitlines():
        parts = line.split(",")
        if len(parts) < 7 or parts[0].strip() != "20":
            continue
        try:
            rows.append({
                "date":         d,
                "symbol":       parts[2].strip(),
                "delivery_qty": int(float(parts[5].strip())),
                "delivery_pct": float(parts[6].strip()),
            })
        except (ValueError, IndexError):
            continue

    return pd.DataFrame(rows) if rows else None


def lookback_days() -> int:
    """How many days back a first sync goes, from the BHAVCOPY_LOOKBACK_DAYS setting, kept within sane limits."""
    return min(max(settings.bhavcopy_lookback_days, MIN_LOOKBACK_DAYS), MAX_LOOKBACK_DAYS)


def window_start(today: date, lookback: int) -> date:
    """The first business day on or after `lookback` days before today."""
    return business_days_between(today - timedelta(days=lookback), today)[0]


def history_gap_days(today: date, lookback: int, marker: date | None) -> list[date]:
    """Business days between the start of the lookback window and `marker`, oldest first.

    Empty when there is no marker, or when the stored history already starts within a week of the window.
    """
    if marker is None:
        return []
    start = window_start(today, lookback)
    if (marker - start).days <= HISTORY_TOLERANCE_DAYS:
        return []
    return business_days_between(start, marker - timedelta(days=1))


def _chunks(days: list[date], size: int | None = None) -> list[list[date]]:
    size = size or CHUNK_DAYS
    return [days[i:i + size] for i in range(0, len(days), size)]


def _fetch_days(client, days: list[date]) -> tuple[list[pd.DataFrame], list[pd.DataFrame], list[date]]:
    """Fetch prices and delivery for each day, in the order given. A day that raises is reported, not skipped silently."""
    bhav_rows, deliv_rows, failed = [], [], []
    missing_streak = 0
    for d in days:
        try:
            bhav = _fetch_bhavcopy(client, d)
            missing_streak = 0 if bhav is not None else missing_streak + 1
            if missing_streak >= MAX_MISSING_STREAK:
                # Real holidays never run this long, so treat it as a block or an outage and retry the day later.
                raise RuntimeError(f"no bhavcopy for {missing_streak} business days in a row, NSE may be blocking requests")
            if bhav is not None:
                bhav_rows.append(bhav)
            deliv = _fetch_delivery(client, d)
            if deliv is not None:
                deliv_rows.append(deliv)
        except Exception as e:
            failed.append(d)
            print(f"[{SOURCE_ID}] WARN {d}: {e}")
        time.sleep(PAUSE_SECONDS)
    return bhav_rows, deliv_rows, failed


def _store(bhav_rows, deliv_rows, only_missing: bool) -> int:
    """Write fetched days. A backfill only fills gaps; a forward sync replaces what it re-fetches."""
    write = insert_missing_df if only_missing else upsert_df
    count_bhav = write(pd.concat(bhav_rows, ignore_index=True), "stock_ohlcv") if bhav_rows else 0
    count_deliv = write(pd.concat(deliv_rows, ignore_index=True), "stock_delivery") if deliv_rows else 0
    return count_bhav + count_deliv


def _first_full_market_day() -> date | None:
    """The oldest day that holds a full bhavcopy. yfinance-cached stocks reach further back, so the table's
    oldest date alone would hide that most stocks only have recent history."""
    rows = get_db().execute(
        "SELECT MIN(date) FROM (SELECT date FROM stock_ohlcv GROUP BY date HAVING COUNT(*) >= ?)", [FULL_MARKET_MIN_SYMBOLS]
    ).fetchall()
    return rows[0][0] if rows else None


def _sync_forward(today: date, lookback: int) -> int:
    """Fetch every business day since the last run. The bookmark stops before the first failed day, so it is retried."""
    last = last_synced_date(SOURCE_ID)
    start = last + timedelta(days=1) if last else window_start(today, lookback)
    days = business_days_between(start, last_business_day(today))
    if not days:
        print(f"[{SOURCE_ID}] already up to date")
        return 0

    print(f"[{SOURCE_ID}] fetching {len(days)} days: {days[0]} → {days[-1]}")
    total, first_failed, bookmark = 0, None, last
    with get_client(timeout=60) as client:
        for chunk in _chunks(days):
            bhav_rows, deliv_rows, failed = _fetch_days(client, chunk)
            try:
                total += _store(bhav_rows, deliv_rows, only_missing=False)
            except Exception as e:
                log_sync(SOURCE_ID, "failed", total, bookmark, f"storing {chunk[0]}..{chunk[-1]}: {e}")
                print(f"[{SOURCE_ID}] FAILED storing {chunk[0]}..{chunk[-1]}: {e}")
                return total
            if first_failed is None and failed:
                first_failed = failed[0]
            # Days before the first failure are complete; the bookmark never moves past it.
            complete = [d for d in chunk if first_failed is None or d < first_failed]
            if complete:
                bookmark = complete[-1]
            if bookmark:
                log_sync(SOURCE_ID, "partial" if first_failed else "success", total, bookmark)
    if last is None:
        # A first sync covered the whole window; failed days are retried through the bookmark above.
        log_sync(HISTORY_SOURCE, "success", 0, days[0])
    print(f"[{SOURCE_ID}] stored {total} rows, up to {bookmark}")
    return total


def _backfill_history(today: date, lookback: int) -> int:
    """Fill in older days an earlier, shorter sync never fetched, newest first so what is stored stays
    contiguous. Existing rows are never overwritten. The marker stops at the first failed day."""
    marker = last_synced_date(HISTORY_SOURCE) or _first_full_market_day()
    gap = history_gap_days(today, lookback, marker)
    if not gap:
        return 0

    print(f"[{HISTORY_SOURCE}] backfilling {len(gap)} older days: {gap[0]} → {gap[-1]}")
    total = 0
    with get_client(timeout=60) as client:
        for chunk in _chunks(gap[::-1]):                   # newest first
            bhav_rows, deliv_rows, failed = _fetch_days(client, chunk)
            try:
                total += _store(bhav_rows, deliv_rows, only_missing=True)
            except Exception as e:
                # The marker stays where the last stored chunk left it, so the next run retries this chunk.
                log_sync(HISTORY_SOURCE, "failed", total, marker, f"storing {chunk[-1]}..{chunk[0]}: {e}")
                print(f"[{HISTORY_SOURCE}] FAILED storing {chunk[-1]}..{chunk[0]}: {e}")
                return total
            if failed:
                # Everything newer than the failed day is stored; the next run resumes from the day after it.
                resume = max(failed) + timedelta(days=1)
                marker = business_days_between(resume, gap[-1] + timedelta(days=1))[0]
                log_sync(HISTORY_SOURCE, "partial", total, marker)
                print(f"[{HISTORY_SOURCE}] stopped at {max(failed)}; will retry next run")
                return total
            marker = chunk[-1]                              # the oldest day of the chunk
            log_sync(HISTORY_SOURCE, "success", total, marker)
    print(f"[{HISTORY_SOURCE}] stored {total} rows back to {marker}")
    return total


def run() -> int:
    """Fetch new days, then backfill older history if the database does not reach back far enough.
    Returns the rows stored."""
    today, lookback = date.today(), lookback_days()
    stored = _sync_forward(today, lookback)
    stored += _backfill_history(today, lookback)
    return stored


if __name__ == "__main__":
    run()
