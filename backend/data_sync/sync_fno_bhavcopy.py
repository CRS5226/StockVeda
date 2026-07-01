"""
NSE F&O daily bhavcopy (futures + options OHLCV + OI).
Source: nsearchives.nseindia.com/content/fo/BhavCopy_NSE_FO_0_0_0_{YYYYMMDD}_F_0000.csv.zip
Table: fno_ohlcv

Only stores index instruments (OPTIDX/FUTIDX) to keep DB size manageable.
Stock options add ~40K rows/day vs ~6K for index — not needed for the option chain view.
"""

import io
import zipfile
from datetime import date, timedelta
import pandas as pd
from backend.data_sync.base import (
    upsert_df, log_sync,
    last_synced_date, business_days_between, last_business_day
)
from backend.data_sync.nse_session import nse_get, get_nse_client

SOURCE_ID     = "nse_fno_bhavcopy"
BHAV_URL      = "https://nsearchives.nseindia.com/content/fo/BhavCopy_NSE_FO_0_0_0_{yyyymmdd}_F_0000.csv.zip"
DEFAULT_START = date(2025, 1, 1)   # UDiFF format reliably available from 2024 onward
BATCH_DAYS    = 5                   # flush to DB every N days — keeps RAM under 50MB

COLUMN_MAP = {
    "TckrSymb":        "symbol",
    "FinInstrmTp":     "instrument_code",
    "XpryDt":          "expiry",
    "StrkPric":        "strike",
    "OptnTp":          "option_type",
    "OpnPric":         "open",
    "HghPric":         "high",
    "LwPric":          "low",
    "ClsPric":         "close",
    "SttlmPric":       "settle_price",
    "TtlTradgVol":     "contracts",
    "OpnIntrst":       "open_interest",
    "ChngInOpnIntrst": "oi_change",
    "TradDt":          "date",
}

INSTR_MAP = {
    "STO": "OPTSTK",
    "STF": "FUTSTK",
    "IDO": "OPTIDX",
    "IDF": "FUTIDX",
}

# Only keep index options — FUTIDX (IDF) have no strike and don't fit the fno_ohlcv PK
INDEX_INSTRUMENTS = {"IDO"}
# Stock + index options — used when fetching a single symbol on demand
OPTION_INSTRUMENTS = {"IDO", "STO"}


def fetch_fno_day(d: date, symbol: str | None = None) -> pd.DataFrame | None:
    """
    Download one day's bhavcopy and return option rows.
    With no symbol: index options only (bulk/default sync — keeps DB small).
    With a symbol: stock or index options for that symbol only (on-demand fetch).
    """
    url = BHAV_URL.format(yyyymmdd=d.strftime("%Y%m%d"))
    resp = nse_get(url)
    if resp.status_code == 404:
        return None
    resp.raise_for_status()

    with zipfile.ZipFile(io.BytesIO(resp.content)) as z:
        csvs = [n for n in z.namelist() if n.lower().endswith(".csv")]
        if not csvs:
            return None
        df = pd.read_csv(z.open(csvs[0]))

    df.columns = [c.strip() for c in df.columns]

    if "FinInstrmTp" not in df.columns:
        return None

    if symbol:
        df = df[df["FinInstrmTp"].isin(OPTION_INSTRUMENTS)]
        df = df[df["TckrSymb"].str.strip().str.upper() == symbol.upper()]
    else:
        df = df[df["FinInstrmTp"].isin(INDEX_INSTRUMENTS)]

    df = df.rename(columns={k: v for k, v in COLUMN_MAP.items() if k in df.columns})
    df["instrument"] = df["instrument_code"].map(INSTR_MAP)
    df = df.drop(columns=["instrument_code"], errors="ignore")

    if "date" in df.columns:
        df["date"] = pd.to_datetime(df["date"], errors="coerce").dt.date
    else:
        df["date"] = d

    if "expiry" in df.columns:
        df["expiry"] = pd.to_datetime(df["expiry"], errors="coerce").dt.date
    if "strike" in df.columns:
        df["strike"] = pd.to_numeric(df["strike"], errors="coerce")
    if "option_type" in df.columns:
        df["option_type"] = df["option_type"].str.strip().replace("", None)

    numeric_cols = ["open", "high", "low", "close", "settle_price", "contracts", "open_interest", "oi_change"]
    for col in numeric_cols:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")

    keep = ["date", "symbol", "instrument", "expiry", "strike", "option_type",
            "open", "high", "low", "close", "settle_price", "contracts", "open_interest", "oi_change"]
    keep = [c for c in keep if c in df.columns]
    return df[keep].dropna(subset=["symbol", "close"])


def run():
    last = max(last_synced_date(SOURCE_ID) or DEFAULT_START, DEFAULT_START)
    today = last_business_day(date.today())
    days = business_days_between(last + timedelta(days=1), today)

    if not days:
        print(f"[{SOURCE_ID}] already up to date")
        return

    print(f"[{SOURCE_ID}] fetching {len(days)} days: {days[0]} → {days[-1]} (index only)")

    batch_rows: list = []
    total_count = 0
    failed = []
    last_inserted = last

    get_nse_client()
    for i, d in enumerate(days):
        try:
            df = fetch_fno_day(d)
            if df is not None:
                batch_rows.append(df)
                print(f"[{SOURCE_ID}] {d}: {len(df)} rows")
            else:
                print(f"[{SOURCE_ID}] {d}: no file (holiday/weekend)")
        except Exception as e:
            failed.append(d)
            print(f"[{SOURCE_ID}] WARN {d}: {e}")

        if batch_rows and (len(batch_rows) >= BATCH_DAYS or i == len(days) - 1):
            combined = pd.concat(batch_rows, ignore_index=True)
            count = upsert_df(combined, "fno_ohlcv")
            total_count += count
            last_inserted = d
            log_sync(SOURCE_ID, "partial", total_count, last_inserted)
            print(f"[{SOURCE_ID}] flushed {count} rows — total {total_count}")
            batch_rows = []

    if total_count == 0:
        log_sync(SOURCE_ID, "failed", 0, last, f"{len(failed)} failures")
        print(f"[{SOURCE_ID}] FAILED — no data fetched")
        return

    status = "success" if not failed else "partial"
    log_sync(SOURCE_ID, status, total_count, last_inserted)
    print(f"[{SOURCE_ID}] done — {total_count} rows up to {last_inserted}")


if __name__ == "__main__":
    run()
