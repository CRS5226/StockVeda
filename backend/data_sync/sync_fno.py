"""
NSE F&O participant-wise Open Interest.
Source: nsearchives.nseindia.com/content/nsccl/fao_participant_oi_{DDMMYYYY}.csv
Note: F&O bhavcopy ZIP not found on nsearchives — handled in Part 4 via NSE session API.
Table: fno_oi
"""

import io
from datetime import date, timedelta
import pandas as pd
from backend.data_sync.base import (
    NSEARCHIVES_BASE, get_client, upsert_df, log_sync,
    last_synced_date, business_days_between, last_business_day
)

SOURCE_ID = "nse_fno_participant_oi"
URL_TPL = NSEARCHIVES_BASE + "/content/nsccl/fao_participant_oi_{ddmmyyyy}.csv"
DEFAULT_START = date(2015, 1, 1)

# Column pairs: (long col, short col, instrument label)
OI_COLUMNS = [
    ("Future Index Long",      "Future Index Short",      "FUTURE_INDEX"),
    ("Future Stock Long",      "Future Stock Short",      "FUTURE_STOCK"),
    ("Option Index Call Long", "Option Index Call Short", "OPTION_INDEX_CALL"),
    ("Option Index Put Long",  "Option Index Put Short",  "OPTION_INDEX_PUT"),
    ("Option Stock Call Long", "Option Stock Call Short", "OPTION_STOCK_CALL"),
    ("Option Stock Put Long",  "Option Stock Put Short",  "OPTION_STOCK_PUT"),
]


def _parse_oi(content: bytes, d: date) -> pd.DataFrame:
    # Row 0 is a title row; row 1 is the actual header
    df = pd.read_csv(io.BytesIO(content), header=1)
    df.columns = [c.strip() for c in df.columns]
    df = df.dropna(subset=[df.columns[0]])

    participant_col = df.columns[0]
    df = df[df[participant_col].str.strip().isin(["Client", "DII", "FII", "PRO"])].copy()

    rows = []
    for _, row in df.iterrows():
        ptype = row[participant_col].strip()
        for long_col, short_col, instrument in OI_COLUMNS:
            try:
                long_oi  = int(str(row[long_col]).replace(",", "").strip())
                short_oi = int(str(row[short_col]).replace(",", "").strip())
                rows.append({
                    "date":             d,
                    "participant_type": ptype,
                    "instrument":       instrument,
                    "long_oi":          long_oi,
                    "short_oi":         short_oi,
                    "net_oi":           long_oi - short_oi,
                })
            except (ValueError, KeyError):
                continue

    return pd.DataFrame(rows)


def run():
    last = last_synced_date(SOURCE_ID) or DEFAULT_START
    today = last_business_day(date.today())
    days = business_days_between(last + timedelta(days=1), today)

    if not days:
        print(f"[{SOURCE_ID}] already up to date")
        return

    print(f"[{SOURCE_ID}] fetching {len(days)} days: {days[0]} → {days[-1]}")

    all_rows, failed = [], []

    with get_client() as client:
        for d in days:
            url = URL_TPL.format(ddmmyyyy=d.strftime("%d%m%Y"))
            try:
                resp = client.get(url)
                if resp.status_code == 404:
                    continue
                resp.raise_for_status()

                df = _parse_oi(resp.content, d)
                if not df.empty:
                    all_rows.append(df)

            except Exception as e:
                failed.append(d)
                print(f"[{SOURCE_ID}] WARN {d}: {e}")

    if not all_rows:
        log_sync(SOURCE_ID, "failed", 0, last, f"{len(failed)} failures")
        print(f"[{SOURCE_ID}] FAILED — no data fetched")
        return

    combined = pd.concat(all_rows, ignore_index=True)
    count = upsert_df(combined, "fno_oi")
    status = "success" if not failed else "partial"
    log_sync(SOURCE_ID, status, count, days[-1])
    print(f"[{SOURCE_ID}] inserted {count} rows up to {days[-1]}")


if __name__ == "__main__":
    run()
