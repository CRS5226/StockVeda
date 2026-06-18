import math
import datetime
import threading
import duckdb
import pandas as pd
from pathlib import Path
from backend.config import settings

# Thread-local storage so every FastAPI worker thread gets its own DuckDB connection.
# DuckDB supports multiple concurrent connections to the same file (WAL mode).
_tls = threading.local()
_db_path: str | None = None
_schema_sql: str | None = None


def get_db() -> duckdb.DuckDBPyConnection:
    global _db_path, _schema_sql
    if not hasattr(_tls, "conn") or _tls.conn is None:
        if _db_path is None:
            _db_path = settings.db_path
            Path(_db_path).parent.mkdir(parents=True, exist_ok=True)
            _schema_sql = (Path(__file__).parent / "schema.sql").read_text()
        conn = duckdb.connect(_db_path)
        conn.execute(_schema_sql)
        _tls.conn = conn
    return _tls.conn


def df_to_records(df: pd.DataFrame) -> list:
    """Convert DataFrame to JSON-safe records (NaN → null, dates → YYYY-MM-DD)."""
    if df is None or (hasattr(df, "empty") and df.empty):
        return []
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
