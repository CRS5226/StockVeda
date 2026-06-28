"""
Shareholding sync via NSE master API + XBRL files.
No session cookies needed — uses nsearchives.nseindia.com static files.

Step 1: GET /api/corporate-share-holdings-master → bulk promoter % for all stocks
Step 2: Parallel XBRL download → FII/DII/MF breakdown (~10–30 seconds for all)
"""
import httpx
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date
from backend.db.connection import get_db
from backend.data_sync.base import log_sync

SOURCE_ID  = "nse_shareholding_master"
MASTER_URL = "https://www.nseindia.com/api/corporate-share-holdings-master"
HEADERS    = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
              "Accept": "application/json, text/plain, */*"}
XBRL_NS    = "http://www.bseindia.com/xbrl/shp/2025-10-31/in-bse-shp"

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


def fetch_xbrl_for_symbol(xbrl_url: str) -> dict:
    """Download and parse a single XBRL file. Returns {} on failure."""
    try:
        r = httpx.get(xbrl_url, headers=HEADERS, timeout=15)
        return _parse_xbrl(r.text) if r.status_code == 200 else {}
    except Exception:
        return {}


def _record_to_base_row(rec: dict) -> dict:
    """Convert master API record to a base shareholding row."""
    try:
        period = date.fromisoformat(_convert_date(rec.get("date", "")))
    except Exception:
        period = date.today()
    return {
        "symbol":              rec.get("symbol", "").strip(),
        "period":              period,
        "promoter_pct":        _safe_float(rec.get("pr_and_prgrp")),
        "retail_pct":          _safe_float(rec.get("public_val")),
        "fii_pct":             None,
        "dii_pct":             None,
        "mf_pct":              None,
        "government_pct":      None,
        "promoter_pledge_pct": None,
        "xbrl_url":            rec.get("xbrl") or None,
    }


def _upsert_rows(rows: list[dict]):
    db = get_db()
    db.executemany("""
        INSERT OR REPLACE INTO shareholding
            (symbol, period, promoter_pct, promoter_pledge_pct, fii_pct, dii_pct,
             mf_pct, retail_pct, government_pct)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, [
        (r["symbol"], r["period"], r["promoter_pct"], r["promoter_pledge_pct"],
         r["fii_pct"], r["dii_pct"], r["mf_pct"], r["retail_pct"], r["government_pct"])
        for r in rows if r.get("symbol")
    ])


def run_parallel(index: str = "equities", workers: int = 20, limit: int = 0):
    """
    Full sync: master API → parallel XBRL downloads → DB upsert.
    ~10–30 seconds for all 2301 stocks with 20 workers.
    """
    client = httpx.Client(headers=HEADERS, timeout=30)

    print(f"[{SOURCE_ID}] Fetching master list ({index})...")
    resp = client.get(MASTER_URL, params={"index": index})
    resp.raise_for_status()
    records = resp.json()
    if limit:
        records = records[:limit]
    print(f"[{SOURCE_ID}] {len(records)} records, starting parallel XBRL ({workers} workers)...")

    base_rows = {rec["symbol"]: _record_to_base_row(rec) for rec in records if rec.get("symbol")}

    failed = 0
    done = 0

    def _fetch(sym_url):
        sym, url = sym_url
        return sym, fetch_xbrl_for_symbol(url) if url else {}

    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {
            pool.submit(_fetch, (sym, row["xbrl_url"])): sym
            for sym, row in base_rows.items()
        }
        for future in as_completed(futures):
            sym, parsed = future.result()
            if parsed:
                base_rows[sym].update(parsed)
            else:
                failed += 1
            done += 1
            if done % 200 == 0:
                print(f"[{SOURCE_ID}] {done}/{len(base_rows)} XBRL done ({failed} failed)...")

    rows = list(base_rows.values())
    _upsert_rows(rows)
    log_sync(SOURCE_ID, "success", len(rows), date.today())
    print(f"[{SOURCE_ID}] Done: {len(rows)} symbols, {failed} XBRL failures")


def run_fast(index: str = "equities"):
    """Quick sync — promoter + public % only (no XBRL). ~5 seconds."""
    client = httpx.Client(headers=HEADERS, timeout=30)
    resp = client.get(MASTER_URL, params={"index": index})
    resp.raise_for_status()
    records = resp.json()
    rows = [_record_to_base_row(r) for r in records if r.get("symbol")]
    _upsert_rows(rows)
    log_sync(SOURCE_ID, "success", len(rows), date.today())
    print(f"[{SOURCE_ID}] Fast sync done: {len(rows)} symbols")


def fetch_and_store_one(symbol: str) -> dict | None:
    """
    Fetch XBRL for a single symbol on-demand (called when user views a stock).
    Returns the parsed shareholding dict or None.
    """
    client = httpx.Client(headers=HEADERS, timeout=30)
    resp = client.get(MASTER_URL, params={"index": "equities"})
    if resp.status_code != 200:
        return None
    records = resp.json()
    rec = next((r for r in records if r.get("symbol") == symbol), None)
    if not rec:
        return None
    row = _record_to_base_row(rec)
    if rec.get("xbrl"):
        parsed = fetch_xbrl_for_symbol(rec["xbrl"])
        row.update(parsed)
    _upsert_rows([row])
    return row


def _safe_float(val) -> float | None:
    try:
        return float(val) if val is not None else None
    except (ValueError, TypeError):
        return None


def _convert_date(s: str) -> str:
    months = {"JAN":"01","FEB":"02","MAR":"03","APR":"04","MAY":"05","JUN":"06",
              "JUL":"07","AUG":"08","SEP":"09","OCT":"10","NOV":"11","DEC":"12"}
    parts = s.strip().upper().split("-")
    if len(parts) == 3:
        d, m, y = parts
        return f"{y}-{months.get(m, '01')}-{d.zfill(2)}"
    return s


if __name__ == "__main__":
    import sys
    if "--fast" in sys.argv:
        run_fast()
    else:
        run_parallel()
