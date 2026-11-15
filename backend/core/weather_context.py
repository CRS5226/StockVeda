"""Weather at a company's headquarters city, with a neutral note on which sectors weather matters to.

This is context, not a forecast of the stock: a headquarters is a weak proxy for where plants,
mines, farms and customers are. The notes say what weather is typically relevant to a sector,
never what a company's results will do.
"""

from datetime import date

import pandas as pd

from backend.db.connection import df_to_records, get_db

# Daily thresholds, in the spirit of India Meteorological Department categories.
HEAVY_RAIN_MM = 64.5
HEAT_DAY_C = 40.0
STRONG_GUST_KMH = 60.0
FORECAST_DAYS = 7

DISCLAIMER = (
    "Weather at the headquarters city is a weak signal: plants, mines, farms and customers are often elsewhere. "
    "This is context only, not a forecast for the stock."
)

# (sector or industry keywords, lower case) -> note. The first rule whose keyword is found wins.
SECTOR_NOTES = [
    (("utilities", "power"), "Hot days lift electricity demand; heavy rain can disrupt coal supply and mining."),
    (("airlines", "airport", "air freight"), "Storms, fog and strong winds can delay or cancel flights."),
    (("engineering & construction", "building materials", "cement", "construction", "infrastructure"),
     "Heavy rain slows construction work and cement demand."),
    (("real estate",), "Heavy rain slows construction and site visits."),
    (("agricultur", "farm", "fertilizer", "pesticide", "sugar", "tea", "coffee"),
     "Rain and temperature matter for crop cycles and input demand."),
    (("steel", "aluminum", "copper", "metal", "mining", "coal"),
     "Heavy rain can interrupt mining and transport of raw materials."),
    (("beverages", "packaged foods", "household", "personal products", "confection"),
     "Hot weather can lift demand for cold drinks and ice cream; monsoon can affect distribution."),
    (("auto", "tires", "trucks"), "Heavy rain and flooding can affect showroom footfall and logistics."),
    (("oil & gas", "refining"), "Cyclones and storms can affect coastal ports and refineries."),
]


def sector_note(sector: str | None, industry: str | None) -> str | None:
    """A neutral one-line note for sectors where weather is typically relevant; None otherwise."""
    text = f"{sector or ''} {industry or ''}".lower()
    for keywords, note in SECTOR_NOTES:
        if any(k in text for k in keywords):
            return note
    return None


def summarise(days: list[dict]) -> dict:
    """Flags and totals for the forecast days (a list of {date, precip_mm, temp_max_c, wind_gust_kmh})."""
    def values(key):
        return [d[key] for d in days if d.get(key) is not None]

    rain, temp, gust = values("precip_mm"), values("temp_max_c"), values("wind_gust_kmh")
    flags = []
    if rain and max(rain) >= HEAVY_RAIN_MM:
        flags.append("heavy_rain")
    if temp and max(temp) >= HEAT_DAY_C:
        flags.append("heat")
    if gust and max(gust) >= STRONG_GUST_KMH:
        flags.append("strong_wind")
    return {
        "rain_total_mm": round(sum(rain), 1) if rain else None,
        "max_daily_rain_mm": max(rain) if rain else None,
        "max_temp_c": max(temp) if temp else None,
        "max_gust_kmh": max(gust) if gust else None,
        "flags": flags,
    }


def weather_context(symbol: str, today: date | None = None) -> dict | None:
    """Recent and coming weather for the symbol's headquarters city; None when the city or weather is unknown."""
    db = get_db()
    today = today or date.today()
    profile = db.execute(
        "SELECT city, sector, industry FROM company_profile WHERE symbol = ?", [symbol.strip().upper()]
    ).fetchone()
    if not profile or not profile[0]:
        return None
    city, sector, industry = profile
    df = db.execute("""
        SELECT date, precip_mm, temp_max_c, wind_gust_kmh, is_forecast FROM city_weather
        WHERE city = ? AND date >= ? ORDER BY date
    """, [city, today - pd.Timedelta(days=7)]).df()
    if df.empty:
        return None
    upcoming = df[df["date"].dt.date >= today].head(FORECAST_DAYS)
    return {
        "symbol": symbol.strip().upper(),
        "city": city,
        "sector": sector,
        "industry": industry,
        "daily": df_to_records(df),
        "summary": summarise(df_to_records(upcoming)),
        "sector_note": sector_note(sector, industry),
        "disclaimer": DISCLAIMER,
    }
