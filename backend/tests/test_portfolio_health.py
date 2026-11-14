"""Hand-checked cases for the portfolio health check, and its routes."""

from datetime import date, timedelta
from pathlib import Path

import duckdb
import pandas as pd
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.core.portfolio_health import allocation_check, concentration, parse_targets, positions, trend_stats
from backend.db import connection
from backend.routes import portfolio, portfolio_assets, portfolio_dividends, portfolio_fd, portfolio_health, portfolio_mf, portfolio_total

SCHEMA = (Path(connection.__file__).parent / "schema.sql").read_text()


def lot(symbol, qty, price, last, kind="stock"):
    inv = qty * price if qty else None
    return {"symbol": symbol, "kind": kind, "qty": qty, "invested": inv, "value": qty * last if qty and last else None, "last_price": last}


def test_positions_add_lots_and_skip_unpriced():
    rows = positions([lot("TCS", 2, 100, 150), lot("TCS", 1, 130, 150), lot("ITC", None, None, 400), lot("ABB", 1, 10, None)])
    assert [(r["symbol"], r["qty"], r["invested"], r["value"], r["lots"]) for r in rows] == [("TCS", 3, 330, 450, 2)]
    assert rows[0]["avg_price"] == pytest.approx(110)


def test_concentration_flags_the_stocks_above_the_limit_and_sizes_the_trim():
    rows = [{"symbol": s, "kind": "stock", "qty": q, "value": v, "last_price": v / q} for s, q, v in (("A", 12, 600.0), ("B", 3, 300.0), ("C", 1, 100.0))]
    c = concentration(rows, 1000.0, 50.0)
    assert [(p["symbol"], round(p["weight_pct"])) for p in c["positions"]] == [("A", 60), ("B", 30), ("C", 10)]
    a = c["positions"][0]
    assert a["over_limit"] and a["excess_value"] == pytest.approx(100) and a["shares_to_trim"] == 2      # 100 / 50 per share
    assert not c["positions"][1]["over_limit"] and c["positions"][1]["shares_to_trim"] == 0
    assert c["over_limit"] == 1 and c["top5_pct"] == pytest.approx(100)
    assert c["effective_holdings"] == pytest.approx(1 / (0.36 + 0.09 + 0.01))


def test_effective_holdings_ignores_the_part_of_the_portfolio_that_is_not_stocks():
    rows = [{"symbol": s, "kind": "stock", "qty": 1, "value": 100.0, "last_price": 100.0} for s in ("A", "B", "C", "D")]
    # four equal stocks are 40% of a 1000 portfolio (the rest is FDs): still four equal holdings
    assert concentration(rows, 1000.0, 50.0)["effective_holdings"] == pytest.approx(4)
    assert concentration([], 1000.0, 50.0)["effective_holdings"] == 0


def test_allocation_check_flags_drift_and_sizes_the_move():
    parts = [{"key": "stocks", "label": "Stocks", "value": 600.0}, {"key": "fixed_deposits", "label": "Fixed deposits", "value": 400.0}]
    rows = {r["key"]: r for r in allocation_check(parts, 1000.0, {"stocks": 50, "fixed_deposits": 38, "gold": 20}, 5.0)}
    assert (rows["stocks"]["status"], rows["stocks"]["diff_pp"], rows["stocks"]["move"]) == ("over", pytest.approx(10), pytest.approx(-100))
    assert rows["fixed_deposits"]["status"] == "within" and rows["fixed_deposits"]["move"] == pytest.approx(-20)
    assert (rows["gold"]["status"], rows["gold"]["move"], rows["gold"]["label"]) == ("under", pytest.approx(200), "Gold")
    assert allocation_check(parts, 1000.0, {}, 5.0)[0]["status"] == "no_target"


def test_trend_stats_on_a_steady_climb():
    s = pd.Series(range(100, 400), dtype=float)               # 300 bars, last close 399
    t = trend_stats(s)
    assert t["sma50"] == pytest.approx(sum(range(350, 400)) / 50) and t["sma200"] == pytest.approx(sum(range(200, 400)) / 200)
    assert t["above_sma50"] and t["above_sma200"] and t["from_high_pct"] == 0 and not t["deep_drawdown"]
    assert t["return_1y_pct"] == pytest.approx((399 / 147 - 1) * 100)


