"""
URL health checker for all StockVeda data sources.
Reads data/sources/data_sources.json, tests each URL, writes results to
data/sources/source_status.json.

Usage:
    python scripts/check_sources.py
    python scripts/check_sources.py --category micro
    python scripts/check_sources.py --subcategory price
"""

import json
import sys
import argparse
from pathlib import Path
from datetime import date, timedelta
import httpx

ROOT = Path(__file__).parent.parent
SOURCES_FILE = ROOT / "data/sources/data_sources.json"
STATUS_FILE = ROOT / "data/sources/source_status.json"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.5",
    "Accept-Encoding": "gzip, deflate, br",
    "Connection": "keep-alive",
}

TIMEOUT = 30

# NSE (archives.nseindia.com and nseindia.com) uses Akamai bot protection.
# Returns 503 from cloud/non-Indian IPs. Run this script from your local
# machine (Indian IP) for accurate NSE results.
# RBI DBIE (dbie.rbi.org.in) has an SSL hostname mismatch — use verify=False.
# AMFI portal URL: portal.amfiindia.com (old amfiindia.com/research URLs return 404).


def last_business_day(d: date) -> date:
    """Return most recent weekday on or before d."""
    while d.weekday() >= 5:
        d -= timedelta(days=1)
    return d


def resolve_url(url_template: str) -> str:
    """Substitute date placeholders with the most recent business day."""
    d = last_business_day(date.today() - timedelta(days=1))
    return (
        url_template
        .replace("{YYYY}", d.strftime("%Y"))
        .replace("{MMM}", d.strftime("%b").upper())
        .replace("{DD}", d.strftime("%d"))
        .replace("{DDMMYYYY}", d.strftime("%d%m%Y"))
        .replace("{SYMBOL}", "RELIANCE")
    )


def check_url(source: dict) -> dict:
    source_id = source["id"]

    if source.get("needs_session"):
        print(f"  SKIP  {source_id}  (needs NSE session cookies)")
        return {**source, "status": "needs_session", "http_code": None, "note": "requires cookie-based session"}

    url = resolve_url(source["url_template"])

    try:
        with httpx.Client(headers=HEADERS, timeout=TIMEOUT, follow_redirects=True) as client:
            resp = client.head(url)

            if resp.status_code == 405:
                resp = client.get(url)

        code = resp.status_code

        if code in (200, 206):
            status = "ok"
            symbol = "  OK  "
        elif code in (301, 302, 303, 307, 308):
            status = "redirect"
            symbol = "  >>  "
        elif code == 403:
            status = "blocked"
            symbol = "  403 "
        elif code == 404:
            status = "not_found"
            symbol = "  404 "
        else:
            status = "error"
            symbol = f" {code} "

        print(f"{symbol}  {source_id}  →  {url[:80]}")
        return {**source, "status": status, "http_code": code, "resolved_url": url}

    except httpx.TimeoutException:
        print(f" TOUT  {source_id}")
        return {**source, "status": "timeout", "http_code": None, "resolved_url": url}
    except Exception as e:
        print(f"  ERR  {source_id}  —  {e}")
        return {**source, "status": "error", "http_code": None, "note": str(e)}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--category", help="Filter by category: micro | macro")
    parser.add_argument("--subcategory", help="Filter by subcategory")
    args = parser.parse_args()

    with open(SOURCES_FILE) as f:
        data = json.load(f)

    sources = data["sources"]

    if args.category:
        sources = [s for s in sources if s["category"] == args.category]
    if args.subcategory:
        sources = [s for s in sources if s["subcategory"] == args.subcategory]

    print(f"\nChecking {len(sources)} sources...\n")
    print(f"{'Status':<8}  {'Source ID':<40}  URL")
    print("-" * 90)

    results = []
    ok = blocked = skipped = error = 0

    for source in sources:
        result = check_url(source)
        results.append(result)

        s = result["status"]
        if s == "ok":
            ok += 1
        elif s in ("blocked", "not_found", "error", "timeout"):
            error += 1
        elif s == "needs_session":
            skipped += 1
        elif s == "redirect":
            ok += 1

    print("\n" + "=" * 90)
    print(f"Results: {ok} ok  |  {skipped} needs-session (skip)  |  {error} blocked/error")

    STATUS_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(STATUS_FILE, "w") as f:
        json.dump({"sources": results}, f, indent=2)

    print(f"\nSaved → {STATUS_FILE}\n")


if __name__ == "__main__":
    main()
