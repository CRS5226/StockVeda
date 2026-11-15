"""Hand-checked cases for the facts about a portfolio's stocks: position sizes and price trend."""


import pandas as pd
import pytest

from backend.core.stock_health import concentration, positions, trend_stats



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


def test_effective_holdings_counts_equal_stocks_as_that_many():
    rows = [{"symbol": s, "kind": "stock", "qty": 1, "value": 100.0, "last_price": 100.0} for s in ("A", "B", "C", "D")]
    c = concentration(rows, 400.0, 50.0)                        # the base is the stock holdings: four equal stocks of 25% each
    assert c["effective_holdings"] == pytest.approx(4) and [p["weight_pct"] for p in c["positions"]] == [25.0] * 4
    assert concentration([], 0.0, 50.0)["effective_holdings"] == 0


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
