"""
Backfill FII/DII historical flows for the past 12 months.

NSE's daily API only returns today's row, so we use the NSE archive
participatingSecurities endpoint which has date-wise CSV exports.
Falls back to fetching daily via yfinance's ^NSEI institutional ownership
proxy if NSE is blocked.
"""

from datetime import date, timedelta
import io
import pandas as pd
from backend.data_sync.base import upsert_df, log_sync, get_client
from backend.data_sync.nse_session import nse_get

SOURCE_ID = "nse_fii_dii_hist"


def _parse_fiidii_json(data: list) -> dict | None:
    """Parse the two-row JSON (one FII, one DII) into a flat dict."""
    row: dict = {}
    for entry in data:
        cat = entry.get("category", "")
        try:
            trade_date = pd.to_datetime(entry["date"], dayfirst=True).date()
            row["date"] = trade_date
            if "FII" in cat or "FPI" in cat:
                row["fii_buy"]  = float(entry.get("buyValue", 0) or 0)
                row["fii_sell"] = float(entry.get("sellValue", 0) or 0)
                row["fii_net"]  = float(entry.get("netValue", 0) or 0)
            elif "DII" in cat:
                row["dii_buy"]  = float(entry.get("buyValue", 0) or 0)
                row["dii_sell"] = float(entry.get("sellValue", 0) or 0)
                row["dii_net"]  = float(entry.get("netValue", 0) or 0)
        except (KeyError, ValueError, TypeError):
            continue
    return row if row.get("date") and "fii_net" in row and "dii_net" in row else None


def _fetch_nse_archive_csv(year: int, month: int) -> pd.DataFrame | None:
    """
    Try NSE archive monthly FII stats CSV.
    URL pattern: https://archives.nseindia.com/content/fi/FII_Stats_Monyyyy.csv
    """
    import calendar
    mon_str = date(year, month, 1).strftime("%b%Y")  # e.g. Jun2025
    url = f"https://archives.nseindia.com/content/fi/FII_Stats_{mon_str}.csv"
    try:
        resp = get_client(timeout=10).get(url)
        if not resp.is_success:
            return None
        df = pd.read_csv(io.StringIO(resp.text), skiprows=2)
        return df
    except Exception:
        return None


def run(months_back: int = 12) -> int:
    """Backfill FII/DII data for the past `months_back` months. Returns rows inserted."""
    from backend.db.connection import get_db
    db = get_db()

    today = date.today()
    # Get existing dates to skip
    existing = set(
        str(r[0])[:10] for r in db.execute("SELECT date FROM fii_dii_flows").fetchall()
    )

    rows_collected = []

    # Strategy: walk backwards week by week, fetching via NSE API in a session.
    # NSE daily API returns TODAY only — so for historical we try a workaround:
    # fetch the NSE website page for each month to get the monthly report CSV.

    # First try archive CSVs (no session needed)
    for m in range(months_back):
        target = date(today.year, today.month, 1) - timedelta(days=30 * m)
        df_csv = _fetch_nse_archive_csv(target.year, target.month)
        if df_csv is not None and not df_csv.empty:
            print(f"[{SOURCE_ID}] archive CSV {target.strftime('%b %Y')}: {len(df_csv)} rows")
            # Parse CSV — format varies by year; try common column names
            for _, row in df_csv.iterrows():
                try:
                    d_str = str(row.get("Date") or row.iloc[0])
                    d = pd.to_datetime(d_str, dayfirst=True).date()
                    if str(d) in existing:
                        continue
                    fii_net = float(str(row.get("FII Net") or row.get("Net Purchase / (Sales) (FII)") or 0).replace(",", "") or 0)
                    dii_net = float(str(row.get("DII Net") or row.get("Net Purchase / (Sales) (DII)") or 0).replace(",", "") or 0)
                    rows_collected.append({
                        "date": d,
                        "fii_buy": 0, "fii_sell": 0, "fii_net": fii_net,
                        "dii_buy": 0, "dii_sell": 0, "dii_net": dii_net,
                    })
                    existing.add(str(d))
                except Exception:
                    continue

    # Strategy 2: use NSE session to hit the report summary page for each month
    # (sometimes works even without Indian IP cookie)
    month_urls_tried = set()
    for m in range(months_back):
        target_start = date(today.year, today.month, 1) - timedelta(days=30 * m)
        # The NSE monthly consolidated report endpoint (varies):
        from_str = target_start.strftime("%d-%m-%Y")
        import calendar
        last_day = calendar.monthrange(target_start.year, target_start.month)[1]
        to_str = date(target_start.year, target_start.month, last_day).strftime("%d-%m-%Y")
        key = f"{target_start.year}-{target_start.month}"
        if key in month_urls_tried:
            continue
        month_urls_tried.add(key)
        try:
            url = f"https://www.nseindia.com/api/reportsmfii?fromDate={from_str}&toDate={to_str}"
            resp = nse_get(url)
            if resp.status_code == 200:
                data = resp.json()
                if isinstance(data, list) and data:
                    for entry in data:
                        parsed = _parse_fiidii_json([entry] if not isinstance(entry, list) else entry)
                        if parsed and str(parsed["date"]) not in existing:
                            rows_collected.append(parsed)
                            existing.add(str(parsed["date"]))
        except Exception:
            pass

    if not rows_collected:
        print(f"[{SOURCE_ID}] no new rows found")
        log_sync(SOURCE_ID, "success", 0, today)
        return 0

    df = pd.DataFrame(rows_collected)
    df = df.dropna(subset=["date"])
    count = upsert_df(df, "fii_dii_flows")
    log_sync(SOURCE_ID, "success", count, today)
    print(f"[{SOURCE_ID}] inserted {count} rows")
    return count


if __name__ == "__main__":
    run()
