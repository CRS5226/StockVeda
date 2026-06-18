"""
BSE equity bhavcopy — covers BSE-only stocks not in NSE bhavcopy.
Source: bseindia.com/download/BhavCopy/Equity/EQ{DDMMYYYY}_CSV.ZIP
Table: stock_ohlcv (same schema as NSE bhavcopy)

Note: BSE website is a JS SPA — direct download URL returns HTML from cloud.
      Test on local machine; likely works with a proper browser-session referer.
"""

import io
import zipfile
from datetime import date, timedelta
import pandas as pd
from backend.data_sync.base import (
    get_client, upsert_df, log_sync,
    last_synced_date, business_days_between, last_business_day
)

SOURCE_ID   = "bse_bhavcopy"
BSE_URL     = "https://www.bseindia.com/download/BhavCopy/Equity/EQ{ddmmyyyy}_CSV.ZIP"
DEFAULT_START = date(2015, 1, 1)

BSE_HEADERS = {
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120",
    "Accept": "application/zip,application/octet-stream,*/*",
    "Accept-Encoding": "gzip, deflate",
    "Referer": "https://www.bseindia.com/markets/MarketInfo/BhavCopy.aspx",
}

COLUMN_MAP = {
    "SC_CODE":  "scrip_code",
    "SC_NAME":  "symbol",
    "OPEN":     "open",
    "HIGH":     "high",
    "LOW":      "low",
    "CLOSE":    "close",
    "NO_OF_SHRS": "volume",
}


def _fetch_bse_bhavcopy(client, d: date) -> pd.DataFrame | None:
    url = BSE_URL.format(ddmmyyyy=d.strftime("%d%m%Y"))
    resp = client.get(url)

    # BSE returns HTML (200) if the URL redirected to their SPA — detect by content-type
    ct = resp.headers.get("content-type", "")
    if resp.status_code == 404:
        return None
    if "text/html" in ct or "text/plain" in ct:
        # Got HTML instead of ZIP — SPA redirect (blocked from cloud)
        print(f"[{SOURCE_ID}] {d}: got HTML instead of ZIP — run on local machine")
        return None
    resp.raise_for_status()

    with zipfile.ZipFile(io.BytesIO(resp.content)) as z:
        csvs = [n for n in z.namelist() if n.lower().endswith(".csv")]
        if not csvs:
            return None
        df = pd.read_csv(z.open(csvs[0]))

    df.columns = [c.strip() for c in df.columns]
    df = df.rename(columns=COLUMN_MAP)

    # Keep only A (active) group stocks, exclude debt/preference shares
    if "SC_GROUP" in df.columns or "GROUP" in df.columns:
        grp_col = "SC_GROUP" if "SC_GROUP" in df.columns else "GROUP"
        df = df[df[grp_col].str.strip().isin(["A", "B", "T", "XT"])].copy()

    df["date"] = d
    df["symbol"] = df["symbol"].str.strip()

    keep = ["date", "symbol", "open", "high", "low", "close", "volume"]
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
    print(f"[{SOURCE_ID}] NOTE: BSE direct download is blocked from cloud IPs — run on local")

    all_rows, failed = [], []

    with get_client(timeout=30) as client:
        client.headers.update(BSE_HEADERS)
        for d in days:
            try:
                df = _fetch_bse_bhavcopy(client, d)
                if df is not None:
                    all_rows.append(df)
            except Exception as e:
                failed.append(d)
                print(f"[{SOURCE_ID}] WARN {d}: {e}")

    if not all_rows:
        log_sync(SOURCE_ID, "failed", 0, last, "no data — likely blocked from cloud")
        print(f"[{SOURCE_ID}] FAILED — run on local machine")
        return

    combined = pd.concat(all_rows, ignore_index=True)
    count = upsert_df(combined, "stock_ohlcv")
    status = "success" if not failed else "partial"
    log_sync(SOURCE_ID, status, count, days[-1])
    print(f"[{SOURCE_ID}] inserted {count} rows up to {days[-1]}")


if __name__ == "__main__":
    run()
