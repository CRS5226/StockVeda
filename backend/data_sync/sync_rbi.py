"""
RBI reference rates (USD/INR, EUR/INR, GBP/INR, JPY/INR) and policy rates.
Source: rbi.org.in/Scripts/ReferenceRateArchive.aspx (ASP.NET form POST)
Table: currency_ohlcv (reference rates as close price), rbi_rates

Note: RBI website returns 418 from cloud IPs (bot protection).
      Run on local Indian IP. sync_currency.py (yfinance) is the always-on fallback.
"""

import re
from datetime import date, timedelta
import pandas as pd
from bs4 import BeautifulSoup
from backend.data_sync.base import log_sync, upsert_df, last_synced_date, get_client, last_business_day

SOURCE_ID   = "rbi_reference_rates"
RBI_URL     = "https://www.rbi.org.in/Scripts/ReferenceRateArchive.aspx"
DEFAULT_START = date(2015, 1, 1)

CURRENCY_MAP = {
    "USD": "USDINR",
    "EUR": "EURINR",
    "GBP": "GBPINR",
    "JPY": "JPYINR",
}

RBI_HEADERS = {
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120",
    "Accept": "text/html,application/xhtml+xml,*/*",
    "Accept-Encoding": "gzip, deflate",
    "Referer": "https://www.rbi.org.in/",
    "Content-Type": "application/x-www-form-urlencoded",
}


def _get_viewstate(client) -> dict:
    r = client.get(RBI_URL)
    soup = BeautifulSoup(r.text, "lxml")
    fields = {}
    for name in ["__VIEWSTATE", "__VIEWSTATEGENERATOR", "__EVENTVALIDATION"]:
        el = soup.find("input", {"name": name})
        if el:
            fields[name] = el.get("value", "")
    return fields


def _fetch_rates(client, from_date: date, to_date: date, currency: str) -> list[dict]:
    vs = _get_viewstate(client)
    if not vs:
        return []

    payload = {
        **vs,
        "ddlCurrency":  currency,
        "txtFromDate":  from_date.strftime("%d-%m-%Y"),
        "txtToDate":    to_date.strftime("%d-%m-%Y"),
        "btnSearch":    "Search",
    }
    r = client.post(RBI_URL, data=payload)
    if r.status_code != 200:
        raise RuntimeError(f"POST returned {r.status_code}")

    soup = BeautifulSoup(r.text, "lxml")
    rows = []
    for table in soup.find_all("table"):
        tr_list = table.find_all("tr")
        if len(tr_list) < 2:
            continue
        for tr in tr_list[1:]:
            cells = [td.get_text(strip=True) for td in tr.find_all("td")]
            if len(cells) < 2:
                continue
            try:
                d = pd.to_datetime(cells[0], dayfirst=True).date()
                rate = float(cells[1].replace(",", ""))
                rows.append({"date": d, "pair": CURRENCY_MAP[currency], "close": rate,
                             "open": rate, "high": rate, "low": rate})
            except (ValueError, IndexError):
                continue
    return rows


def run():
    last = last_synced_date(SOURCE_ID) or DEFAULT_START
    today = last_business_day(date.today())
    start = last + timedelta(days=1)

    if start > today:
        print(f"[{SOURCE_ID}] already up to date")
        return

    print(f"[{SOURCE_ID}] fetching {start} → {today}")
    print(f"[{SOURCE_ID}] NOTE: returns 418 from cloud IPs — run on local machine")

    all_rows, failed = [], []

    with get_client(timeout=30) as client:
        client.headers.update(RBI_HEADERS)
        for currency in CURRENCY_MAP:
            try:
                rows = _fetch_rates(client, start, today, currency)
                if rows:
                    all_rows.extend(rows)
                    print(f"[{SOURCE_ID}] {currency}: {len(rows)} rows")
                else:
                    print(f"[{SOURCE_ID}] {currency}: no rows (check if site returned 418)")
            except Exception as e:
                failed.append(currency)
                print(f"[{SOURCE_ID}] WARN {currency}: {e}")

    if not all_rows:
        log_sync(SOURCE_ID, "failed", 0, last, f"no data — likely bot-blocked; {failed}")
        print(f"[{SOURCE_ID}] FAILED — run on local Indian IP")
        return

    df = pd.DataFrame(all_rows)
    count = upsert_df(df, "currency_ohlcv")
    status = "success" if not failed else "partial"
    log_sync(SOURCE_ID, status, count, today)
    print(f"[{SOURCE_ID}] inserted {count} rows")


if __name__ == "__main__":
    run()
