"""
Bank financial results from NSE XBRL filings.
Source: nseindia.com/api/corporates-financial-results?symbol=X&period=Quarterly
XBRL files: nsearchives.nseindia.com/corporate/xbrl/BANKING_*.xml
"""
import httpx
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime
from backend.db.connection import get_db
from backend.data_sync.base import log_sync

SOURCE_ID   = "nse_bank_financials"
RESULTS_URL = "https://www.nseindia.com/api/corporates-financial-results"
HEADERS     = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
               "Accept": "application/json, text/plain, */*"}

# BANKING XBRL tag → our column (values are in full INR rupees)
XBRL_TAGS = {
    "InterestEarned":                                   "interest_earned",
    "InterestExpended":                                 "interest_expended",
    "OtherIncome":                                      "other_income",
    "Income":                                           "total_income",
    "OperatingExpenses":                                "operating_expenses",
    "OperatingProfitBeforeProvisionAndContingencies":   "ppop",
    "ProvisionsOtherThanTaxAndContingencies":           "provisions",
    "ProfitLossFromOrdinaryActivitiesBeforeTax":        "pbt",
    "TaxExpense":                                       "tax",
    "ProfitLossForThePeriod":                           "pat",
    "BasicEarningsPerShareAfterExtraordinaryItems":     "eps",
    "GrossNonPerformingAssets":                         "gnpa",
    "NonPerformingAssets":                              "net_npa",
    "PercentageOfGrossNpa":                             "gnpa_pct",
    "PercentageOfNpa":                                  "net_npa_pct",
    "CapitalAdequacyRatio":                             "crar_pct",
    "CET1Ratio":                                        "cet1_pct",
    "ReturnOnAssets":                                   "roa",
}

# Contexts: OneD = single quarter, FourD = YTD
CTX_PERIOD = {"OneD": "Q", "FourD": "YTD"}
# Tags where value is already a ratio/pct (no INR conversion needed)
RATIO_TAGS = {"gnpa_pct", "net_npa_pct", "crar_pct", "cet1_pct", "roa", "eps"}

NS_PREFIXES = [
    "http://www.bseindia.com/xbrl/fr/ind/2014-03-31/in-bse-fr-banking",
    "http://www.bseindia.com/xbrl/fr/ind/in-bse-fr-banking",
]


def _parse_banking_xbrl(xml_text: str, symbol: str) -> list[dict]:
    """Parse a BANKING XBRL file and return list of row dicts (one per context)."""
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError:
        return []

    # Detect NS prefix from root
    ns = next((p for p in NS_PREFIXES if p in xml_text), "")
    tag_prefix = f"{{{ns}}}" if ns else ""

    # Build context → period_type map
    ctx_period = {}
    for el in root:
        if "context" in el.tag.lower():
            ctx_id = el.get("id", "")
            for short, ptype in CTX_PERIOD.items():
                if short in ctx_id:
                    ctx_period[ctx_id] = ptype
                    break

    # Parse by context
    rows: dict[tuple, dict] = {}
    for el in root.iter():
        tag = el.tag.split("}")[-1] if "}" in el.tag else el.tag
        col = XBRL_TAGS.get(tag)
        if not col:
            continue
        ctx = el.get("contextRef", "")
        ptype = None
        for k, v in CTX_PERIOD.items():
            if k in ctx:
                ptype = v
                break
        if not ptype:
            continue
        if not el.text or not el.text.strip():
            continue
        try:
            val = float(el.text.strip())
        except ValueError:
            continue
        key = (ptype, "consolidated" if "Consolidat" in ctx or "FourD" not in ctx else "standalone")
        if key not in rows:
            rows[key] = {"period_type": ptype, "is_consolidated": "Consolidat" in ctx}
        if col in rows[key]:
            continue  # first wins for duplicates
        rows[key][col] = val

    result = []
    for row in rows.values():
        # Compute NII if not directly in XBRL
        if "interest_earned" in row and "interest_expended" in row:
            row["nii"] = row["interest_earned"] - row["interest_expended"]
        # gnpa_pct / net_npa_pct are stored as decimals (0.0357) — convert to %
        for col in ["gnpa_pct", "net_npa_pct", "crar_pct", "cet1_pct", "roa"]:
            if col in row and row[col] is not None and row[col] < 2:
                row[col] = round(row[col] * 100, 2)
        row["symbol"] = symbol
        result.append(row)
    return result


def _fetch_and_parse(symbol: str, xbrl_url: str, period_end: date, is_cons: bool) -> list[dict]:
    try:
        r = httpx.get(xbrl_url, headers=HEADERS, timeout=20)
        if r.status_code != 200:
            return []
        rows = _parse_banking_xbrl(r.text, symbol)
        for row in rows:
            row["period"] = period_end
            if "is_consolidated" not in row:
                row["is_consolidated"] = is_cons
        return rows
    except Exception:
        return []


