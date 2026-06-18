"""
NSE quarterly shareholding pattern per symbol.
Source: nseindia.com/api/corporate-shareHolding-with-equity?symbol={SYMBOL}
Requires a valid NSE session (run on local Indian IP).
Table: shareholding
"""

import time
from datetime import date
import pandas as pd
from backend.db.connection import get_db
from backend.data_sync.base import log_sync, upsert_df, last_synced_date
from backend.data_sync.nse_session import nse_get

SOURCE_ID = "nse_shareholding"
API_URL   = "https://www.nseindia.com/api/corporate-shareHolding-with-equity"


def _get_symbols() -> list[str]:
    db = get_db()
    rows = db.execute("SELECT DISTINCT symbol FROM stock_ohlcv ORDER BY symbol").fetchall()
    return [r[0] for r in rows]


def _parse_category(categories: list[dict]) -> dict:
    """Extract promoter/FII/DII/MF/retail % from shareHolding category list."""
    out = {
        "promoter_pct":        None,
        "promoter_pledge_pct": None,
        "fii_pct":             None,
        "dii_pct":             None,
        "mf_pct":              None,
        "retail_pct":          None,
    }
    for cat in categories:
        name = (cat.get("category") or cat.get("name") or "").upper()
        pct_raw = cat.get("holdingPercentage") or cat.get("holdingPct") or cat.get("percentOfShare")
        try:
            pct = float(str(pct_raw).replace(",", ""))
        except (TypeError, ValueError):
            continue

        if "PROMOTER" in name and "PLEDGE" not in name:
            out["promoter_pct"] = pct
        elif "PLEDGE" in name:
            out["promoter_pledge_pct"] = pct
        elif "FPI" in name or "FII" in name:
            out["fii_pct"] = pct
        elif "MUTUAL" in name or "MF" in name:
            out["mf_pct"] = pct
        elif "INSURANCE" in name or "DII" in name:
            out["dii_pct"] = (out["dii_pct"] or 0) + pct
        elif "RETAIL" in name or "PUBLIC" in name:
            out["retail_pct"] = pct
    return out


def run():
    symbols = _get_symbols()
    if not symbols:
        print(f"[{SOURCE_ID}] no symbols in DB — run bhavcopy sync first")
        return

    last = last_synced_date(SOURCE_ID)
    print(f"[{SOURCE_ID}] fetching shareholding for {len(symbols)} symbols")

    rows, failed = [], []

    for sym in symbols:
        try:
            r = nse_get(API_URL, params={"symbol": sym, "index": "equities"})
            if r.status_code == 404:
                continue
            if r.status_code != 200:
                failed.append(sym)
                continue

            data = r.json()
            # Response shape varies — handle list or dict with shareholdingList
            entries = data if isinstance(data, list) else data.get("shareholdingList", data.get("data", []))
            if not entries:
                continue

            for entry in entries:
                try:
                    period_raw = entry.get("date") or entry.get("quarter") or entry.get("recordDate")
                    period = pd.to_datetime(period_raw, dayfirst=True).date()
                    categories = entry.get("shareHoldingList") or entry.get("categories") or []
                    pct = _parse_category(categories)
                    rows.append({"symbol": sym, "period": period, **pct})
                except Exception:
                    continue

        except Exception as e:
            failed.append(sym)
            print(f"[{SOURCE_ID}] WARN {sym}: {e}")

        time.sleep(0.3)

    if not rows:
        log_sync(SOURCE_ID, "failed", 0, last, f"no data; {len(failed)} failures")
        print(f"[{SOURCE_ID}] FAILED — no shareholding data returned")
        return

    df = pd.DataFrame(rows)
    count = upsert_df(df, "shareholding")
    log_sync(SOURCE_ID, "success" if not failed else "partial", count, date.today())
    print(f"[{SOURCE_ID}] inserted {count} rows ({len(failed)} symbols failed)")


if __name__ == "__main__":
    run()
