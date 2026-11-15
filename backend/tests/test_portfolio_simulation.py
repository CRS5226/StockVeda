"""Tests for the portfolio simulation maths, on cases with known answers."""

import math

import numpy as np
import pandas as pd
import pytest

from backend.core.portfolio_simulation import (
    MIN_RETURN_DAYS, bootstrap_paths, histogram_with_normal, normal_pdf, percentile_bands, return_stats, simulate, sleeve_returns,
)


def prices(*moves, start=100.0):
    out, p = [start], start
    for m in moves:
        p *= 1 + m
        out.append(p)
    return pd.Series(out, index=pd.date_range("2025-01-01", periods=len(out)))


def test_sleeve_returns_weights_each_holding_by_its_value():
    a, b = prices(0.10, 0.10), prices(-0.10, 0.0)
    r = sleeve_returns({"A": a, "B": b}, {"A": 300.0, "B": 100.0})
    assert r.iloc[0] == pytest.approx(0.75 * 0.10 + 0.25 * -0.10) and r.iloc[1] == pytest.approx(0.75 * 0.10)
    assert sleeve_returns({}, {}).empty and sleeve_returns({"A": a}, {"A": 0.0}).empty


def test_a_holding_with_no_price_that_day_counts_as_no_move():
    a = prices(0.01, 0.01, 0.01)
    b = prices(0.05, 0.05, 0.05).iloc[2:]                           # B only starts on the third day
    r = sleeve_returns({"A": a, "B": b}, {"A": 80.0, "B": 20.0})
    assert len(r) == 3 and r.iloc[0] == pytest.approx(0.8 * 0.01)   # B has no return yet, A carries 80% of the value


def test_a_constant_return_series_grows_every_path_the_same_way():
    daily = np.full(200, 0.001)
    g = bootstrap_paths(daily, 63, 50)
    assert g.shape == (50, 64) and np.all(g[:, 0] == 1.0)
    assert np.allclose(g[:, -1], 1.001 ** 63) and np.allclose(g[0], g[-1])


def test_paths_are_repeatable_and_spread_out_when_returns_vary():
    rng = np.random.default_rng(1)
    daily = rng.normal(0, 0.01, 300)
    daily = daily - daily.mean()                                   # centred, so the middle outcome stays near the start
    a, b = bootstrap_paths(daily, 126, 500), bootstrap_paths(daily, 126, 500)
    assert np.array_equal(a, b)                                    # fixed seed: the page does not jitter
    ends = a[:, -1]
    assert ends.std() > 0.03 and 0.9 < np.median(ends) < 1.1
    bands = percentile_bands(a)
    assert list(bands) == ["p5", "p25", "p50", "p75", "p95"] and bands["p5"][-1] < bands["p50"][-1] < bands["p95"][-1]


def test_normal_curve_integrates_to_one_and_the_histogram_counts_everything():
    x = np.linspace(-6, 6, 2001)
    assert np.trapezoid(normal_pdf(x, 0, 1), x) == pytest.approx(1, abs=1e-4)
    values = np.random.default_rng(2).normal(100, 10, 5000)
    h = histogram_with_normal(values, 30)
    assert sum(b["count"] for b in h["bins"]) == 5000 and h["mean"] == pytest.approx(100, abs=1) and h["std"] == pytest.approx(10, abs=0.5)
    area = sum(c["y"] for c in h["curve"])                          # curve is counts per bin, so it adds up to about the sample size
    assert area == pytest.approx(5000, rel=0.05)


def test_return_stats_for_a_normal_sample_and_for_one_with_fat_tails():
    rng = np.random.default_rng(3)
    normal = return_stats(rng.normal(0.0005, 0.01, 20000))
    assert abs(normal["skew"]) < 0.1 and abs(normal["excess_kurtosis"]) < 0.2
    assert normal["var95_pct"] == pytest.approx(normal["var95_normal_pct"], abs=0.1)
    assert normal["annual_vol_pct"] == pytest.approx(0.01 * math.sqrt(252) * 100, rel=0.05)
    fat = return_stats(rng.standard_t(3, 20000) * 0.01)
    assert fat["excess_kurtosis"] > 2 and fat["days_beyond_3_sigma"] > fat["expected_beyond_3_sigma"]
    assert fat["var99_pct"] < fat["var99_normal_pct"]                 # the real 1% day is worse than the normal curve says


def test_simulate_adds_the_fixed_part_and_reports_the_outcome():
    daily = pd.Series(np.full(300, 0.001))                           # every day +0.1%: no spread at all
    fixed = [1000.0 + 50 * k for k in range(7)]                      # 6 months, the fixed part growing 50 a month
    r = simulate(daily, 5000.0, fixed, months=6, paths=100)
    assert r["start_value"] == pytest.approx(6000.0)
    end = 5000.0 * 1.001 ** (6 * 21) + 1300.0
    assert r["bands"]["p50"][-1] == pytest.approx(end) and r["bands"]["p5"][-1] == pytest.approx(end)
    assert r["outcome"]["chance_below_start_pct"] == 0 and len(r["bands"]["p50"]) == 7 and len(r["samples"]) == 20
    assert r["returns"]["days"] == 300 and "bins" in r["returns"] and "curve" in r["returns"]


