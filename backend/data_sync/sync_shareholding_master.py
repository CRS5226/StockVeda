"""
Shareholding sync via NSE master API + XBRL files.
No session cookies needed — uses nsearchives.nseindia.com static files.

Step 1: GET /api/corporate-share-holdings-master → bulk promoter % for all stocks
Step 2: For each stock with XBRL link → parse FII/DII/MF breakdown
"""
import time
import httpx
import xml.etree.ElementTree as ET
from datetime import date
from backend.db.connection import get_db
from backend.data_sync.base import log_sync

SOURCE_ID   = "nse_shareholding_master"
MASTER_URL  = "https://www.nseindia.com/api/corporate-share-holdings-master"
HEADERS     = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
               "Accept": "application/json, text/plain, */*"}
XBRL_NS     = "http://www.bseindia.com/xbrl/shp/2025-10-31/in-bse-shp"
SLEEP_XBRL  = 0.3   # seconds between XBRL downloads

# XBRL context → shareholding table column
XBRL_CTX_MAP = {
    "ShareholdingOfPromoterAndPromoterGroup_ContextI": "promoter_pct",
    "InstitutionsForeign_ContextI":                    "fii_pct",
    "InstitutionsDomestic_ContextI":                   "dii_pct",
    "MutualFundsOrUTI_ContextI":                       "mf_pct",
    "NonInstitutions_ContextI":                        "retail_pct",
    "Governments_ContextI":                            "government_pct",
}
PCT_TAG = f"{{{XBRL_NS}}}ShareholdingAsAPercentageOfTotalNumberOfShares"


def _parse_xbrl(xml_text: str) -> dict:
    """Parse XBRL and return {column: float_pct} dict."""
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError:
        return {}
    result = {}
    for el in root:
        ctx = el.get("contextRef", "")
        col = XBRL_CTX_MAP.get(ctx)
        if col and el.tag == PCT_TAG and el.text:
            try:
                result[col] = round(float(el.text) * 100, 2)
            except ValueError:
                pass
    return result


def run(index: str = "equities", parse_xbrl: bool = True, limit: int = 0):
    """
    index: 'equities' or 'sme'
    parse_xbrl: if True, download each stock's XBRL for FII/DII breakdown
    limit: 0 = all stocks
    """
    client = httpx.Client(headers=HEADERS, timeout=30, follow_redirects=True)

    print(f"[{SOURCE_ID}] Fetching master shareholding list ({index})...")
    resp = client.get(MASTER_URL, params={"index": index})
    resp.raise_for_status()
    records = resp.json()
    print(f"[{SOURCE_ID}] Got {len(records)} records")

    if limit:
        records = records[:limit]

    rows = []
    failed = 0

    for i, rec in enumerate(records):
        sym = rec.get("symbol", "").strip()
        if not sym:
            continue

        try:
            period = date.fromisoformat(
                rec["date"].split()[0]  # "31-MAR-2026" → need conversion
                if "-" not in rec.get("date", "")
                else _convert_date(rec.get("date", ""))
            )
        except Exception:
            period = date.today()

        promoter = _safe_float(rec.get("pr_and_prgrp"))
        retail   = _safe_float(rec.get("public_val"))

        row = {
            "symbol":        sym,
            "period":        period,
            "promoter_pct":  promoter,
            "retail_pct":    retail,
            "fii_pct":       None,
            "dii_pct":       None,
            "mf_pct":        None,
            "government_pct": None,
            "promoter_pledge_pct": None,
        }

        # Parse XBRL for detailed breakdown
        if parse_xbrl and rec.get("xbrl"):
            try:
                xbrl_resp = client.get(rec["xbrl"])
                if xbrl_resp.status_code == 200:
                    parsed = _parse_xbrl(xbrl_resp.text)
                    row.update(parsed)
                time.sleep(SLEEP_XBRL)
            except Exception as e:
                failed += 1
                if failed <= 5:
                    print(f"[{SOURCE_ID}] WARN XBRL {sym}: {e}")

        rows.append(row)

        if (i + 1) % 100 == 0:
            print(f"[{SOURCE_ID}] {i+1}/{len(records)} processed ({failed} XBRL fails)...")

    if not rows:
        print(f"[{SOURCE_ID}] No rows to insert")
        return

    db = get_db()
    db.executemany("""
        INSERT OR REPLACE INTO shareholding
            (symbol, period, promoter_pct, promoter_pledge_pct, fii_pct, dii_pct,
             mf_pct, retail_pct, government_pct)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, [
        (r["symbol"], r["period"], r["promoter_pct"], r["promoter_pledge_pct"],
         r["fii_pct"], r["dii_pct"], r["mf_pct"], r["retail_pct"], r["government_pct"])
        for r in rows
    ])
    log_sync(SOURCE_ID, "success", len(rows), date.today())
    print(f"[{SOURCE_ID}] Done: {len(rows)} symbols, {failed} XBRL failures")


def run_fast(index: str = "equities"):
    """Quick sync — master API only (promoter + public %, no XBRL). ~5 seconds."""
    run(index=index, parse_xbrl=False)


def _safe_float(val) -> float | None:
    try:
        return float(val) if val is not None else None
    except (ValueError, TypeError):
        return None


def _convert_date(s: str) -> str:
    """'31-MAR-2026' → '2026-03-31'"""
    months = {"JAN":"01","FEB":"02","MAR":"03","APR":"04","MAY":"05","JUN":"06",
              "JUL":"07","AUG":"08","SEP":"09","OCT":"10","NOV":"11","DEC":"12"}
    parts = s.strip().upper().split("-")
    if len(parts) == 3:
        d, m, y = parts
        return f"{y}-{months.get(m, '01')}-{d.zfill(2)}"
    return s


if __name__ == "__main__":
    import sys
    fast = "--fast" in sys.argv
    if fast:
        run_fast()
    else:
        run()
