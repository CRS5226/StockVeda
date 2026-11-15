"""
Named shareholders (promoters and public holders above 1%) from NSE shareholding-pattern XBRL files.

Source: nseindia.com/api/corporate-share-holdings-master (latest filing per company, with the
XBRL file URL), then one static XBRL download per company from nsearchives (no session needed).
A company is fetched again only when it files a newer pattern (about once a quarter).
Table: shareholders
"""

import logging
import time
from datetime import date, datetime

import httpx
import pandas as pd

from backend.core.ownership_graph import refresh_holder_matches
from backend.core.shareholders import SHAREHOLDER_COLUMNS, parse_shareholders
from backend.data_sync.base import log_sync
from backend.data_sync.nse_session import nse_get
from backend.db.connection import get_db

logger = logging.getLogger(__name__)

SOURCE_ID = "nse_shareholders"
MASTER_URL = "https://www.nseindia.com/api/corporate-share-holdings-master"
HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}
MAX_PER_RUN = 400        # filings per run; the rest follow on the next runs
PAUSE_SECONDS = 0.3
EMPTY_PREFIX = "shareholders:"  # sync_log key marking a filing that holds no named holders, so it is not retried


def parse_period(text: str | None) -> date | None:
    """'30-SEP-2026' -> date(2026, 9, 30); None for anything else."""
    try:
        return datetime.strptime((text or "").strip().title(), "%d-%b-%Y").date()
    except ValueError:
        return None


def filings_from_master(records: list[dict]) -> list[dict]:
    """The latest filing per symbol that has an XBRL file: symbol, period, url."""
    filings = {}
    for rec in records:
        symbol = (rec.get("symbol") or "").strip().upper()
        period, url = parse_period(rec.get("date")), rec.get("xbrl")
        if symbol and period and url:
            filings[symbol] = {"symbol": symbol, "period": period, "url": url}
    return list(filings.values())


def _already_have() -> set[tuple[str, date]]:
    """(symbol, period) pairs stored, plus filings known to be empty."""
    db = get_db()
    have = set(db.execute("SELECT DISTINCT symbol, period FROM shareholders").fetchall())
    empties = db.execute(
        "SELECT source, last_date_fetched FROM sync_log WHERE source LIKE ?", [EMPTY_PREFIX + "%"]
    ).fetchall()
    have |= {(src[len(EMPTY_PREFIX):], d) for src, d in empties if d}
    return have


def _traded_value() -> dict[str, float]:
    db = get_db()
    rows = db.execute("""
        SELECT symbol, SUM(close * volume) FROM stock_ohlcv
        WHERE date >= (SELECT MAX(date) FROM stock_ohlcv) - INTERVAL 30 DAY
        GROUP BY symbol
    """).fetchall()
    return {r[0]: r[1] or 0.0 for r in rows}


def filings_to_fetch(filings: list[dict], limit: int) -> list[dict]:
    """New filings only, the most traded companies first."""
    have = _already_have()
    value = _traded_value()
    todo = [f for f in filings if (f["symbol"], f["period"]) not in have]
    todo.sort(key=lambda f: -value.get(f["symbol"], 0.0))
    return todo[:limit]


def store_filing(symbol: str, period: date, holders: list[dict]) -> int:
    """Replace the holders stored for one company and period."""
    db = get_db()
    db.execute("DELETE FROM shareholders WHERE symbol = ? AND period = ?", [symbol, period])
    if not holders:
        return 0
    df = pd.DataFrame([{"symbol": symbol, "period": period, **h} for h in holders])[SHAREHOLDER_COLUMNS]
    db.register("_holders_tmp", df)
    db.execute(f"INSERT INTO shareholders ({', '.join(SHAREHOLDER_COLUMNS)}) SELECT {', '.join(SHAREHOLDER_COLUMNS)} FROM _holders_tmp")
    db.unregister("_holders_tmp")
    return len(df)


def run(limit: int = MAX_PER_RUN) -> int:
    """Fetch up to `limit` new filings, one at a time. Returns the holder rows stored."""
    resp = nse_get(MASTER_URL, params={"index": "equities"})
    resp.raise_for_status()
    todo = filings_to_fetch(filings_from_master(resp.json()), limit)
    if not todo:
        print(f"[{SOURCE_ID}] all filings are up to date")
        return 0

    print(f"[{SOURCE_ID}] fetching {len(todo)} filings")
    total, failed = 0, []
    with httpx.Client(headers=HEADERS, timeout=30, follow_redirects=True) as client:
        for f in todo:
            try:
                r = client.get(f["url"])
                r.raise_for_status()
                holders = parse_shareholders(r.text)
            except Exception as e:
                # Nothing stored or marked, so it is retried next run.
                failed.append(f["symbol"])
                logger.warning("Shareholders fetch failed for %s: %s", f["symbol"], e)
                time.sleep(PAUSE_SECONDS)
                continue
            total += store_filing(f["symbol"], f["period"], holders)
            if not holders:
                log_sync(EMPTY_PREFIX + f["symbol"], "empty", 0, f["period"])
            time.sleep(PAUSE_SECONDS)

    refresh_holder_matches()  # new holder names may name listed companies
    status = "partial" if failed else "success"
    log_sync(SOURCE_ID, status, total, date.today(), f"failed: {', '.join(failed[:20])}" if failed else None)
    print(f"[{SOURCE_ID}] stored {total} holder rows, {len(failed)} failed")
    return total


if __name__ == "__main__":
    run()
