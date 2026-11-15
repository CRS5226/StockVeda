"""Hand-checked cases for the zones and the share arithmetic."""

import pytest

from backend.core.signal_zones import DEFAULT_SETTINGS, classify_zone, clean_settings, sizing


def daily(rsi=50.0, pct_b=0.5, macd_bullish=True, close=100.0, ema20=95.0):
    return {"metrics": {"rsi": rsi, "pct_b": pct_b, "macd_bullish": macd_bullish, "close": close, "ema20": ema20}}


def test_clean_settings_fills_defaults_and_caps_trim():
    assert clean_settings(None) == DEFAULT_SETTINGS
    s = clean_settings({"profit_gain_pct": 60, "loss_pct": -3, "trim_pct": 250, "x": 1, "add_budget": "a"})
    assert s["profit_gain_pct"] == 60 and s["loss_pct"] == DEFAULT_SETTINGS["loss_pct"] and s["trim_pct"] == 100 and s["add_budget"] == 5000


def test_profit_zone_needs_both_the_gain_and_the_stretch():
    s = clean_settings(None)
    zone, checks = classify_zone(55, daily(rsi=78), s)
    assert zone == "profit" and all(c["met"] for c in checks)
    assert classify_zone(55, daily(rsi=78, pct_b=0.4), s)[0] == "profit"
    assert classify_zone(55, daily(rsi=50, pct_b=1.2), s)[0] == "profit"                 # the upper band alone is enough for the second condition
    zone, checks = classify_zone(55, daily(rsi=60), s)                                   # big gain, not stretched
    assert zone == "hold" and [c["met"] for c in checks] == [True, False]
    assert classify_zone(10, daily(rsi=90), s)[0] == "hold"                              # stretched, but not enough gain


def test_recovery_zone_needs_the_loss_and_the_turn():
    s = clean_settings(None)
    assert classify_zone(-30, daily(macd_bullish=True, close=100, ema20=95), s)[0] == "recovery"
    zone, checks = classify_zone(-30, daily(macd_bullish=False), s)
    assert zone == "hold" and [c["met"] for c in checks] == [True, False, True]
    assert classify_zone(-10, daily(), s)[0] == "hold"
    assert classify_zone(None, daily(), s) == ("hold", []) and classify_zone(-30, None, s) == ("hold", [])


def test_sizing_for_a_gain():
    # 100 shares bought at 50, now 80: worth 8,000, a 5,000 cost
    z = sizing(100, 50.0, 80.0, 8000.0, 40_000.0, 25.0, clean_settings({"trim_pct": 30}))
    assert z["trim"] == {"shares": 30, "value": 2400.0, "pct": 30.0}
    assert z["cost_out"]["shares"] == 63 and z["cost_out"]["value"] == 5040.0            # ceil(5000 / 80)
    assert z["cost_out"]["possible"] is True


def test_sizing_for_a_loss_shows_the_new_average_and_respects_the_size_limit():
    # 100 shares at 100, now 60: worth 6,000 in a 60,000 portfolio; a 10% limit is 6,000, so there is no room to add
    full = sizing(100, 100.0, 60.0, 6000.0, 60_000.0, 10.0, clean_settings(None))
    assert full["add"]["shares"] == 0 and full["add"]["limited_by_size"] is True and full["add"]["headroom"] == 0
    # with a 20% limit there is 6,000 of room and a 5,000 budget: 83 shares
    z = sizing(100, 100.0, 60.0, 6000.0, 60_000.0, 20.0, clean_settings(None))
    a = z["add"]
    assert a["shares"] == 83 and a["limited_by_size"] is False and a["value"] == pytest.approx(4980)
    assert a["avg_after"] == pytest.approx((10000 + 83 * 60) / 183)
    assert a["breakeven_before_pct"] == pytest.approx(66.67, abs=0.01)                    # the price must rise 66.7% to reach 100
    assert a["breakeven_after_pct"] == pytest.approx(a["avg_after"] / 60 * 100 - 100)
    assert a["breakeven_after_pct"] < a["breakeven_before_pct"]
