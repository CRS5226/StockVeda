"""Full NAV history of one mutual fund scheme from mfapi.in, cached in mf_nav. Fetched on demand, one scheme at a time."""

from typing import Optional

import pandas as pd

from backend.data_sync.base import get_client
from backend.db.connection import get_db

_MFAPI_URL = "https://api.mfapi.in/mf/{code}"


def backfill_nav(scheme_code: str, scheme_name: str, isin: Optional[str]) -> int:
    """Pull the NAV history of a scheme and store it. Returns the rows stored, 0 when the source has nothing or fails."""
    try:
        with get_client(timeout=30) as client:
            resp = client.get(_MFAPI_URL.format(code=scheme_code))
            resp.raise_for_status()
            payload = resp.json()
    except Exception:
        return 0

    data = payload.get("data") or []
    if not data:
        return 0

    df = pd.DataFrame(data)
    df["date"] = pd.to_datetime(df["date"], format="%d-%m-%Y", errors="coerce").dt.date
    df["nav"] = pd.to_numeric(df["nav"], errors="coerce")
    df = df.dropna(subset=["date", "nav"])
    df["scheme_code"] = scheme_code
    df["scheme_name"] = scheme_name
    df["isin"] = isin
    df = df[["date", "scheme_code", "scheme_name", "isin", "nav"]]

    db = get_db()
    # An earlier fetchone() on this thread's connection can leave a result open, which blocks register(); finish it first.
    db.execute("SELECT 1").fetchall()
    db.register("_mf_backfill_tmp", df)
    db.execute("INSERT OR REPLACE INTO mf_nav SELECT * FROM _mf_backfill_tmp")
    db.unregister("_mf_backfill_tmp")
    return len(df)
