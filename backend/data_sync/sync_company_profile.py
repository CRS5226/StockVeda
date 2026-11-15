"""
Company profile for every actively traded stock: headquarters city, sector, industry.

Source: yfinance `.info` (city, zip, sector, industry, website, employees).
City coordinates come from Open-Meteo's free geocoder (one call per distinct city,
cached in city_coordinates), so ~2,000 companies need only ~100 geocoder calls.
Tables: company_profile, city_coordinates
"""

import logging
import time
from datetime import datetime, timedelta

import httpx
import pandas as pd
import yfinance as yf

from backend.core.company_profile import PROFILE_COLUMNS, profile_row
from backend.core.spot_prices import yahoo_ticker
from backend.data_sync.base import log_sync, upsert_df
from backend.db.connection import get_db

logger = logging.getLogger(__name__)

SOURCE_ID = "company_profile"
GEOCODE_URL = "https://geocoding-api.open-meteo.com/v1/search"
MAX_PER_RUN = 150          # profiles per run; the rest follow on the next runs
REFRESH_DAYS = 90          # a stored profile is refetched after this long
PAUSE_SECONDS = 0.6        # between yfinance calls
GEOCODE_PAUSE_SECONDS = 0.3


def symbols_to_fetch(limit: int, now: datetime) -> list[str]:
    """Traded symbols with no profile or a stale one, most traded first, never-fetched before stale."""
    db = get_db()
    rows = db.execute("""
        WITH traded AS (
            SELECT symbol, SUM(close * volume) AS value
            FROM stock_ohlcv
            WHERE date >= (SELECT MAX(date) FROM stock_ohlcv) - INTERVAL 30 DAY
            GROUP BY symbol
        )
        SELECT t.symbol
        FROM traded t
        LEFT JOIN company_profile p ON p.symbol = t.symbol
        WHERE p.symbol IS NULL OR p.updated_at < ?
        ORDER BY (p.symbol IS NOT NULL), t.value DESC NULLS LAST
        LIMIT ?
    """, [now - timedelta(days=REFRESH_DAYS), limit]).fetchall()
    return [r[0] for r in rows]


def geocode_city(client: httpx.Client, city: str) -> dict | None:
    """Coordinates and state for an Indian city, or None when the geocoder has no match."""
    resp = client.get(GEOCODE_URL, params={"name": city, "count": 1, "country_code": "IN", "language": "en"})
    resp.raise_for_status()
    results = resp.json().get("results") or []
    if not results:
        return None
    top = results[0]
    return {"lat": top.get("latitude"), "lon": top.get("longitude"), "state": top.get("admin1")}


def _cities_to_geocode() -> list[str]:
    db = get_db()
    rows = db.execute("""
        SELECT DISTINCT p.city FROM company_profile p
        LEFT JOIN city_coordinates c ON c.city = p.city
        WHERE p.city IS NOT NULL AND c.city IS NULL
        ORDER BY p.city
    """).fetchall()
    return [r[0] for r in rows]


def fill_coordinates() -> int:
    """Geocode cities not cached yet, then copy lat, lon and state onto the profiles."""
    cities = _cities_to_geocode()
    found = 0
    if cities:
        rows = []
        with httpx.Client(timeout=20) as client:
            for city in cities:
                try:
                    hit = geocode_city(client, city)
                except Exception as e:
                    # Not cached, so the city is tried again next run.
                    logger.warning("Geocoding %s failed: %s", city, e)
                    continue
                # A city with no match is cached with empty coordinates so it is not retried every run.
                rows.append({"city": city, "state": (hit or {}).get("state"),
                             "lat": (hit or {}).get("lat"), "lon": (hit or {}).get("lon")})
                found += hit is not None
                time.sleep(GEOCODE_PAUSE_SECONDS)
        if rows:
            upsert_df(pd.DataFrame(rows, columns=["city", "state", "lat", "lon"]), "city_coordinates")
    get_db().execute("""
        UPDATE company_profile
        SET lat = c.lat, lon = c.lon, state = c.state
        FROM city_coordinates c
        WHERE company_profile.city = c.city
    """)
    return found


def run(limit: int = MAX_PER_RUN) -> int:
    """Fetch up to `limit` profiles, then geocode new cities. Returns the profiles stored."""
    now = datetime.now()
    symbols = symbols_to_fetch(limit, now)
    if not symbols:
        print(f"[{SOURCE_ID}] all profiles are up to date")
        fill_coordinates()
        return 0

    print(f"[{SOURCE_ID}] fetching {len(symbols)} profiles")
    rows, failed = [], []
    for sym in symbols:
        try:
            info = yf.Ticker(yahoo_ticker(sym)).info or {}
            rows.append(profile_row(sym, info, now))
        except Exception as e:
            # Not stored, so it is retried next run.
            failed.append(sym)
            logger.warning("Profile fetch failed for %s: %s", sym, e)
        time.sleep(PAUSE_SECONDS)

    stored = 0
    if rows:
        # Written after the loop so the DB is not touched per symbol; the cap keeps a run short.
        stored = upsert_df(pd.DataFrame(rows)[PROFILE_COLUMNS], "company_profile")
    fill_coordinates()
    status = "partial" if failed else "success"
    log_sync(SOURCE_ID, status, stored, now.date(), f"failed: {', '.join(failed[:20])}" if failed else None)
    print(f"[{SOURCE_ID}] stored {stored} profiles, {len(failed)} failed")
    return stored


if __name__ == "__main__":
    run()
