"""
NSE all-indices daily OHLCV.
Source: nsearchives.nseindia.com/content/indices/ind_close_all_{DDMMYYYY}.csv
Table: index_ohlcv
"""

import io
from datetime import date, timedelta
import pandas as pd
from backend.data_sync.base import (
    NSEARCHIVES_BASE, get_client, upsert_df, log_sync,
    last_synced_date, business_days_between, last_business_day
)

SOURCE_ID = "nse_index_close_all"
URL_TPL = NSEARCHIVES_BASE + "/content/indices/ind_close_all_{ddmmyyyy}.csv"
DEFAULT_START = date(2015, 1, 1)


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

                df = pd.read_csv(io.BytesIO(resp.content))
                df.columns = [c.strip() for c in df.columns]

                df = df.rename(columns={
                    "Index Name":          "index_name",
                    "Opening Index Value": "open",
                    "High Index Value":    "high",
                    "Low Index Value":     "low",
                    "Closing Index Value": "close",
                })
                df = df[["index_name", "open", "high", "low", "close"]].copy()
                df["date"] = d
                df["index_name"] = df["index_name"].str.strip()
                df = df[["date", "index_name", "open", "high", "low", "close"]].dropna(subset=["close"])
                all_rows.append(df)

            except Exception as e:
                failed.append(d)
                print(f"[{SOURCE_ID}] WARN {d}: {e}")

    if not all_rows:
        log_sync(SOURCE_ID, "failed", 0, last, f"{len(failed)} failures")
        print(f"[{SOURCE_ID}] FAILED — no data fetched")
        return

    combined = pd.concat(all_rows, ignore_index=True)
    count = upsert_df(combined, "index_ohlcv")
    status = "success" if not failed else "partial"
    log_sync(SOURCE_ID, status, count, days[-1])
    print(f"[{SOURCE_ID}] inserted {count} rows up to {days[-1]}")


if __name__ == "__main__":
    run()
