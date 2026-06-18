"""
India VIX — full history from a single static NSE CSV.
Table: india_vix
"""

import io
import pandas as pd
from backend.data_sync.base import get_client, upsert_df, log_sync, last_synced_date
from datetime import date

SOURCE_ID = "india_vix"
URL = "https://archives.nseindia.com/content/indices/ind_vix_hist.csv"


def run():
    print(f"[{SOURCE_ID}] fetching {URL}")
    try:
        with get_client() as client:
            resp = client.get(URL)
            resp.raise_for_status()
    except Exception as e:
        log_sync(SOURCE_ID, "failed", 0, None, str(e))
        print(f"[{SOURCE_ID}] FAILED: {e}")
        return

    df = pd.read_csv(io.BytesIO(resp.content))
    df.columns = [c.strip() for c in df.columns]

    # NSE VIX CSV columns: Date,Open,High,Low,Close,Prev Close,% Change
    df = df.rename(columns={
        "Date": "date",
        "Open": "open",
        "High": "high",
        "Low": "low",
        "Close": "close",
    })
    df["date"] = pd.to_datetime(df["date"], dayfirst=True).dt.date
    df = df[["date", "open", "high", "low", "close"]].dropna()

    last = last_synced_date(SOURCE_ID)
    if last:
        df = df[df["date"] > last]

    count = upsert_df(df, "india_vix")
    last_date = df["date"].max() if not df.empty else last
    log_sync(SOURCE_ID, "success", count, last_date)
    print(f"[{SOURCE_ID}] inserted {count} rows, last date: {last_date}")


if __name__ == "__main__":
    run()
