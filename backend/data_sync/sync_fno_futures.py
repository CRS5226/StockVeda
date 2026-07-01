"""
Per-symbol on-demand futures fetch from NSE bhavcopy.
Downloads the same daily ZIP as options sync, but filters to FUTIDX/FUTSTK
and optionally a single symbol. Stores in fno_futures_ohlcv (separate table
so NULL strike/option_type don't violate the options table PK).
"""

import io
import zipfile
from datetime import date
import pandas as pd

from backend.data_sync.base import upsert_df, business_days_between
from backend.data_sync.nse_session import nse_get, get_nse_client

BHAV_URL = "https://nsearchives.nseindia.com/content/fo/BhavCopy_NSE_FO_0_0_0_{yyyymmdd}_F_0000.csv.zip"

FUTURES_INSTRUMENTS = {"IDF", "STF"}  # FUTIDX and FUTSTK

COLUMN_MAP = {
    "TckrSymb":        "symbol",
    "FinInstrmTp":     "instrument_code",
    "XpryDt":          "expiry",
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

INSTR_MAP = {"IDF": "FUTIDX", "STF": "FUTSTK"}


def fetch_futures_day(d: date, symbol: str | None = None) -> pd.DataFrame | None:
    """Download one day's bhavcopy and return futures rows, optionally filtered by symbol."""
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

    df = df[df["FinInstrmTp"].isin(FUTURES_INSTRUMENTS)].copy()

    if symbol:
        df = df[df["TckrSymb"].str.strip().str.upper() == symbol.upper()]

    if df.empty:
        return None

    df = df.rename(columns={k: v for k, v in COLUMN_MAP.items() if k in df.columns})
    df["instrument"] = df["instrument_code"].map(INSTR_MAP)
    df = df.drop(columns=["instrument_code"], errors="ignore")

    if "date" in df.columns:
        df["date"] = pd.to_datetime(df["date"], errors="coerce").dt.date
    else:
        df["date"] = d

    if "expiry" in df.columns:
        df["expiry"] = pd.to_datetime(df["expiry"], errors="coerce").dt.date

    numeric_cols = ["open", "high", "low", "close", "settle_price", "contracts", "open_interest", "oi_change"]
    for col in numeric_cols:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")

    keep = ["date", "symbol", "instrument", "expiry", "open", "high", "low",
            "close", "settle_price", "contracts", "open_interest", "oi_change"]
    keep = [c for c in keep if c in df.columns]
    return df[keep].dropna(subset=["symbol", "expiry", "close"])


def fetch_and_store(symbol: str | None, from_date: date, to_date: date,
                    progress_cb=None) -> int:
    """
    Download bhavcopy for each trading day in range, filter to futures
    (and optionally one symbol), batch-insert every 5 days.

    progress_cb(done, total, current_date, inserted) called after each day.
    Returns total rows inserted.
    """
    days = business_days_between(from_date, to_date)
    if not days:
        return 0

    get_nse_client()

    batch: list[pd.DataFrame] = []
    total = 0
    BATCH = 5

    for i, d in enumerate(days):
        try:
            df = fetch_futures_day(d, symbol=symbol)
            if df is not None:
                batch.append(df)
        except Exception as e:
            print(f"[fno_futures] WARN {d}: {e}")

        if batch and (len(batch) >= BATCH or i == len(days) - 1):
            try:
                combined = pd.concat(batch, ignore_index=True)
                count = upsert_df(combined, "fno_futures_ohlcv")
                total += count
            except Exception as e:
                print(f"[fno_futures] WARN flush: {e}")
            batch = []

        if progress_cb:
            progress_cb(i + 1, len(days), str(d), total)

    return total
