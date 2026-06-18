import duckdb
from pathlib import Path
from backend.config import settings

_conn: duckdb.DuckDBPyConnection | None = None


def get_db() -> duckdb.DuckDBPyConnection:
    global _conn
    if _conn is None:
        Path(settings.db_path).parent.mkdir(parents=True, exist_ok=True)
        _conn = duckdb.connect(settings.db_path)
        schema = Path(__file__).parent / "schema.sql"
        _conn.execute(schema.read_text())
    return _conn
