"""
NSE F&O daily bhavcopy (futures + options OHLCV + OI).
Source: nsearchives.nseindia.com/archives/fo/bhavcopy/fo{DDMMYY}.zip
  - ZIP uses 2-digit year; file inside uses 4-digit year (same as equity bhavcopy).
  - Returns 503 from cloud IPs (Akamai) — run on local Indian IP.
Table: fno_ohlcv
"""

import io
import zipfile
from datetime import date, timedelta
import pandas as pd
from backend.data_sync.base import (
    NSEARCHIVES_BASE, get_client, upsert_df, log_sync,
    last_synced_date, business_days_between, last_business_day
)

SOURCE_ID   = "nse_fno_bhavcopy"
BHAV_URL    = NSEARCHIVES_BASE + "/archives/fo/bhavcopy/fo{ddmmyy}.zip"
DEFAULT_START = date(2015, 1, 1)

COLUMN_MAP = {
    "SYMBOL":      "symbol",
    "INSTRUMENT":  "instrument",
    "EXPIRY_DT":   "expiry",
    "STRIKE_PR":   "strike",
    "OPTION_TYP":  "option_type",
    "OPEN":        "open",
    "HIGH":        "high",
    "LOW":         "low",
    "CLOSE":       "close",
    "SETTLE_PR":   "settle_price",
    "CONTRACTS":   "contracts",
    "OPEN_INT":    "open_interest",
    "CHG_IN_OI":   "oi_change",
}


def _fetch_fno_bhavcopy(client, d: date) -> pd.DataFrame | None:
    url = BHAV_URL.format(ddmmyy=d.strftime("%d%m%y"))
    resp = client.get(url)
    if resp.status_code == 404:
        return None
    resp.raise_for_status()

    with zipfile.ZipFile(io.BytesIO(resp.content)) as z:
        # Try 4-digit year first (standard NSE pattern), fall back to 2-digit
        fo_4 = f"fo{d.strftime('%d%m%Y')}.csv"
        fo_2 = f"fo{d.strftime('%d%m%y')}.csv"
        name = fo_4 if fo_4 in z.namelist() else (fo_2 if fo_2 in z.namelist() else None)
        if name is None:
            # Last resort: pick the first .csv in the zip
            csvs = [n for n in z.namelist() if n.lower().endswith(".csv")]
            if not csvs:
                return None
            name = csvs[0]
        df = pd.read_csv(z.open(name))

    df.columns = [c.strip() for c in df.columns]
    df = df.rename(columns={k: v for k, v in COLUMN_MAP.items() if k in df.columns})

    df["date"] = d

    # Parse expiry and strike
    if "expiry" in df.columns:
        df["expiry"] = pd.to_datetime(df["expiry"], dayfirst=True, errors="coerce").dt.date
    if "strike" in df.columns:
        df["strike"] = pd.to_numeric(df["strike"], errors="coerce")
    if "option_type" in df.columns:
        df["option_type"] = df["option_type"].str.strip().replace("-", None)

    numeric_cols = ["open", "high", "low", "close", "settle_price", "contracts", "open_interest", "oi_change"]
    for col in numeric_cols:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")

    keep = ["date", "symbol", "instrument", "expiry", "strike", "option_type",
            "open", "high", "low", "close", "settle_price", "contracts", "open_interest", "oi_change"]
    keep = [c for c in keep if c in df.columns]
    return df[keep].dropna(subset=["symbol", "close"])


def run():
    last = last_synced_date(SOURCE_ID) or DEFAULT_START
    today = last_business_day(date.today())
    days = business_days_between(last + timedelta(days=1), today)

    if not days:
        print(f"[{SOURCE_ID}] already up to date")
        return

    print(f"[{SOURCE_ID}] fetching {len(days)} days: {days[0]} → {days[-1]}")

    all_rows, failed = [], []

    with get_client(timeout=120) as client:
        for d in days:
            try:
                df = _fetch_fno_bhavcopy(client, d)
                if df is not None:
                    all_rows.append(df)
                    print(f"[{SOURCE_ID}] {d}: {len(df)} rows")
            except Exception as e:
                failed.append(d)
                print(f"[{SOURCE_ID}] WARN {d}: {e}")

    if not all_rows:
        log_sync(SOURCE_ID, "failed", 0, last, f"{len(failed)} failures")
        print(f"[{SOURCE_ID}] FAILED — no data fetched")
        return

    combined = pd.concat(all_rows, ignore_index=True)
    count = upsert_df(combined, "fno_ohlcv")
    status = "success" if not failed else "partial"
    log_sync(SOURCE_ID, status, count, days[-1])
    print(f"[{SOURCE_ID}] inserted {count} rows up to {days[-1]}")


if __name__ == "__main__":
    run()
