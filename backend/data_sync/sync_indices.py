"""
NSE index OHLCV via yfinance — fast, reliable, no per-day CSV fetching.
Sectoral indices whose Yahoo tickers are stale come from NSE's daily
index close file instead (nsearchives.nseindia.com/content/indices/ind_close_all_DDMMYYYY.csv).
Table: index_ohlcv
"""

import io
from datetime import date, timedelta
import pandas as pd
import yfinance as yf
from backend.data_sync.base import (
    NSEARCHIVES_BASE, get_client, upsert_df, log_sync,
    last_synced_date, business_days_between, last_business_day
)

SOURCE_ID = "nse_index_close_all"
DEFAULT_START = date(2020, 1, 1)

# Map NSE display name → Yahoo Finance ticker
INDICES = {
    "NIFTY 50":    "^NSEI",
    "NIFTY BANK":  "^NSEBANK",
    "SENSEX":      "^BSESN",
    "NIFTY IT":    "^CNXIT",
    "NIFTY PHARMA": "^CNXPHARMA",
    "NIFTY MIDCAP 100": "^NSEMDCP50",
}

# Yahoo's ^CNXAUTO / ^CNXFMCG / ^CNXMETAL / ^CNXENERGY / ^CNXREALTY return only
# 1 row of history, so these come from NSE's daily index close file instead.
# Map NSE display name → "Index Name" as it appears in ind_close_all CSV.
NSE_SOURCE_ID = "nse_index_close_sectoral"
NSE_CLOSE_URL = NSEARCHIVES_BASE + "/content/indices/ind_close_all_{ddmmyyyy}.csv"
NSE_LOOKBACK_DAYS = 30  # first sync only; dashboard tiles need just the last 2 closes
NSE_INDICES = {
    "NIFTY AUTO":   "Nifty Auto",
    "NIFTY FMCG":   "Nifty FMCG",
    "NIFTY METAL":  "Nifty Metal",
    "NIFTY ENERGY": "Nifty Energy",
    "NIFTY REALTY": "Nifty Realty",
}


def _parse_ind_close(text: str) -> pd.DataFrame:
    """Parse one ind_close_all CSV into index_ohlcv rows for NSE_INDICES."""
    df = pd.read_csv(io.StringIO(text))
    df.columns = [c.strip() for c in df.columns]
    lookup = {v.lower(): k for k, v in NSE_INDICES.items()}
    df["index_name"] = df["Index Name"].astype(str).str.strip().str.lower().map(lookup)
    df = df[df["index_name"].notna()]
    out = pd.DataFrame({
        "date":       pd.to_datetime(df["Index Date"].astype(str).str.strip(), format="%d-%m-%Y").dt.date,
        "index_name": df["index_name"],
        "open":       pd.to_numeric(df["Open Index Value"], errors="coerce"),
        "high":       pd.to_numeric(df["High Index Value"], errors="coerce"),
        "low":        pd.to_numeric(df["Low Index Value"], errors="coerce"),
        "close":      pd.to_numeric(df["Closing Index Value"], errors="coerce"),
    })
    return out.dropna(subset=["close"]).reset_index(drop=True)


def _run_nse_sectoral():
    today = date.today()
    last = last_synced_date(NSE_SOURCE_ID) or (today - timedelta(days=NSE_LOOKBACK_DAYS))
    days = business_days_between(last + timedelta(days=1), last_business_day(today))
    if not days:
        print(f"[{NSE_SOURCE_ID}] already up to date")
        return

    print(f"[{NSE_SOURCE_ID}] fetching {len(days)} days of NSE index closes")
    frames, last_ok = [], None
    with get_client() as client:
        for d in days:
            try:
                resp = client.get(NSE_CLOSE_URL.format(ddmmyyyy=d.strftime("%d%m%Y")))
                if resp.status_code in (404, 403):
                    continue  # holiday / not published yet
                resp.raise_for_status()
                df = _parse_ind_close(resp.text)
                if not df.empty:
                    frames.append(df)
                    last_ok = d
            except Exception as e:
                print(f"[{NSE_SOURCE_ID}] {d}: FAILED — {e}")

    if not frames:
        log_sync(NSE_SOURCE_ID, "failed", 0, last, "no NSE index close files fetched")
        return

    count = upsert_df(pd.concat(frames, ignore_index=True), "index_ohlcv")
    log_sync(NSE_SOURCE_ID, "success", count, last_ok)
    print(f"[{NSE_SOURCE_ID}] inserted {count} rows")


def run():
    try:
        _run_nse_sectoral()
    except Exception as e:
        print(f"[{NSE_SOURCE_ID}] FAILED — {e}")

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
