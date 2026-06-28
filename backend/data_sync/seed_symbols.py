"""Seed nse_symbols table from NSE equity master list."""
import httpx
import csv
import io
from backend.db.connection import get_db

URL = "https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv"
HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}


def run():
    print("Downloading NSE equity master list...")
    resp = httpx.get(URL, headers=HEADERS, timeout=30, follow_redirects=True)
    if resp.status_code != 200:
        print(f"Failed: HTTP {resp.status_code}")
        return

    reader = csv.DictReader(io.StringIO(resp.text))
    rows = []
    for row in reader:
        sym    = row.get("SYMBOL", "").strip()
        name   = row.get("NAME OF COMPANY", "").strip()
        series = row.get(" SERIES", row.get("SERIES", "")).strip()
        isin   = row.get("ISIN NUMBER", "").strip()
        fv_raw = row.get(" FACE VALUE", row.get("FACE VALUE", "")).strip()
        try:
            face_value = float(fv_raw) if fv_raw else None
        except ValueError:
            face_value = None
        if sym and series == "EQ":
            rows.append((sym, name, series, isin, face_value))

    db = get_db()
    # Add face_value column if it doesn't exist yet (idempotent migration)
    try:
        db.execute("ALTER TABLE nse_symbols ADD COLUMN face_value DOUBLE")
    except Exception:
        pass
    db.execute("DELETE FROM nse_symbols")
    db.executemany(
        "INSERT OR REPLACE INTO nse_symbols (symbol, company_name, series, isin, face_value) VALUES (?, ?, ?, ?, ?)",
        rows
    )
    print(f"Seeded {len(rows)} NSE equity symbols.")


if __name__ == "__main__":
    run()
