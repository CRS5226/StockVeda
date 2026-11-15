"""
Daily weather for the headquarters cities of listed companies, from Open-Meteo.

Free without a key for non-commercial use (see https://open-meteo.com/en/license). Cities, not
companies: about 100 cities cover every company. Several cities go in one request (the response
is a list in request order), 20 per call, sequentially. Each run refetches the last 7 days
and the next 7, so a forecast day is overwritten by the observed value once it has passed.
Table: city_weather
"""

import logging
import time
from datetime import date, datetime, timedelta

import httpx
import pandas as pd

from backend.data_sync.base import log_sync, upsert_df
from backend.db.connection import get_db

logger = logging.getLogger(__name__)

SOURCE_ID = "open_meteo_weather"
API_URL = "https://api.open-meteo.com/v1/forecast"
DAILY = "precipitation_sum,temperature_2m_max,wind_gusts_10m_max"
BATCH_SIZE = 20
PAST_DAYS, FORECAST_DAYS = 7, 7
MIN_HOURS_BETWEEN_RUNS = 3   # weather barely changes faster than this, and the API is free: be polite
PAUSE_SECONDS = 1.0
COLUMNS = ["city", "date", "precip_mm", "temp_max_c", "wind_gust_kmh", "is_forecast"]


def cities_with_coordinates() -> list[tuple[str, float, float]]:
    """Cities that have a company and a geocoded position."""
    rows = get_db().execute("""
        SELECT DISTINCT c.city, c.lat, c.lon FROM city_coordinates c
        JOIN company_profile p ON p.city = c.city
        WHERE c.lat IS NOT NULL AND c.lon IS NOT NULL
        ORDER BY c.city
    """).fetchall()
    return [(r[0], r[1], r[2]) for r in rows]


def parse_response(cities: list[str], payload, today: date) -> pd.DataFrame:
    """Open-Meteo daily arrays -> city_weather rows. One city comes back as a dict, several as a list."""
    results = payload if isinstance(payload, list) else [payload]
    if len(results) != len(cities):
        raise ValueError(f"expected {len(cities)} locations, got {len(results)}")
    rows = []
    for city, result in zip(cities, results):
        daily = result.get("daily") or {}
        for i, day in enumerate(daily.get("time") or []):
            d = date.fromisoformat(day)
            rows.append({
                "city": city,
                "date": d,
                "precip_mm": _at(daily, "precipitation_sum", i),
                "temp_max_c": _at(daily, "temperature_2m_max", i),
                "wind_gust_kmh": _at(daily, "wind_gusts_10m_max", i),
                "is_forecast": d > today,
            })
    return pd.DataFrame(rows, columns=COLUMNS)


def _at(daily: dict, key: str, i: int) -> float | None:
    values = daily.get(key) or []
    return values[i] if i < len(values) else None


def _ran_recently(now: datetime) -> bool:
    row = get_db().execute("SELECT last_synced_at FROM sync_log WHERE source = ? AND status <> 'failed'", [SOURCE_ID]).fetchone()
    return bool(row and row[0] and now - row[0] < timedelta(hours=MIN_HOURS_BETWEEN_RUNS))


def run(force: bool = False) -> int:
    """Fetch weather for all headquarters cities. Returns the rows stored."""
    now = datetime.now()
    if not force and _ran_recently(now):
        print(f"[{SOURCE_ID}] fetched less than {MIN_HOURS_BETWEEN_RUNS} hours ago, skipping")
        return 0
    cities = cities_with_coordinates()
    if not cities:
        print(f"[{SOURCE_ID}] no geocoded cities yet; run the company_profile sync first")
        return 0

    stored, failed = 0, []
    with httpx.Client(timeout=30) as client:
        for i in range(0, len(cities), BATCH_SIZE):
            batch = cities[i:i + BATCH_SIZE]
            names = [c[0] for c in batch]
            try:
                resp = client.get(API_URL, params={
                    "latitude": ",".join(str(c[1]) for c in batch),
                    "longitude": ",".join(str(c[2]) for c in batch),
                    "daily": DAILY, "past_days": PAST_DAYS, "forecast_days": FORECAST_DAYS,
                    "timezone": "Asia/Kolkata",
                })
                resp.raise_for_status()
                df = parse_response(names, resp.json(), now.date())
            except Exception as e:
                # Nothing stored for this batch; it is fetched again next run.
                failed.extend(names)
                logger.warning("Weather fetch failed for %s..: %s", names[0], e)
                time.sleep(PAUSE_SECONDS)
                continue
            stored += upsert_df(df, "city_weather")
            time.sleep(PAUSE_SECONDS)

    if stored == 0 and failed:
        log_sync(SOURCE_ID, "failed", 0, now.date(), f"all {len(failed)} cities failed")
        return 0
    log_sync(SOURCE_ID, "partial" if failed else "success", stored, now.date(),
             f"failed: {', '.join(failed[:20])}" if failed else None)
    print(f"[{SOURCE_ID}] stored {stored} rows for {len(cities) - len(failed)} cities")
    return stored


if __name__ == "__main__":
    run()
