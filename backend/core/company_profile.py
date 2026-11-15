"""Company profile (headquarters, sector, industry): parsing yfinance info and reading the table."""

from datetime import datetime

from backend.db.connection import df_to_records, get_db

# Yahoo spells some cities the old way; map them to the name the geocoder and the map use.
CITY_ALIASES = {
    "bangalore": "Bengaluru",
    "bombay": "Mumbai",
    "gurgaon": "Gurugram",
    "madras": "Chennai",
    "calcutta": "Kolkata",
    "baroda": "Vadodara",
    "poona": "Pune",
    "new bombay": "Navi Mumbai",
}

PROFILE_COLUMNS = [
    "symbol", "city", "state", "pincode", "sector", "industry",
    "website", "employees", "lat", "lon", "updated_at",
]


def normalise_city(city: str | None) -> str | None:
    """Trim, fix case and apply the alias list. Returns None for an empty value."""
    if not city or not str(city).strip():
        return None
    cleaned = " ".join(str(city).split())
    return CITY_ALIASES.get(cleaned.lower(), cleaned.title())


def _text(value) -> str | None:
    text = str(value).strip() if value is not None else ""
    return text or None


def profile_row(symbol: str, info: dict, now: datetime) -> dict:
    """One company_profile row from a yfinance `.info` dict; missing fields stay None.

    lat, lon and state are filled later from the city coordinates cache.
    """
    employees = info.get("fullTimeEmployees")
    return {
        "symbol": symbol.strip().upper(),
        "city": normalise_city(info.get("city")),
        "state": None,
        "pincode": _text(info.get("zip")),
        "sector": _text(info.get("sector")),
        "industry": _text(info.get("industry")),
        "website": _text(info.get("website")),
        "employees": int(employees) if isinstance(employees, (int, float)) else None,
        "lat": None,
        "lon": None,
        "updated_at": now,
    }


def get_profile(symbol: str) -> dict | None:
    """The stored profile for one symbol, or None when it has not been synced."""
    db = get_db()
    df = db.execute(
        f"SELECT {', '.join(PROFILE_COLUMNS)} FROM company_profile WHERE symbol = ?",
        [symbol.strip().upper()],
    ).df()
    records = df_to_records(df)
    return records[0] if records else None


def list_profiles(only_located: bool = False) -> list[dict]:
    """All stored profiles; with only_located, just those that have map coordinates."""
    db = get_db()
    where = "WHERE lat IS NOT NULL AND lon IS NOT NULL" if only_located else ""
    df = db.execute(
        f"SELECT {', '.join(PROFILE_COLUMNS)} FROM company_profile {where} ORDER BY symbol"
    ).df()
    return df_to_records(df)
