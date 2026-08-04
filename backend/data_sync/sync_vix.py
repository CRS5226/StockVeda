"""
India VIX — full history via yfinance (^INDIAVIX).
Table: india_vix

Originally pulled a static NSE archive CSV, which returns 404 as of 2026-08
(URL retired/moved on NSE's side) — switched to yfinance, which the live
macro dashboard already relies on as its own India VIX fallback
(backend/routes/macro.py), so this is a proven-working source in this app.
"""

import pandas as pd
from backend.data_sync.base import upsert_df, log_sync, last_synced_date

SOURCE_ID = "india_vix"
TICKER = "^INDIAVIX"


def run():
    import yfinance as yf

    print(f"[{SOURCE_ID}] fetching {TICKER} via yfinance")
    last = last_synced_date(SOURCE_ID)
    try:
        start = (last + pd.Timedelta(days=1)).isoformat() if last else "2009-01-01"
        hist = yf.Ticker(TICKER).history(start=start, auto_adjust=True)
    except Exception as e:
        log_sync(SOURCE_ID, "failed", 0, None, str(e))
        print(f"[{SOURCE_ID}] FAILED: {e}")
        return

    if hist.empty:
        log_sync(SOURCE_ID, "success", 0, last)
        print(f"[{SOURCE_ID}] no new rows, last date: {last}")
        return

    hist = hist.reset_index()
    df = pd.DataFrame({
        "date":  pd.to_datetime(hist["Date"]).dt.date,
        "open":  hist["Open"].astype(float),
        "high":  hist["High"].astype(float),
        "low":   hist["Low"].astype(float),
        "close": hist["Close"].astype(float),
    }).dropna()

    count = upsert_df(df, "india_vix")
    last_date = df["date"].max() if not df.empty else last
    log_sync(SOURCE_ID, "success", count, last_date)
    print(f"[{SOURCE_ID}] inserted {count} rows, last date: {last_date}")


if __name__ == "__main__":
    run()
