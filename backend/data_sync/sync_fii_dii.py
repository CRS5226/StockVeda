"""
FII/DII daily flows from NSE API.
Source: nseindia.com/api/fiidiiTradeReact
Note: API only returns the latest trading day — run daily via cron.
Table: fii_dii_flows
"""

from datetime import date
import pandas as pd
from backend.data_sync.base import log_sync, upsert_df, last_synced_date
from backend.data_sync.nse_session import nse_get

SOURCE_ID = "nse_fii_dii"
API_URL = "https://www.nseindia.com/api/fiidiiTradeReact"


def run():
    resp = nse_get(API_URL)
    if resp.status_code != 200:
        log_sync(SOURCE_ID, "failed", 0, None, f"HTTP {resp.status_code}")
        print(f"[{SOURCE_ID}] FAILED: HTTP {resp.status_code}")
        return

    data = resp.json()
    if not data:
        log_sync(SOURCE_ID, "failed", 0, None, "empty response")
        print(f"[{SOURCE_ID}] FAILED: empty response")
        return

    # Response: [{category: "DII", buyValue, sellValue, netValue, date}, {category: "FII/FPI", ...}]
    row = {"date": None, "fii_buy": None, "fii_sell": None, "fii_net": None,
           "dii_buy": None, "dii_sell": None, "dii_net": None}

    for entry in data:
        cat = entry.get("category", "")
        try:
            trade_date = pd.to_datetime(entry["date"], dayfirst=True).date()
            row["date"] = trade_date
            if "FII" in cat or "FPI" in cat:
                row["fii_buy"]  = float(entry["buyValue"])
                row["fii_sell"] = float(entry["sellValue"])
                row["fii_net"]  = float(entry["netValue"])
            elif "DII" in cat:
                row["dii_buy"]  = float(entry["buyValue"])
                row["dii_sell"] = float(entry["sellValue"])
                row["dii_net"]  = float(entry["netValue"])
        except (KeyError, ValueError):
            continue

    if row["date"] is None:
        log_sync(SOURCE_ID, "failed", 0, None, "could not parse date")
        print(f"[{SOURCE_ID}] FAILED: could not parse date")
        return

    last = last_synced_date(SOURCE_ID)
    if last and last >= row["date"]:
        print(f"[{SOURCE_ID}] already up to date ({row['date']})")
        return

    df = pd.DataFrame([row])
    count = upsert_df(df, "fii_dii_flows")
    log_sync(SOURCE_ID, "success", count, row["date"])
    print(f"[{SOURCE_ID}] inserted {count} row for {row['date']}: FII net={row['fii_net']} DII net={row['dii_net']}")


if __name__ == "__main__":
    run()
