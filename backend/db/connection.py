import math
import datetime
import duckdb
import pandas as pd
from pathlib import Path
from backend.config import settings

_conn: duckdb.DuckDBPyConnection | None = None


def df_to_records(df: pd.DataFrame) -> list:
    """Convert DataFrame to JSON-safe records (NaN → null, dates → YYYY-MM-DD)."""
    df = df.copy()
    for col in df.columns:
        if pd.api.types.is_datetime64_any_dtype(df[col]):
            df[col] = df[col].dt.strftime("%Y-%m-%d")
    records = df.to_dict(orient="records")
    cleaned = []
    for row in records:
        new_row = {}
        for k, v in row.items():
            if isinstance(v, (datetime.date, datetime.datetime)):
                new_row[k] = v.isoformat()[:10]
            elif isinstance(v, float) and math.isnan(v):
                new_row[k] = None
            else:
                new_row[k] = v
        cleaned.append(new_row)
    return cleaned


def get_db() -> duckdb.DuckDBPyConnection:
    global _conn
    if _conn is None:
        Path(settings.db_path).parent.mkdir(parents=True, exist_ok=True)
        _conn = duckdb.connect(settings.db_path)
        schema = Path(__file__).parent / "schema.sql"
        _conn.execute(schema.read_text())
    return _conn
