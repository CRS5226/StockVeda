"""
NSE session helper. NSE's API endpoints need session cookies set by the web UI.
Warm up by hitting a page that returns 200, then all API calls reuse those cookies.
Run scripts on a local Indian IP — Akamai blocks cloud server IPs.
"""

import time
import httpx

_WARMUP_URL = "https://www.nseindia.com/market-data/live-equity-market"
_BASE_HEADERS = {
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate",
    "Connection": "keep-alive",
    "Referer": "https://www.nseindia.com/",
}

_client: httpx.Client | None = None


def get_nse_client(timeout: int = 30) -> httpx.Client:
    """Return a warmed-up NSE session client (singleton per process)."""
    global _client
    if _client is None:
        _client = httpx.Client(headers=_BASE_HEADERS, timeout=timeout, follow_redirects=True)
        r = _client.get(_WARMUP_URL)
        if r.status_code not in (200, 301, 302):
            print(f"[nse_session] warmup returned {r.status_code} — session may be invalid on this IP")
        time.sleep(0.5)
    return _client


def nse_get(url: str, params: dict | None = None) -> httpx.Response:
    """GET an NSE API URL using the shared session."""
    client = get_nse_client()
    resp = client.get(url, params=params)
    if resp.status_code in (401, 403):
        # Session expired — rebuild once
        global _client
        _client = None
        client = get_nse_client()
        resp = client.get(url, params=params)
    return resp
