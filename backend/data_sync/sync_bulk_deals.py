"""
NSE bulk and block deals, fetched one trading day at a time.

Source: nseindia.com/api/historicalOR/bulk-block-short-deals (session-gated).
NSE returns only the first day of a multi-day range, so each call asks for a
single day (from == to). That also lets us backfill history. Short deals are
skipped: that option type answers HTTP 500.
Table: bulk_deals
"""

import time
from datetime import date, timedelta

import pandas as pd

from backend.data_sync.base import business_days_between, last_business_day, last_synced_date, log_sync
from backend.data_sync.nse_session import nse_get
from backend.db.connection import get_db

SOURCE_ID = "nse_bulk_deals"
API_URL = "https://www.nseindia.com/api/historicalOR/bulk-block-short-deals"
DEAL_TYPES = {"bulk_deals": "bulk", "block_deals": "block"}
DEFAULT_BACKFILL_DAYS = 90
PAUSE_SECONDS = 0.5  # courtesy delay between NSE calls

COLUMNS = ["date", "symbol", "scrip_name", "client_name", "buy_sell", "quantity", "price", "deal_type"]


def parse_deals(rows: list[dict], deal_type: str) -> pd.DataFrame:
    """Turn NSE deal rows into bulk_deals rows; rows that can't be read are skipped."""
    out = []
    for r in rows:
        try:
            out.append({
                "date": pd.to_datetime(r["BD_DT_DATE"], format="%d-%b-%Y").date(),
                "symbol": str(r["BD_SYMBOL"]).strip().upper(),
                "scrip_name": str(r.get("BD_SCRIP_NAME") or "").strip(),
                "client_name": str(r.get("BD_CLIENT_NAME") or "").strip(),
                "buy_sell": str(r.get("BD_BUY_SELL") or "").strip().upper(),
                "quantity": int(r["BD_QTY_TRD"]),
                "price": float(r["BD_TP_WATP"]),
                "deal_type": deal_type,
            })
        except (KeyError, TypeError, ValueError):
            continue
    return pd.DataFrame(out, columns=COLUMNS)


def _fetch_day(day: date, option_type: str) -> list[dict]:
    """One NSE call for one day. Raises on an HTTP or JSON problem so the day is retried later."""
    stamp = day.strftime("%d-%m-%Y")
    resp = nse_get(API_URL, params={"optionType": option_type, "from": stamp, "to": stamp})
    resp.raise_for_status()
    return resp.json().get("data") or []


def store_day(day: date, df: pd.DataFrame) -> int:
    """Replace one day's deals (delete then insert), so re-running a day never duplicates rows."""
    db = get_db()
    db.execute("DELETE FROM bulk_deals WHERE date = ?", [day])
    if df.empty:
        return 0
    db.register("_deals_tmp", df)
    db.execute(f"INSERT INTO bulk_deals ({', '.join(COLUMNS)}) SELECT {', '.join(COLUMNS)} FROM _deals_tmp")
    db.unregister("_deals_tmp")
    return len(df)


def _days_to_fetch(backfill_days: int) -> list[date]:
    today = date.today()
    last = last_synced_date(SOURCE_ID)
    start = last + timedelta(days=1) if last else today - timedelta(days=backfill_days)
    return business_days_between(start, last_business_day(today))


def run(backfill_days: int = DEFAULT_BACKFILL_DAYS) -> int:
    """Fetch deals for every trading day since the last run. Returns the rows stored."""
    days = _days_to_fetch(backfill_days)
    if not days:
        print(f"[{SOURCE_ID}] already up to date")
        return 0

    print(f"[{SOURCE_ID}] fetching {len(days)} days of bulk/block deals")
    total, last_ok, failed = 0, None, []
    for day in days:
        frames = []
        try:
            for option_type, deal_type in DEAL_TYPES.items():
                frames.append(parse_deals(_fetch_day(day, option_type), deal_type))
                time.sleep(PAUSE_SECONDS)
        except Exception as e:
            failed.append(day)
            print(f"[{SOURCE_ID}] {day}: FAILED — {e}")
            continue
        df = pd.concat(frames, ignore_index=True)
        total += store_day(day, df)
        # The bookmark only advances up to the first failed day, so it is retried next run.
        if not failed:
            last_ok = day

    if last_ok is None and failed:
        log_sync(SOURCE_ID, "failed", 0, last_synced_date(SOURCE_ID), f"failed days: {', '.join(map(str, failed))}")
        return 0
    status = "partial" if failed else "success"
    error = f"failed days: {', '.join(map(str, failed))}" if failed else None
    log_sync(SOURCE_ID, status, total, last_ok, error)
    print(f"[{SOURCE_ID}] stored {total} rows")
    return total


if __name__ == "__main__":
    run()
