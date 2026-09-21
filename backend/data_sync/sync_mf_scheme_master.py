"""
AMFI mutual fund scheme master (fund house, category, plan, latest NAV).
Source: portal.amfiindia.com/spages/NAVAll.txt
Format: category/AMC section headers interleaved with semicolon-separated scheme rows.
Table: mf_scheme_master
"""

import pandas as pd
from backend.data_sync.base import log_sync, get_client
from backend.db.connection import get_db

SOURCE_ID = "mf_scheme_master"
NAV_ALL_URL = "https://portal.amfiindia.com/spages/NAVAll.txt"

_BUCKET_RULES = [
    ("Close Ended", "Closed-End & Interval"),
    ("Interval Fund", "Closed-End & Interval"),
    ("Solution Oriented", "Solution Oriented"),
    ("Equity Scheme", "Equity"),
    ("Debt Scheme", "Debt"),
    ("Hybrid Scheme", "Hybrid"),
    ("Index Fund", "Index & FoF"),
    ("Fund of Fund", "Index & FoF"),
    ("ETF", "Index & FoF"),
]


def _bucket_for(category: str) -> str:
    for needle, bucket in _BUCKET_RULES:
        if needle.lower() in category.lower():
            return bucket
    return "Other"


def _parse(text: str) -> pd.DataFrame:
    rows = []
    amc = None
    category = None
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        if ";" not in line:
            if "schemes" in line.lower() or "fund" in line.lower():
                if "(" in line and ")" in line:
                    category = line
                else:
                    amc = line
            continue
        parts = line.split(";")
        if len(parts) < 8 or not parts[0].strip().isdigit():
            continue
        scheme_code = parts[0].strip()
        isin = (parts[1].strip() or parts[2].strip() or None)
        if isin == "-":
            isin = None
        name = parts[3].strip()
        plan = parts[4].strip()
        option_type = parts[5].strip()
        try:
            nav = float(parts[6].strip())
        except ValueError:
            continue
        nav_date = pd.to_datetime(parts[7].strip(), dayfirst=True, errors="coerce")
        if pd.isna(nav_date):
            continue
        cat = category or "Uncategorized"
        rows.append({
            "scheme_code": scheme_code,
            "isin": isin,
            "scheme_name": name,
            "amc": amc or "Unknown",
            "category": cat,
            "bucket": _bucket_for(cat),
            "plan": plan,
            "option_type": option_type,
            "latest_nav": nav,
            "latest_nav_date": nav_date.date(),
        })
    return pd.DataFrame(rows)


def run():
    with get_client(timeout=60) as client:
        resp = client.get(NAV_ALL_URL)
        resp.raise_for_status()
        df = _parse(resp.text)

    if df.empty:
        log_sync(SOURCE_ID, "failed", 0, None, "no rows parsed")
        print(f"[{SOURCE_ID}] FAILED — no rows parsed")
        return

    db = get_db()
    db.register("_mf_master_tmp", df)
    db.execute("INSERT OR REPLACE INTO mf_scheme_master SELECT * FROM _mf_master_tmp")
    db.unregister("_mf_master_tmp")

    latest_date = df["latest_nav_date"].max()
    log_sync(SOURCE_ID, "success", len(df), latest_date)
    print(f"[{SOURCE_ID}] upserted {len(df)} schemes as of {latest_date}")


if __name__ == "__main__":
    run()
