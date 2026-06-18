"""
Indian macro data from FRED (St. Louis Fed) — same approach as sync_global.py.
Covers India CPI, USD/INR rate (monthly), India GDP per capita.
Table: macro_monthly, macro_quarterly
Note: FRED times out from cloud IPs — run on local machine.
"""

import io
import pandas as pd
from backend.data_sync.base import get_client, upsert_df, log_sync, last_synced_date

SOURCE_ID = "fred_india"

FRED_HEADERS = {
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/csv,text/plain,*/*",
    "Referer": "https://fred.stlouisfed.org/",
}

# (series_id, metric_name, unit, table)
MONTHLY_SERIES = [
    ("INDCPIALLMINMEI", "CPI_INDIA",      "INDEX",  "macro_monthly"),
    ("EXINUS",          "USDINR_MONTHLY", "INR",    "macro_monthly"),
    ("INDIRLTLT01STM",  "GSEC_10YR_INDIA","%",      "macro_monthly"),
]

QUARTERLY_SERIES = [
    ("INDGDPRQPSMEI",   "GDP_INDIA",      "USD_BN", "macro_quarterly"),
]


def _fetch_fred(client, series_id: str) -> pd.DataFrame:
    url = f"https://fred.stlouisfed.org/graph/fredgraph.csv?id={series_id}"
    resp = client.get(url)
    resp.raise_for_status()
    df = pd.read_csv(io.BytesIO(resp.content))
    df.columns = ["date", "value"]
    df["date"] = pd.to_datetime(df["date"]).dt.date
    df = df[df["value"].astype(str) != "."].copy()
    df["value"] = pd.to_numeric(df["value"], errors="coerce")
    return df.dropna(subset=["value"])


def run():
    last = last_synced_date(SOURCE_ID)
    all_monthly, all_quarterly, failed = [], [], []

    with get_client(timeout=60) as client:
        client.headers.update(FRED_HEADERS)

        for series_id, metric, unit, table in MONTHLY_SERIES + QUARTERLY_SERIES:
            try:
                df = _fetch_fred(client, series_id)
                if last:
                    df = df[df["date"] > last]
                df["metric"] = metric
                df["unit"]   = unit
                df = df[["date", "metric", "value", "unit"]]
                if table == "macro_monthly":
                    all_monthly.append(df)
                else:
                    all_quarterly.append(df)
                print(f"[{SOURCE_ID}] {metric}: {len(df)} rows")
            except Exception as e:
                failed.append(series_id)
                print(f"[{SOURCE_ID}] WARN {series_id}: {e}")

    count = 0
    if all_monthly:
        count += upsert_df(pd.concat(all_monthly, ignore_index=True), "macro_monthly")
    if all_quarterly:
        count += upsert_df(pd.concat(all_quarterly, ignore_index=True), "macro_quarterly")

    if count == 0 and failed:
        log_sync(SOURCE_ID, "failed", 0, last, f"all series failed: {failed}")
        print(f"[{SOURCE_ID}] FAILED — likely network-blocked (run on local machine)")
        return

    from datetime import date
    status = "success" if not failed else "partial"
    log_sync(SOURCE_ID, status, count, date.today())
    print(f"[{SOURCE_ID}] inserted {count} rows")


if __name__ == "__main__":
    run()
