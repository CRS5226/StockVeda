"""
Currency OHLCV via Yahoo Finance (yfinance).
Pairs: USD/INR, EUR/INR, GBP/INR, JPY/INR
Table: currency_ohlcv
"""

import time
from datetime import date, timedelta
import pandas as pd
import yfinance as yf
from backend.data_sync.base import log_sync, upsert_df, last_synced_date, last_business_day

SOURCE_ID = "yf_currency"
DEFAULT_START = date(2015, 1, 1)

PAIRS = {
    "USDINR=X": "USDINR",
    "EURINR=X": "EURINR",
    "GBPINR=X": "GBPINR",
    "JPYINR=X": "JPYINR",
}


def run():
    last = last_synced_date(SOURCE_ID) or DEFAULT_START
    today = last_business_day(date.today())
    start = last + timedelta(days=1)

    if start > today:
        print(f"[{SOURCE_ID}] already up to date")
        return

    print(f"[{SOURCE_ID}] fetching {start} → {today}")

    all_rows, failed = [], []

    for ticker_code, pair_name in PAIRS.items():
        try:
            t = yf.Ticker(ticker_code)
            hist = t.history(start=start.isoformat(), end=(today + timedelta(days=1)).isoformat())
            if hist.empty:
                print(f"[{SOURCE_ID}] {pair_name}: no data")
                continue

            hist = hist.reset_index()
            hist["date"] = pd.to_datetime(hist["Date"]).dt.date
            hist["pair"] = pair_name
            hist = hist.rename(columns={"Open": "open", "High": "high", "Low": "low", "Close": "close"})
            all_rows.append(hist[["date", "pair", "open", "high", "low", "close"]].dropna(subset=["close"]))
            print(f"[{SOURCE_ID}] {pair_name}: {len(hist)} rows")
        except Exception as e:
            failed.append(pair_name)
            print(f"[{SOURCE_ID}] WARN {pair_name}: {e}")
        time.sleep(0.5)

    if not all_rows:
        log_sync(SOURCE_ID, "failed", 0, last, "no currency data")
        return

    combined = pd.concat(all_rows, ignore_index=True)
    count = upsert_df(combined, "currency_ohlcv")
    status = "success" if not failed else "partial"
    log_sync(SOURCE_ID, status, count, today)
    print(f"[{SOURCE_ID}] inserted {count} rows")


if __name__ == "__main__":
    run()
