"""
Global macro data from FRED (St. Louis Fed) — free CSV, no API key needed.
Series: US Fed Rate, 10yr Treasury yield, CPI, Yield Curve spread.
Table: macro_monthly
"""

import io
import pandas as pd
from backend.data_sync.base import get_client, upsert_df, log_sync, last_synced_date

SOURCE_ID = "fred_global"

FRED_SERIES = {
    "US_FED_RATE":    ("https://fred.stlouisfed.org/graph/fredgraph.csv?id=FEDFUNDS", "%"),
    "US_10YR_YIELD":  ("https://fred.stlouisfed.org/graph/fredgraph.csv?id=DGS10",   "%"),
    "US_2YR_YIELD":   ("https://fred.stlouisfed.org/graph/fredgraph.csv?id=DGS2",    "%"),
    "US_CPI":         ("https://fred.stlouisfed.org/graph/fredgraph.csv?id=CPIAUCSL","INDEX"),
    "US_YIELD_CURVE": ("https://fred.stlouisfed.org/graph/fredgraph.csv?id=T10Y2Y",  "%"),
}

FRED_HEADERS = {
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/csv,text/plain,*/*",
    "Referer": "https://fred.stlouisfed.org/",
}


def run():
    last = last_synced_date(SOURCE_ID)
    all_rows, failed = [], []

    with get_client(timeout=60) as client:
        client.headers.update(FRED_HEADERS)

        for metric, (url, unit) in FRED_SERIES.items():
            try:
                resp = client.get(url)
                resp.raise_for_status()

                df = pd.read_csv(io.BytesIO(resp.content))
                df.columns = ["date", "value"]
                df["date"] = pd.to_datetime(df["date"]).dt.date
                df = df[df["value"].astype(str) != "."].copy()
                df["value"] = pd.to_numeric(df["value"], errors="coerce")
                df = df.dropna(subset=["value"])
                df["metric"] = metric
                df["unit"] = unit

                if last:
                    df = df[df["date"] > last]

                df = df[["date", "metric", "value", "unit"]]
                all_rows.append(df)
                print(f"[{SOURCE_ID}] {metric}: {len(df)} rows")

            except Exception as e:
                failed.append(metric)
                print(f"[{SOURCE_ID}] WARN {metric}: {e}")

    if not all_rows:
        log_sync(SOURCE_ID, "failed", 0, last, f"all series failed: {failed}")
        print(f"[{SOURCE_ID}] FAILED")
        return

    combined = pd.concat(all_rows, ignore_index=True)
    count = upsert_df(combined, "macro_monthly")
    last_date = combined["date"].max()
    status = "success" if not failed else "partial"
    log_sync(SOURCE_ID, status, count, last_date)
    print(f"[{SOURCE_ID}] inserted {count} rows, last date: {last_date}")


if __name__ == "__main__":
    run()