def test_too_little_history_gives_nothing():
    assert simulate(pd.Series(np.zeros(MIN_RETURN_DAYS - 1)), 1000.0, [0.0, 0.0], 1) is None
    assert simulate(pd.Series(np.zeros(300)), 0.0, [0.0, 0.0], 1) is None


def test_assemble_splits_random_and_fixed_parts():
    from backend.core.portfolio_simulation import assemble
    a = prices(0.01, 0.01, 0.01)
    sleeve, value, fixed, split = assemble({"TCS": a, "NOHIST": a}, {"TCS": 600.0, "NOHIST": 0.0, "GHOST": 50.0},
                                           {"F1": a}, {"F1": 400.0}, [[100.0, 105.0, 110.0], [50.0, 50.0, 51.0]], 25.0, months=2)
    assert value == 1000.0 and len(sleeve) == 3                       # a stock with no value and one with no prices are left out
    assert fixed == [175.0, 180.0, 186.0]                              # the two FDs added month by month, plus 25 held flat
    assert split == {"stocks": 600.0, "funds": 400.0, "fixed_deposits": 150.0, "held_flat": 25.0}
    empty_sleeve, v, fx, _ = assemble({}, {}, {}, {}, [], 0.0, 1)
    assert empty_sleeve.empty and v == 0 and fx == [0.0, 0.0]


# ── the route ──────────────────────────────────────────────────────────────────

from datetime import date, timedelta
from pathlib import Path

import duckdb
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.db import connection
from backend.routes import portfolio, portfolio_assets, portfolio_fd, portfolio_mf, portfolio_simulation

SCHEMA = (Path(connection.__file__).parent / "schema.sql").read_text()
MODULES = (portfolio, portfolio_assets, portfolio_fd, portfolio_mf, portfolio_simulation)


@pytest.fixture
def client(monkeypatch):
    conn = duckdb.connect()
    conn.execute(SCHEMA)
    for module in MODULES:
        monkeypatch.setattr(module, "get_db", lambda: conn)
    conn.execute("INSERT INTO portfolios (id, name) VALUES (1, 'Mine')")
    rng = np.random.default_rng(4)
    prices_ = 100 * np.cumprod(1 + rng.normal(0.0004, 0.012, 400))
    for i, p in enumerate(prices_):
        conn.execute("INSERT INTO stock_ohlcv VALUES (?, 'TCS', ?, ?, ?, ?, 1000)", [date.today() - timedelta(days=399 - i), p, p, p, p])
    app = FastAPI()
    for module in MODULES:
        app.include_router(module.router, prefix="/api")
    return TestClient(app)


def test_simulation_route_covers_stocks_fds_and_flat_assets(client):
    client.post("/api/portfolios/1/holdings", json={"symbol": "TCS", "qty": 10, "buy_price": 100})
    client.post("/api/portfolios/1/fds", json={"name": "FD", "principal": 10000, "annual_rate": 7, "start_date": str(date.today() - timedelta(days=30)),
                                              "maturity_date": str(date.today() + timedelta(days=700)), "payout": "cumulative", "compounding": "yearly"})
    client.post("/api/portfolios/1/assets", json={"name": "Gold", "asset_type": "gold", "currency": "INR", "qty": 1, "buy_price": 5000, "current_price": 6000})
    r = client.get("/api/portfolios/1/simulation", params={"months": 6, "paths": 300}).json()
    res, comp = r["result"], r["composition"]
    assert r["error"] is None and comp["held_flat"] == 6000 and comp["fixed_deposits"] > 10000 and comp["stocks"] > 0
    assert res["months"] == 6 and len(res["bands"]["p50"]) == 7 and res["bands"]["p5"][-1] < res["bands"]["p95"][-1]
    assert res["start_value"] == pytest.approx(comp["stocks"] + comp["fixed_deposits"] + comp["held_flat"])
    assert r["held_flat"] == [{"name": "Gold", "type": "gold", "value": 6000}]
    assert 0 <= res["outcome"]["chance_below_start_pct"] <= 100 and res["returns"]["days"] > 300
    assert client.get("/api/portfolios/1/simulation", params={"months": 0}).status_code == 422
    assert client.get("/api/portfolios/9/simulation").status_code == 404


def test_simulation_route_says_so_when_there_is_nothing_to_resample(client):
    r = client.get("/api/portfolios/1/simulation").json()
    assert r["result"] is None and r["error"] == "not_enough_history"
