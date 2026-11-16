"""Tests for the stock page's page-load prefetch and the screener's yfinance loaders. yfinance is faked; no network."""

import logging
from datetime import date

import duckdb
import pandas as pd
import pytest

from backend.core import screener_universe
from backend.data_sync import base, sync_fundamentals
from backend.routes import stock

FUND_COLUMNS = ["symbol", "period", "period_type", "is_consolidated", "revenue", "gross_profit", "ebitda", "ebit", "pbt", "pat",
                "eps_basic", "eps_diluted", "total_assets", "total_equity", "total_debt", "cash", "cfo", "cfi", "cff", "capex"]


def _fund_row(sym, kind):
    row = dict.fromkeys(FUND_COLUMNS)
    row.update(symbol=sym, period=date(2026, 9, 30), period_type=kind, is_consolidated=True, revenue=100.0, pat=10.0)
    return row


class FakeTicker:
    """Dividends on two dates and one split, like yfinance's `.actions`, plus the holder table the screener reads."""

    def __init__(self, code):
        self.code = code
        idx = pd.to_datetime(["2025-06-10", "2025-12-10", "2026-02-01"])
        self.actions = pd.DataFrame({"Dividends": [5.0, 6.0, 0.0], "Stock Splits": [0.0, 0.0, 2.0]}, index=idx)
        self.major_holders = pd.DataFrame({"Value": [0.5179, 0.2813]}, index=["insidersPercentHeld", "institutionsPercentHeld"])


@pytest.fixture
def con(monkeypatch):
    c = duckdb.connect(":memory:")
    c.execute("""CREATE TABLE stock_fundamentals (symbol VARCHAR, period DATE, period_type VARCHAR, is_consolidated BOOLEAN,
        revenue DOUBLE, gross_profit DOUBLE, ebitda DOUBLE, ebit DOUBLE, pbt DOUBLE, pat DOUBLE, eps_basic DOUBLE, eps_diluted DOUBLE,
        total_assets DOUBLE, total_equity DOUBLE, total_debt DOUBLE, cash DOUBLE, cfo DOUBLE, cfi DOUBLE, cff DOUBLE, capex DOUBLE,
        PRIMARY KEY (symbol, period, period_type, is_consolidated))""")
    c.execute("""CREATE TABLE corporate_actions (symbol VARCHAR, ex_date DATE, action_type VARCHAR, value DOUBLE, ratio VARCHAR,
        record_date DATE, PRIMARY KEY (symbol, ex_date, action_type))""")
    c.execute("""CREATE TABLE shareholding (symbol VARCHAR, period DATE, promoter_pct DOUBLE, promoter_pledge_pct DOUBLE, fii_pct DOUBLE,
        dii_pct DOUBLE, mf_pct DOUBLE, retail_pct DOUBLE, government_pct DOUBLE, total_shareholders BIGINT, PRIMARY KEY (symbol, period))""")
    monkeypatch.setattr(stock, "get_db", lambda: c)
    monkeypatch.setattr(base, "get_db", lambda: c)
    monkeypatch.setattr(stock.yf, "Ticker", FakeTicker)
    monkeypatch.setattr(sync_fundamentals, "parse_financials", lambda t, sym, kind: [_fund_row(sym, kind)])
    return c


def _count(con, table, symbol="ABC"):
    return con.execute(f"SELECT COUNT(*) FROM {table} WHERE symbol = ?", [symbol]).fetchall()[0][0]


def test_prefetch_fills_fundamentals_and_corporate_actions(con, capsys):
    result = stock.prefetch_symbol("abc")
    assert result["status"] == "ok" and result["symbol"] == "ABC"
    assert result["fetched"] == ["fundamentals:2", "corp_actions:3"]
    assert _count(con, "stock_fundamentals") == 2                      # quarterly and annual
    kinds = sorted(r[0] for r in con.execute("SELECT action_type FROM corporate_actions").fetchall())
    assert kinds == ["DIVIDEND", "DIVIDEND", "SPLIT"]
    assert "[prefetch" not in capsys.readouterr().out                  # nothing failed behind the scenes


def test_prefetch_skips_what_is_already_stored(con):
    stock.prefetch_symbol("abc")
    assert stock.prefetch_symbol("abc")["fetched"] == []
    assert _count(con, "corporate_actions") == 3


def test_prefetch_reports_a_yfinance_error_without_failing_the_page(con, monkeypatch, capsys):
    monkeypatch.setattr(sync_fundamentals, "parse_financials", lambda *a: (_ for _ in ()).throw(RuntimeError("Yahoo is down")))
    result = stock.prefetch_symbol("abc")
    assert result["status"] == "ok" and result["fetched"] == ["corp_actions:3"]     # the other section still loads
    assert "Yahoo is down" in capsys.readouterr().out


def test_upsert_df_works_after_the_caller_left_a_result_open(con):
    con.execute("SELECT COUNT(*) FROM corporate_actions").fetchone()       # leaves the result open on this connection
    df = pd.DataFrame([{"symbol": "ABC", "ex_date": date(2026, 1, 1), "action_type": "DIVIDEND", "value": 1.0, "ratio": None, "record_date": None}])
    assert base.upsert_df(df, "corporate_actions") == 1
    assert _count(con, "corporate_actions") == 1
    assert base.upsert_df(df.assign(value=2.0), "corporate_actions") == 1   # replaces, as before
    assert con.execute("SELECT value FROM corporate_actions").fetchall() == [(2.0,)]


def test_insert_missing_df_works_after_the_caller_left_a_result_open(con):
    df = pd.DataFrame([{"symbol": "ABC", "ex_date": date(2026, 1, 1), "action_type": "DIVIDEND", "value": 1.0, "ratio": None, "record_date": None}])
    base.upsert_df(df, "corporate_actions")
    con.execute("SELECT COUNT(*) FROM corporate_actions").fetchone()
    more = pd.concat([df.assign(value=9.0), df.assign(ex_date=date(2026, 6, 1))])
    assert base.insert_missing_df(more, "corporate_actions") == 1           # only the new key
    assert con.execute("SELECT value FROM corporate_actions WHERE ex_date = '2026-01-01'").fetchall() == [(1.0,)]


def test_screener_fundamentals_loader_saves_and_skips_when_present(con):
    screener_universe._fetch_fundamentals(FakeTicker("ABC"), "ABC", con)
    assert _count(con, "stock_fundamentals") == 2
    screener_universe._fetch_fundamentals(FakeTicker("ABC"), "ABC", con)    # already there: nothing more
    assert _count(con, "stock_fundamentals") == 2


def test_screener_loaders_log_a_failure_instead_of_hiding_it(con, monkeypatch, caplog):
    monkeypatch.setattr(sync_fundamentals, "parse_financials", lambda *a: (_ for _ in ()).throw(RuntimeError("no financials")))
    with caplog.at_level(logging.WARNING):
        screener_universe._fetch_fundamentals(FakeTicker("ABC"), "ABC", con)
    assert "Fundamentals fetch failed for ABC" in caplog.text and "no financials" in caplog.text


def test_screener_shareholding_loader_saves_the_proxy_percentages(con):
    screener_universe._fetch_shareholding(FakeTicker("ABC"), "ABC", con)
    assert con.execute("SELECT promoter_pct, fii_pct FROM shareholding WHERE symbol = 'ABC'").fetchall() == [(51.79, 28.13)]
