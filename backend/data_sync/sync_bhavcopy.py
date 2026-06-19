"""
NSE equity bhavcopy + delivery data.
Source: nsearchives.nseindia.com/archives/equities/bhavcopy/pr/PR{DDMMYY}.zip
One ZIP per day contains: pd (price+symbol), mcap, etf, sme, corpbond files.
Tables: stock_ohlcv, stock_delivery
"""

import io
import zipfile
from datetime import date, timedelta
import pandas as pd
from backend.data_sync.base import (
    NSEARCHIVES_BASE, get_client, upsert_df, log_sync,
    last_synced_date, business_days_between, last_business_day
)

SOURCE_ID = "nse_bhavcopy_equity"
BHAV_URL = NSEARCHIVES_BASE + "/archives/equities/bhavcopy/pr/PR{ddmmyy}.zip"
MTO_URL  = NSEARCHIVES_BASE + "/archives/equities/mto/MTO_{ddmmyyyy}.DAT"
DEFAULT_LOOKBACK_DAYS = 90  # first sync covers last 90 days only; incremental after that


def _fetch_bhavcopy(client, d: date):
    """Download PR zip and extract equity OHLCV from pd{ddmmyy}.csv."""
    url = BHAV_URL.format(ddmmyy=d.strftime("%d%m%y"))   # 2-digit year
    resp = client.get(url)
    if resp.status_code in (404, 403):
        return None
    resp.raise_for_status()

    with zipfile.ZipFile(io.BytesIO(resp.content)) as z:
        # ZIP uses 2-digit year; files inside use 4-digit year
        pd_name = f"pd{d.strftime('%d%m%Y')}.csv"
        if pd_name not in z.namelist():
            return None
        df = pd.read_csv(z.open(pd_name))

    df.columns = [c.strip() for c in df.columns]

    # Filter equity series only
    df = df[df["SERIES"].str.strip() == "EQ"].copy()

    df = df.rename(columns={
        "SYMBOL":      "symbol",
        "OPEN_PRICE":  "open",
        "HIGH_PRICE":  "high",
        "LOW_PRICE":   "low",
        "CLOSE_PRICE": "close",
        "NET_TRDQTY":  "volume",
    })
    df["date"] = d
    df["symbol"] = df["symbol"].str.strip()

    return df[["date", "symbol", "open", "high", "low", "close", "volume"]].dropna(subset=["symbol", "close"])


def _fetch_delivery(client, d: date):
    """Download MTO delivery file — pipe-separated."""
    url = MTO_URL.format(ddmmyyyy=d.strftime("%d%m%Y"))   # 4-digit year
    resp = client.get(url)
    if resp.status_code in (404, 403):
        return None
    resp.raise_for_status()

    rows = []
    for line in resp.text.strip().splitlines():
        parts = line.split(",")
        if len(parts) < 7 or parts[0].strip() != "20":
            continue
        try:
            rows.append({
                "date":         d,
                "symbol":       parts[2].strip(),
                "delivery_qty": int(float(parts[5].strip())),
                "delivery_pct": float(parts[6].strip()),
            })
        except (ValueError, IndexError):
            continue

    return pd.DataFrame(rows) if rows else None


def run():
    last = last_synced_date(SOURCE_ID) or (date.today() - timedelta(days=DEFAULT_LOOKBACK_DAYS))
    today = last_business_day(date.today())
    days = business_days_between(last + timedelta(days=1), today)

    if not days:
        print(f"[{SOURCE_ID}] already up to date")
        return

    print(f"[{SOURCE_ID}] fetching {len(days)} days: {days[0]} → {days[-1]}")

    bhav_rows, deliv_rows, failed = [], [], []

    with get_client(timeout=60) as client:
        for d in days:
            try:
                bhav = _fetch_bhavcopy(client, d)
                if bhav is not None:
                    bhav_rows.append(bhav)

                deliv = _fetch_delivery(client, d)
                if deliv is not None:
                    deliv_rows.append(deliv)

            except Exception as e:
                failed.append(d)
                print(f"[{SOURCE_ID}] WARN {d}: {e}")

    count_bhav  = upsert_df(pd.concat(bhav_rows,  ignore_index=True), "stock_ohlcv")   if bhav_rows  else 0
    count_deliv = upsert_df(pd.concat(deliv_rows, ignore_index=True), "stock_delivery") if deliv_rows else 0

    status = "success" if not failed else "partial"
    log_sync(SOURCE_ID, status, count_bhav + count_deliv, days[-1])
    print(f"[{SOURCE_ID}] ohlcv={count_bhav} delivery={count_deliv}, up to {days[-1]}")


if __name__ == "__main__":
    run()
