"""Tests for the indicator rules, on synthetic candles whose answer is known."""

from datetime import date, timedelta

import numpy as np
import pandas as pd
import pytest

from backend.core.signal_rules import ADX_RANGING, MIN_BARS, adx, alignment, ema, evaluate_rules, macd, rsi, to_weekly


def frame(closes, spread=1.0, volume=1000.0, start=date(2025, 1, 1)):
    closes = np.asarray(closes, dtype=float)
    return pd.DataFrame({
        "date": [start + timedelta(days=i) for i in range(len(closes))],
        "open": closes, "high": closes + spread, "low": closes - spread, "close": closes, "volume": volume,
    })


def by_key(result):
    return {r["key"]: r for r in result["rules"]}


def test_indicators_on_known_series():
    flat = pd.Series([10.0] * 30)
    assert ema(flat, 10).iloc[-1] == pytest.approx(10)
    assert rsi(pd.Series(np.arange(1.0, 40.0))).iloc[-1] == pytest.approx(100)            # only gains
    line, sig = macd(pd.Series(np.arange(1.0, 100.0)))
    assert line.iloc[-1] > 0 and line.iloc[-1] > sig.iloc[-1]                              # a steady climb: MACD above its signal
    h = pd.Series(np.arange(1.0, 120.0)); a = adx(h + 1, h - 1, h)
    assert a.iloc[-1] > 50                                                                 # a straight line is a very strong trend


def test_too_few_candles_gives_nothing():
    assert evaluate_rules(frame(np.arange(1, MIN_BARS))) is None


def test_a_steady_uptrend_is_bullish_on_the_trend_rules():
    r = evaluate_rules(frame(np.linspace(100, 300, 260), spread=0.2))
    rules = by_key(r)
    assert rules["ema_cross"]["state"] == "bullish" and rules["sma200"]["state"] == "bullish" and rules["macd"]["state"] == "bullish"
    assert rules["breakout"]["state"] == "bullish"
    assert r["regime"] == "trending" and r["lean"] == "bullish"
    assert not rules["rsi"]["counts"] and not rules["bollinger"]["counts"]                  # mean reversion is not counted in a trend
    assert r["votes"]["bearish"] == 0 and r["votes"]["counted"] == 4
    assert r["metrics"]["close"] == pytest.approx(300) and r["as_of"] == str(date(2025, 1, 1) + timedelta(days=259))


def test_a_downtrend_is_bearish():
    r = evaluate_rules(frame(np.linspace(300, 100, 260), spread=0.2))
    rules = by_key(r)
    assert rules["ema_cross"]["state"] == "bearish" and rules["sma200"]["state"] == "bearish" and rules["breakout"]["state"] == "bearish"
    assert r["lean"] == "bearish"


def test_a_crossover_reports_when_it_happened_and_whether_it_is_fresh():
    closes = list(np.linspace(100, 200, 150)) + list(np.linspace(200, 120, 40)) + list(np.linspace(120, 220, 5))
    r = evaluate_rules(frame(closes))
    macd_rule = by_key(r)["macd"]
    assert macd_rule["state"] == "bullish" and macd_rule["since"] is not None
    assert macd_rule["fresh"] is True                                                       # it turned within the last five candles


def test_a_sideways_market_counts_mean_reversion_instead_of_trend():
    rng = np.random.default_rng(3)
    closes = 100 + 3 * np.sin(np.linspace(0, 40 * np.pi, 400)) + rng.normal(0, 0.3, 400)
    r = evaluate_rules(frame(closes, spread=0.5))
    assert r["regime"] in ("ranging", "mixed") and r["adx"] < 25
    if r["regime"] == "ranging":
        counted = {x["key"] for x in r["rules"] if x["counts"]}
        assert counted == {"rsi", "bollinger"}


def test_rsi_and_bollinger_vote_against_an_extreme_move():
    run = evaluate_rules(frame(list(np.linspace(100, 101, 200)) + [101 + i * 3 for i in range(1, 15)]))      # a sharp run up after a flat spell
    assert by_key(run)["rsi"]["state"] == "bearish" and "overbought" in by_key(run)["rsi"]["detail"]
    rng = np.random.default_rng(1)
    spike = evaluate_rules(frame(list(100 + rng.normal(0, 0.3, 120)) + [112.0], spread=0.3))                 # one big jump out of a quiet range
    assert by_key(spike)["bollinger"]["state"] == "bearish"
    drop = evaluate_rules(frame(list(100 + rng.normal(0, 0.3, 120)) + [88.0], spread=0.3))
    assert by_key(drop)["bollinger"]["state"] == "bullish"                                                    # below the lower band: oversold


def test_the_200_average_needs_200_candles():
    r = evaluate_rules(frame(np.linspace(100, 150, 120)))
    rule = by_key(r)["sma200"]
    assert rule["counts"] is False and rule["detail"] == "Needs 200 candles"


def test_weekly_candles_and_alignment():
    daily = frame(np.arange(1, 71), start=date(2025, 1, 6))                                 # starts on a Monday
    w = to_weekly(daily)
    assert w["open"].iloc[0] == 1 and w["close"].iloc[0] == 5 and w["high"].iloc[0] == 6 and w["volume"].iloc[0] == 5000
    assert alignment(["bullish", "bullish", None]) == "bullish" and alignment(["bearish", "bearish"]) == "bearish"
    assert alignment(["bullish", "neutral"]) == "mixed" and alignment(["bullish", None]) is None
