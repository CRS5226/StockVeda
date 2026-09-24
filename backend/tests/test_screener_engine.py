"""Tests for run_screen: user values must never be spliced into the SQL."""

from pathlib import Path

import duckdb
import pytest

from backend.core import screener_engine
from backend.core.screener_engine import Condition, run_screen

SCHEMA = (Path(screener_engine.__file__).parents[1] / "db" / "schema.sql").read_text()


@pytest.fixture
def db(monkeypatch):
    conn = duckdb.connect()
    conn.execute(SCHEMA)
    for sym, close in (("RELIANCE", 1400.0), ("TCS", 3100.0), ("O'HARA", 50.0)):
        conn.execute("INSERT INTO stock_ohlcv (date, symbol, open, high, low, close, volume) "
                     "VALUES ('2026-09-24', ?, ?, ?, ?, ?, 1000)", [sym, close, close, close, close])
    monkeypatch.setattr(screener_engine, "get_db", lambda: conn)
    return conn


def _symbols(rows):
    return sorted(r["symbol"] for r in rows)


def test_symbols_scope_the_results(db):
    assert _symbols(run_screen([], symbols=["TCS"])) == ["TCS"]


def test_quote_in_symbol_is_treated_as_text(db):
    assert _symbols(run_screen([], symbols=["O'HARA"])) == ["O'HARA"]


def test_injection_attempt_matches_nothing(db):
    # Before the fix this closed the quote and turned the filter into OR 1=1.
    assert run_screen([], symbols=["X') OR 1=1 --"]) == []


def test_condition_value_and_limit_are_bound(db):
    rows = run_screen([Condition(metric="close", op="gt", value=100.0)], limit=1)
    assert _symbols(rows) == ["TCS"]  # ordered by close DESC, limited to 1


def test_unknown_metric_is_rejected(db):
    with pytest.raises(ValueError):
        run_screen([Condition(metric="close; DROP TABLE stock_ohlcv", op="gt", value=1)])