def test_trend_stats_after_a_fall_and_with_little_history():
    fall = pd.Series([100.0] * 250 + [70.0] * 10)
    t = trend_stats(fall)
    assert t["deep_drawdown"] and t["from_high_pct"] == pytest.approx(-30) and not t["above_sma50"]
    short = trend_stats(pd.Series([10.0, 11.0, 12.0]))
    assert short["sma50"] is None and short["above_sma200"] is None and short["return_1y_pct"] is None and short["last"] == 12
    assert trend_stats(pd.Series(dtype=float))["last"] is None


def test_parse_targets_keeps_only_positive_numbers():
    assert parse_targets({"stocks": 60, "gold": 0, "fd": -5, "x": "a"}) == {"stocks": 60.0}
    assert parse_targets(None) == {}


@pytest.fixture
def client(monkeypatch):
    conn = duckdb.connect()
    conn.execute(SCHEMA)
    modules = (portfolio, portfolio_assets, portfolio_dividends, portfolio_fd, portfolio_mf, portfolio_total, portfolio_health)
    for module in modules:
        monkeypatch.setattr(module, "get_db", lambda: conn)
    conn.execute("INSERT INTO portfolios (id, name) VALUES (1, 'Mine')")
    today = date.today()
    for i in range(300):                                          # TCS climbs for 300 days, ITC falls hard at the end
        d = today - timedelta(days=299 - i)
        conn.execute("INSERT INTO stock_ohlcv VALUES (?, 'TCS', 1, 1, 1, ?, 1)", [d, 100 + i])
        conn.execute("INSERT INTO stock_ohlcv VALUES (?, 'ITC', 1, 1, 1, ?, 1)", [d, 100 if i < 290 else 60])
    app = FastAPI()
    for module in modules:
        app.include_router(module.router, prefix="/api")
    return TestClient(app)


def test_health_report(client):
    client.post("/api/portfolios/1/holdings", json={"symbol": "TCS", "qty": 10, "buy_price": 200})      # last close 399
    client.post("/api/portfolios/1/holdings", json={"symbol": "ITC", "qty": 10, "buy_price": 100})      # last close 60
    client.post("/api/portfolios/1/fds", json={"name": "FD", "principal": 5000, "annual_rate": 7, "start_date": str(date.today() - timedelta(days=30)),
                                              "maturity_date": str(date.today() + timedelta(days=335)), "payout": "cumulative", "compounding": "yearly"})
    h = client.get("/api/portfolios/1/health").json()
    by = {t["symbol"]: t for t in h["trend"]}
    assert by["TCS"]["above_sma200"] is True and by["ITC"]["above_sma200"] is False and by["ITC"]["deep_drawdown"] is True
    assert h["summary"]["stocks"] == 2 and h["summary"]["below_sma200"] == 1 and h["summary"]["deep_drawdown"] == 1
    assert h["concentration"]["positions"][0]["symbol"] == "TCS"
    assert h["concentration"]["max_pct"] == 10.0 and h["concentration"]["positions"][0]["over_limit"]     # TCS is ~3990 of ~8600
    assert {a["key"] for a in h["allocation"]} == {"stocks", "fixed_deposits"} and all(a["status"] == "no_target" for a in h["allocation"])


def test_targets_are_saved_and_drive_the_allocation_check(client):
    client.post("/api/portfolios/1/holdings", json={"symbol": "TCS", "qty": 10, "buy_price": 200})
    assert client.get("/api/portfolios/1/health/targets").json() == {"max_position_pct": 10.0, "band_pp": 5.0, "targets": {}}
    saved = client.put("/api/portfolios/1/health/targets", json={"max_position_pct": 100, "band_pp": 2, "targets": {"stocks": 60, "gold": 40}}).json()
    assert saved["targets"] == {"stocks": 60.0, "gold": 40.0} and saved["max_position_pct"] == 100
    h = client.get("/api/portfolios/1/health").json()
    rows = {a["key"]: a for a in h["allocation"]}
    assert rows["stocks"]["status"] == "over" and rows["gold"]["status"] == "under"
    assert h["summary"]["types_out_of_band"] == 2 and not h["concentration"]["positions"][0]["over_limit"]
    assert client.put("/api/portfolios/1/health/targets", json={"targets": {"stocks": 70, "gold": 40}}).status_code == 400
    assert client.put("/api/portfolios/9/health/targets", json={}).status_code == 404
    assert client.get("/api/portfolios/9/health").status_code == 404
    client.delete("/api/portfolios/1")
    assert client.get("/api/portfolios/1/health/targets").status_code == 404
