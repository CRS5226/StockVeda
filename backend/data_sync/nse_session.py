"""
NSE session helper. NSE's API endpoints need session cookies set by the web UI.
Loads pre-authenticated cookies from cookies.txt (Netscape format) if available,
then warms up with an NSE page to acquire any missing session tokens.
"""

import os
import time
import httpx

_WARMUP_URL  = "https://www.nseindia.com/market-data/live-equity-market"
_WARMUP_URL2 = "https://www.nseindia.com/all-reports-derivatives"
_COOKIES_FILE = os.path.join(os.path.dirname(__file__), "..", "..", "cookies.txt")
_BASE_HEADERS = {
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate",
    "Connection": "keep-alive",
    "Referer": "https://www.nseindia.com/",
}

_client: httpx.Client | None = None


def _load_cookies_file(path: str) -> dict:
    """Parse Netscape cookie file into a dict."""
    cookies = {}
    try:
        with open(os.path.abspath(path)) as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                parts = line.split("\t")
                if len(parts) >= 7:
                    cookies[parts[5]] = parts[6]
    except FileNotFoundError:
        pass
    return cookies


def get_nse_client(timeout: int = 30) -> httpx.Client:
    """Return a warmed-up NSE session client (singleton per process)."""
    global _client
    if _client is None:
        saved = _load_cookies_file(_COOKIES_FILE)
        _client = httpx.Client(
            headers=_BASE_HEADERS, timeout=timeout, follow_redirects=True,
            cookies=saved if saved else None,
        )
        if saved:
            print(f"[nse_session] loaded {len(saved)} cookies from cookies.txt")
        # Always warm up to acquire nsit and any missing tokens
        _client.get(_WARMUP_URL)
        time.sleep(0.5)
        r = _client.get(_WARMUP_URL2)
        if r.status_code not in (200, 301, 302):
            print(f"[nse_session] warmup returned {r.status_code} — session may be invalid on this IP")
        time.sleep(0.3)
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
