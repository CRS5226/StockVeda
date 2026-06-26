"""
NSE FnO Participant-wise Open Interest — daily backfill.
Source: archives.nseindia.com/content/nsccl/fao_participant_oi_DDMMYYYY.csv
Stores FII + DII index futures long/short/net into the existing fno_oi table
(instrument = 'FUTURE_INDEX').

Net position: positive = net long (bullish), negative = net short (bearish).
"""

import io
from datetime import date, timedelta

import pandas as pd

from backend.data_sync.base import business_days_between, get_client, upsert_df, log_sync

SOURCE_ID = "nse_fno_participant_oi"
BASE_URL  = "https://archives.nseindia.com/content/nsccl/fao_participant_oi_{}.csv"


def _fetch_one(client, d: date) -> list[dict]:
    url = BASE_URL.format(d.strftime("%d%m%Y"))
    try:
        resp = client.get(url, timeout=10)
        if resp.status_code != 200:
            return []
        df = pd.read_csv(io.StringIO(resp.text), skiprows=1, header=0)
        df.columns = [c.strip() for c in df.columns]

        fi_long_col  = next((c for c in df.columns if "Future Index Long"  in c), None)
        fi_short_col = next((c for c in df.columns if "Future Index Short" in c), None)
        if fi_long_col is None or fi_short_col is None:
            return []

        rows = []
        for _, r in df.iterrows():
            cat = str(r.get("Client Type", "")).strip()
            if cat not in ("FII", "DII"):
                continue
            try:
                long_v  = int(str(r[fi_long_col]).replace(",", "").strip()  or 0)
                short_v = int(str(r[fi_short_col]).replace(",", "").strip() or 0)
            except (ValueError, TypeError):
                continue
            if long_v == 0 and short_v == 0:
                continue
            rows.append({
                "date":             d,
                "participant_type": cat,
                "instrument":       "FUTURE_INDEX",
                "long_oi":          long_v,
                "short_oi":         short_v,
                "net_oi":           long_v - short_v,
            })
        return rows
    except Exception as e:
        print(f"  [{d}] error: {e}")
        return []


def run(days_back: int = 252):
    from backend.db.connection import get_db
    db = get_db()

    today = date.today()
    start = today - timedelta(days=int(days_back * 1.5))

    existing = set(
        f"{str(r[0])[:10]}_{r[1]}"
        for r in db.execute(
            "SELECT date, participant_type FROM fno_oi WHERE instrument = 'FUTURE_INDEX'"
        ).fetchall()
    )

    client = get_client(timeout=10)
    days   = business_days_between(start, today - timedelta(days=1))
    print(f"[{SOURCE_ID}] candidate days: {len(days)} | existing rows: {len(existing)}")

    all_rows, ok, skip, fail = [], 0, 0, 0
    for d in days:
        key_fii = f"{d}_FII"
        if key_fii in existing:
            skip += 1
            continue
        rows = _fetch_one(client, d)
        if rows:
            all_rows.extend(rows)
            ok += 1
        else:
            fail += 1

    print(f"[{SOURCE_ID}] fetched={ok} skipped={skip} not_found={fail}")

    if all_rows:
        df = pd.DataFrame(all_rows)
        count = upsert_df(df, "fno_oi")
        print(f"[{SOURCE_ID}] inserted {count} rows into fno_oi")
    else:
        count = 0

    log_sync(SOURCE_ID, "success", count, today)
    return count


if __name__ == "__main__":
    run()
