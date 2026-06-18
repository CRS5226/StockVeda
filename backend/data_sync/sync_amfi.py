"""
AMFI mutual fund daily NAV data.
Source: portal.amfiindia.com/DownloadNAVHistoryReport_Po.aspx
Format: semicolon-separated, one row per scheme per date.
Table: mf_nav (added to schema)
Note: ~8500 schemes per day — fetching a date range downloads significant data.
"""

import io
from datetime import date, timedelta
import pandas as pd
from backend.data_sync.base import log_sync, upsert_df, last_synced_date, get_client, last_business_day

SOURCE_ID   = "amfi_nav"
NAV_URL     = "https://portal.amfiindia.com/DownloadNAVHistoryReport_Po.aspx"
NAV_HEADERS = {
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120",
    "Accept": "text/plain, */*",
    "Accept-Encoding": "gzip, deflate",
    "Referer": "https://portal.amfiindia.com/",
}
DEFAULT_START = date(2020, 1, 1)


def _parse_nav(text: str) -> pd.DataFrame:
    """Parse AMFI semicolon-delimited NAV text into a DataFrame."""
    header_cols = ["scheme_code", "scheme_name", "isin_growth", "isin_div", "nav", "repurchase", "sale", "date"]
    rows = []
    for line in text.splitlines():
        if ";" not in line or not line[0].isdigit():
            continue
        parts = line.split(";")
        if len(parts) < 8:
            continue
        try:
            nav_val = float(parts[4].strip()) if parts[4].strip() else None
            if nav_val is None:
                continue
            rows.append({
                "scheme_code": parts[0].strip(),
                "scheme_name": parts[1].strip()[:200],
                "isin":        (parts[2].strip() or parts[3].strip() or None),
                "nav":         nav_val,
                "date":        pd.to_datetime(parts[7].strip(), dayfirst=True).date(),
            })
        except (ValueError, IndexError):
            continue
    return pd.DataFrame(rows)


def run(days_per_batch: int = 7):
    last = last_synced_date(SOURCE_ID) or DEFAULT_START
    today = last_business_day(date.today())
    start = last + timedelta(days=1)

    if start > today:
        print(f"[{SOURCE_ID}] already up to date")
        return

    print(f"[{SOURCE_ID}] fetching {start} → {today}")

    all_rows, failed = [], []

    with get_client(timeout=60) as client:
        client.headers.update(NAV_HEADERS)
        d = start
        while d <= today:
            batch_end = min(d + timedelta(days=days_per_batch - 1), today)
            params = {
                "frmdt": d.strftime("%d-%b-%Y"),
                "todt":  batch_end.strftime("%d-%b-%Y"),
            }
            try:
                resp = client.get(NAV_URL, params=params)
                resp.raise_for_status()
                df = _parse_nav(resp.text)
                if not df.empty:
                    all_rows.append(df)
                    print(f"[{SOURCE_ID}] {d} → {batch_end}: {len(df)} rows")
            except Exception as e:
                failed.append(d)
                print(f"[{SOURCE_ID}] WARN {d}: {e}")
            d = batch_end + timedelta(days=1)

    if not all_rows:
        log_sync(SOURCE_ID, "failed", 0, last, f"{len(failed)} batch failures")
        print(f"[{SOURCE_ID}] FAILED — no NAV data fetched")
        return

    combined = pd.concat(all_rows, ignore_index=True)
    count = upsert_df(combined, "mf_nav")
    status = "success" if not failed else "partial"
    log_sync(SOURCE_ID, status, count, today)
    print(f"[{SOURCE_ID}] inserted {count} rows up to {today}")


if __name__ == "__main__":
    run()
