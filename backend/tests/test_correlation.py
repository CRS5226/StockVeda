"""Tests for the correlated-stocks maths, the DB loader and the route. Synthetic data, no network."""

import duckdb
import numpy as np
import pandas as pd
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.core import correlation as cor
from backend.routes import connections


def _closes(n=140, seed=1):
    """A, a near copy (A2), an inverse (INV), an unrelated series (NOISE) and a short-history one (NEW)."""
    rng = np.random.default_rng(seed)
    base = rng.normal(0.0005, 0.01, n)
    r = {
        "A": base,
        "A2": base + rng.normal(0, 0.001, n),
        "INV": -base + rng.normal(0, 0.001, n),
        "NOISE": rng.normal(0, 0.01, n),
    }
    closes = pd.DataFrame({k: 100 * np.cumprod(1 + v) for k, v in r.items()},
                          index=pd.date_range("2026-01-01", periods=n, freq="B"))
    closes["NEW"] = np.where(np.arange(n) >= n - 10, closes["A"], np.nan)
    return closes


def test_correlation_ranks_copy_first_inverse_last_and_drops_short_history():
    returns = cor.daily_returns(_closes())
    corr = cor.correlation_with(returns, "A", window=120)
    assert "A" not in corr.index and "NEW" not in corr.index
    assert corr["A2"] > 0.95 and corr["INV"] < -0.95
    positive, negative = cor.rank_correlated(corr, 2)
    assert positive.index[0] == "A2"
    assert negative.index[0] == "INV"
    assert (positive > 0).all() and (negative < 0).all()


def test_correlation_unknown_target_is_empty():
    assert cor.correlation_with(cor.daily_returns(_closes()), "ZZZ", 60).empty


def test_period_return_and_not_enough_history():
    closes = pd.DataFrame({"X": [100.0] * 63 + [110.0]})
    assert cor.period_return(closes, "X", 21) == 10.0
    assert cor.period_return(closes, "X", 200) is None
    assert cor.period_return(closes, "NOPE", 21) is None


def test_beta_of_double_the_index_is_two():
    idx = pd.Series(np.random.default_rng(3).normal(0, 0.01, 100))
    assert cor.beta(idx * 2, idx) == 2.0
    assert cor.beta(idx.head(5), idx.head(5)) is None  # too few days


@pytest.fixture
def con(monkeypatch):
    c = duckdb.connect(":memory:")
    c.execute("CREATE TABLE stock_ohlcv (date DATE, symbol VARCHAR, open DOUBLE, high DOUBLE, low DOUBLE, close DOUBLE, volume BIGINT)")
    c.execute("CREATE TABLE index_ohlcv (date DATE, index_name VARCHAR, open DOUBLE, high DOUBLE, low DOUBLE, close DOUBLE)")
    c.execute("CREATE TABLE nse_symbols (symbol VARCHAR, company_name VARCHAR, series VARCHAR, isin VARCHAR, face_value DOUBLE)")
    c.execute("CREATE TABLE company_profile (symbol VARCHAR, city VARCHAR, state VARCHAR, pincode VARCHAR, sector VARCHAR, industry VARCHAR, website VARCHAR, employees BIGINT, lat DOUBLE, lon DOUBLE, updated_at TIMESTAMP)")
    c.execute("CREATE TABLE stock_ratios_snapshot (symbol VARCHAR, as_of DATE, pe DOUBLE)")
    closes = _closes()
    long = closes.drop(columns=["NEW"]).reset_index(names="date").melt(id_vars="date", var_name="symbol", value_name="close")
    long["volume"] = 1000
    for col in ("open", "high", "low"):
        long[col] = long["close"]
    c.register("_l", long)
    c.execute("INSERT INTO stock_ohlcv SELECT date, symbol, open, high, low, close, volume FROM _l")
    c.unregister("_l")
    idx = pd.DataFrame({"date": closes.index, "index_name": "NIFTY 50", "open": closes["A"], "high": closes["A"], "low": closes["A"], "close": closes["A"]})
    c.register("_i", idx)
    c.execute("INSERT INTO index_ohlcv SELECT date, index_name, open, high, low, close FROM _i")
    c.unregister("_i")
    for sym, name in [("A", "Alpha Ltd"), ("A2", "Alpha Two"), ("INV", "Inverse"), ("NOISE", "Noise Co")]:
        c.execute("INSERT INTO nse_symbols VALUES (?, ?, 'EQ', NULL, 1)", [sym, name])
    c.execute("INSERT INTO company_profile (symbol, sector, industry) VALUES ('A','Tech','Software'), ('A2','Tech','Software'), ('NOISE','Tech','Software'), ('INV','Energy','Oil')")
    c.execute("INSERT INTO stock_ratios_snapshot VALUES ('A2', '2026-06-01', 21.5)")
    monkeypatch.setattr(cor, "get_db", lambda: c)
    return c


def test_connections_for_returns_correlated_peers_returns_and_pe(con):
    res = cor.connections_for("a", window=120)
    assert res["symbol"] == "A" and res["window"] == 120
    assert res["positive"][0]["symbol"] == "A2" and res["positive"][0]["name"] == "Alpha Two"
    assert res["positive"][0]["pe"] == 21.5 and res["positive"][0]["return_3m"] is not None
    assert res["negative"][0]["symbol"] == "INV"
    assert {p["symbol"] for p in res["peers"]} == {"A2", "NOISE"}  # same industry; INV is in another one
    assert res["profile"]["industry"] == "Software"
    assert res["beta_vs_nifty"] == 1.0  # the index in this fixture is A itself
    assert res["self"]["correlation"] is None


def test_connections_for_symbol_without_profile_has_no_peers_and_unknown_is_none(con):
    con.execute("DELETE FROM company_profile WHERE symbol = 'A'")
    res = cor.connections_for("A", window=60)
    assert res["peers"] == [] and res["profile"] is None
    assert cor.connections_for("ZZZ") is None


def test_window_is_clamped(con):
    assert cor.connections_for("A", window=5)["window"] == cor.MIN_WINDOW


def test_route_200_and_404(con):
    app = FastAPI()
    app.include_router(connections.router)
    client = TestClient(app)
    ok = client.get("/stock/A/connections/correlated?window=60&top=1")
    assert ok.status_code == 200 and len(ok.json()["positive"]) == 1
    assert client.get("/stock/ZZZ/connections/correlated").status_code == 404
