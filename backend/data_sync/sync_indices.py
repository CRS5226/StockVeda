"""
NSE index OHLCV via yfinance — fast, reliable, no per-day CSV fetching.
Table: index_ohlcv
"""

from datetime import date, timedelta
import pandas as pd
import yfinance as yf
from backend.data_sync.base import upsert_df, log_sync, last_synced_date

SOURCE_ID = "nse_index_close_all"
DEFAULT_START = date(2020, 1, 1)

# Map NSE display name → Yahoo Finance ticker
INDICES = {
    "NIFTY 50":    "^NSEI",
    "NIFTY BANK":  "^NSEBANK",
    "SENSEX":      "^BSESN",
    "NIFTY IT":    "^CNXIT",
    "NIFTY AUTO":  "^CNXAUTO",
    "NIFTY FMCG":  "^CNXFMCG",
    "NIFTY PHARMA": "^CNXPHARMA",
    "NIFTY METAL": "^CNXMETAL",
    "NIFTY ENERGY": "^CNXENERGY",
    "NIFTY REALTY": "^CNXREALTY",
    "NIFTY MIDCAP 100": "^NSEMDCP50",
}


def run():
    last = last_synced_date(SOURCE_ID) or DEFAULT_START
    today = date.today()
    if last >= today:
        print(f"[{SOURCE_ID}] already up to date")
        return

    start_str = (last + timedelta(days=1)).isoformat()
    end_str = (today + timedelta(days=1)).isoformat()
    print(f"[{SOURCE_ID}] fetching {len(INDICES)} indices from {start_str}")

    all_rows, failed = [], []
    for name, ticker in INDICES.items():
        try:
            t = yf.Ticker(ticker)
            hist = t.history(start=start_str, end=end_str)
            if hist.empty:
                print(f"[{SOURCE_ID}] {name}: no data")
                continue
            hist = hist.reset_index()
            df = pd.DataFrame({
                "date":       pd.to_datetime(hist["Date"]).dt.date,
                "index_name": name,
                "open":       hist["Open"],
                "high":       hist["High"],
                "low":        hist["Low"],
                "close":      hist["Close"],
            })
            df = df.dropna(subset=["close"])
            all_rows.append(df)
            print(f"[{SOURCE_ID}] {name}: {len(df)} rows")
        except Exception as e:
            failed.append(name)
            print(f"[{SOURCE_ID}] {name}: FAILED — {e}")

    if not all_rows:
        log_sync(SOURCE_ID, "failed", 0, last, f"all {len(failed)} failed")
        return

    combined = pd.concat(all_rows, ignore_index=True)
    count = upsert_df(combined, "index_ohlcv")
    status = "success" if not failed else "partial"
    log_sync(SOURCE_ID, status, count, today)
    print(f"[{SOURCE_ID}] inserted {count} rows")


if __name__ == "__main__":
    run()