def sync_symbol(symbol: str, client=None) -> int:
    """Sync bank financials for one symbol. Returns row count inserted."""
    if client is None:
        client = httpx.Client(headers=HEADERS, timeout=30)

    resp = client.get(RESULTS_URL, params={"index": "equities", "period": "Quarterly",
                                            "symbol": symbol})
    if resp.status_code != 200:
        return 0
    entries = resp.json()

    # Filter: banking XBRL only, no duplicates per period+type
    seen: set[tuple] = set()
    tasks = []
    for e in entries:
        xbrl = e.get("xbrl", "")
        if not xbrl.endswith(".xml") or "BANKING" not in xbrl:
            continue
        try:
            period_end = datetime.strptime(e["toDate"], "%d-%b-%Y").date()
        except (KeyError, ValueError):
            continue
        is_cons = "Consolidated" in e.get("consolidated", "")
        key = (period_end, is_cons)
        if key in seen:
            continue
        seen.add(key)
        tasks.append((xbrl, period_end, is_cons))

    if not tasks:
        return 0

    all_rows = []
    with ThreadPoolExecutor(max_workers=8) as pool:
        futures = {pool.submit(_fetch_and_parse, symbol, url, pe, ic): (pe, ic)
                   for url, pe, ic in tasks}
        for f in as_completed(futures):
            all_rows.extend(f.result())

    if not all_rows:
        return 0

    db = get_db()
    _ensure_table(db)
    db.executemany("""
        INSERT OR REPLACE INTO bank_financials
            (symbol, period, period_type, is_consolidated,
             interest_earned, interest_expended, nii, other_income, total_income,
             operating_expenses, ppop, provisions, pbt, tax, pat, eps,
             gnpa, net_npa, gnpa_pct, net_npa_pct, crar_pct, cet1_pct, roa)
        VALUES (?,?,?,?, ?,?,?,?,?, ?,?,?,?,?,?,?, ?,?,?,?,?,?,?)
    """, [
        (r.get("symbol"), r.get("period"), r.get("period_type"), r.get("is_consolidated"),
         r.get("interest_earned"), r.get("interest_expended"), r.get("nii"), r.get("other_income"),
         r.get("total_income"), r.get("operating_expenses"), r.get("ppop"), r.get("provisions"),
         r.get("pbt"), r.get("tax"), r.get("pat"), r.get("eps"),
         r.get("gnpa"), r.get("net_npa"), r.get("gnpa_pct"), r.get("net_npa_pct"),
         r.get("crar_pct"), r.get("cet1_pct"), r.get("roa"))
        for r in all_rows if r.get("symbol") and r.get("period") and r.get("period_type")
    ])
    return len(all_rows)


def _ensure_table(db):
    db.execute("""
        CREATE TABLE IF NOT EXISTS bank_financials (
            symbol VARCHAR, period DATE, period_type VARCHAR, is_consolidated BOOLEAN,
            interest_earned DOUBLE, interest_expended DOUBLE, nii DOUBLE,
            other_income DOUBLE, total_income DOUBLE, operating_expenses DOUBLE,
            ppop DOUBLE, provisions DOUBLE, pbt DOUBLE, tax DOUBLE, pat DOUBLE, eps DOUBLE,
            gnpa DOUBLE, net_npa DOUBLE, gnpa_pct DOUBLE, net_npa_pct DOUBLE,
            crar_pct DOUBLE, cet1_pct DOUBLE, roa DOUBLE,
            PRIMARY KEY (symbol, period, period_type, is_consolidated)
        )
    """)


def run(symbols: list[str] | None = None):
    """Sync bank financials for all known banking symbols (or a specific list)."""
    client = httpx.Client(headers=HEADERS, timeout=30)

    if symbols is None:
        # Detect banking symbols from NSE master list (bank flag = 'B')
        resp = client.get(RESULTS_URL, params={"index": "equities", "period": "Quarterly"})
        all_entries = resp.json()
        symbols = list({e["symbol"] for e in all_entries
                        if e.get("bank") == "B" and e.get("xbrl", "").endswith(".xml")})
        print(f"[{SOURCE_ID}] Detected {len(symbols)} banking symbols")

    total = 0
    for i, sym in enumerate(symbols):
        count = sync_symbol(sym, client=client)
        total += count
        if (i + 1) % 10 == 0:
            print(f"[{SOURCE_ID}] {i+1}/{len(symbols)} done ({total} rows)...")

    log_sync(SOURCE_ID, "success", total, date.today())
    print(f"[{SOURCE_ID}] Done: {total} rows across {len(symbols)} banks")


if __name__ == "__main__":
    import sys
    syms = sys.argv[1:] if len(sys.argv) > 1 else None
    run(syms)
