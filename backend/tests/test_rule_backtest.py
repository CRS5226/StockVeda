"""Tests for the per-rule backtest, on synthetic candles with known outcomes."""

from datetime import date, timedelta

import numpy as np
import pandas as pd
import pytest

from backend.core.rule_backtest import MIN_TRADES, RULES, WARMUP, _hold, positions, run_rule


def frame(closes, spread=0.1):
    c = np.asarray(closes, dtype=float)
    return pd.DataFrame({"date": [date(2024, 1, 1) + timedelta(days=i) for i in range(len(c))], "open": c, "high": c + spread, "low": c - spread, "close": c, "volume": 1000.0})


def test_hold_stays_in_until_the_leave_signal():
    enter = np.array([0, 1, 0, 0, 1, 0, 0], dtype=bool)
    leave = np.array([0, 0, 0, 1, 0, 0, 1], dtype=bool)
    assert _hold(enter, leave).tolist() == [0, 1, 1, 0, 1, 1, 0]


def test_a_steady_climb_is_one_open_trade_that_earns_the_climb():
    closes = np.linspace(100, 200, 400)
    r = run_rule(frame(closes), "ema_cross", cost_pct=0)
    # held from the candle after the test starts: from close 200 to the last close
    assert r["total_pct"] == pytest.approx((closes[-1] / closes[WARMUP] - 1) * 100, abs=1e-6)
    assert r["trades"] == 1 and r["verdict"] == "few_trades"
    assert r["buy_hold_pct"] == pytest.approx((closes[-1] / closes[WARMUP - 1] - 1) * 100, abs=1e-6)
    assert r["in_market_pct"] > 99
    paid = run_rule(frame(closes), "ema_cross", cost_pct=0.2)
    assert paid["total_pct"] == pytest.approx(r["total_pct"] - 0.2 * (1 + r["total_pct"] / 100), abs=0.02)      # one entry charged
    assert paid["avg_trade_pct"] == pytest.approx(((1 + r["total_pct"] / 100) * 0.998 ** 2 - 1) * 100, abs=0.05)  # a trade pays both sides


def test_a_steady_fall_never_gets_in():
    r = run_rule(frame(np.linspace(200, 100, 400)), "ema_cross", cost_pct=0.2)
    assert r["trades"] == 0 and r["total_pct"] == 0 and r["win_rate_pct"] is None and r["in_market_pct"] == 0
    assert r["buy_hold_pct"] < 0 and r["verdict"] == "few_trades"


def test_a_swinging_market_gives_many_trades_and_costs_reduce_the_result():
    closes = 100 + 10 * np.sin(np.linspace(0, 24 * np.pi, 600))
    free = run_rule(frame(closes), "ema_cross", cost_pct=0)
    costly = run_rule(frame(closes), "ema_cross", cost_pct=1.0)
    assert free["trades"] >= MIN_TRADES and 0 <= free["win_rate_pct"] <= 100
    assert costly["total_pct"] < free["total_pct"] and costly["avg_trade_pct"] < free["avg_trade_pct"]
    assert 20 < free["in_market_pct"] < 80 and free["max_drawdown_pct"] <= 0
    assert free["candles"] == 600 - WARMUP and free["from_date"] == str(date(2024, 1, 1) + timedelta(days=WARMUP))


def test_the_rsi_rule_buys_dips_and_leaves_on_the_bounce():
    base = []
    for _ in range(14):                                       # a flat spell, a sharp fall, then a recovery, repeated
        base += [100.0] * 25 + list(np.linspace(100, 85, 6)[1:]) + list(np.linspace(85, 100, 6)[1:])
    r = run_rule(frame(base), "rsi", cost_pct=0)
    assert r["trades"] >= 8 and r["avg_trade_pct"] > 0 and r["win_rate_pct"] == 100
    assert r["verdict"] in ("held_up", "mixed")


def test_too_few_candles_and_unknown_rules():
    assert run_rule(frame(np.linspace(100, 120, 250)), "ema_cross") is None
    with pytest.raises(ValueError):
        positions(frame(np.linspace(100, 120, 400)), "magic")


def test_every_listed_rule_runs():
    rng = np.random.default_rng(5)
    df = frame(100 + np.cumsum(rng.normal(0, 1, 500)))
    for key, label, how in RULES:
        r = run_rule(df, key)
        assert r is not None and label and how and r["verdict"] in ("held_up", "mixed", "did_not", "few_trades"), key
