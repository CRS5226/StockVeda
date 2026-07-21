"""
4 weighted-scoring quant algorithms: Long Pullback, Short Bounce, Accumulation,
Distribution. Each combines hard AND-gates with a weighted 0-1 score across
named factors, ATR-multiple stops/targets, and risk-%-of-capital position
sizing — a different model from the AND-only rule engine in backtest_engine.py.

Long Pullback / Short Bounce: direct entry once gates hold and score reaches
the BUY/SHORT tier (>=0.55).

Accumulation / Distribution: two-stage — gates+score>=0.60 arms a symbol,
then a later breakout (accum) / breakdown (distrib) with volume confirmation
fires the actual entry. An armed setup expires after 20 trading days.

Factor score transforms (triangular / one-sided ramps) are DESIGNED DEFAULTS —
the source spec gives target points, not exact curve shapes or tolerances.
Every named factor is its own small function so weights/curves are easy to
retune later once backtested, per the user's own "untested defaults" framing.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Literal, Optional

import numpy as np
import pandas as pd

from backend.db.connection import get_db
from backend.core.fno_universe import FNO_STOCK_UNIVERSE

ALGO_IDS = ["long_pullback", "short_bounce", "accumulation", "distribution", "zone_trade"]

MAX_SYMBOLS = 50
MAX_HOLD_BARS = 60          # safety cap — spec gives no timeout, avoids runaway open trades
ARM_EXPIRY_BARS = 20        # accumulation/distribution watch-arm expiry (user-confirmed)
MIN_TURNOVER_CR = 25.0
DEFAULT_ACCOUNT_CAPITAL = 1_000_000.0

WEIGHTS = {
    "long_pullback": {"rsi": 0.25, "dip": 0.20, "delivery": 0.20, "vol_dry": 0.15, "rs": 0.12, "trend": 0.08},
    "short_bounce":  {"rsi": 0.25, "bounce": 0.20, "delivery": 0.20, "vol_dry": 0.15, "rs": 0.12, "trend": 0.08},
    "accumulation":  {"delivery_surge": 0.55, "tightness": 0.45},
    "distribution":  {"effort_result": 0.30, "decay": 0.25, "failed_highs": 0.20, "down_vol_bias": 0.15, "rs": 0.10},
    "zone_trade":    {"verdict": 1.0},
}

TIERS = {
    "long_pullback": [(0.70, "STRONG BUY"), (0.55, "BUY"), (0.40, "WATCH")],
    "short_bounce":  [(0.70, "STRONG SHORT"), (0.55, "SHORT"), (0.40, "WATCH")],
    "accumulation":  [(0.60, "WATCH")],
    "distribution":  [(0.60, "WATCH")],
    "zone_trade":    [(1.0, "GO")],
}

ALGO_METADATA = {
    "long_pullback": {
        "id": "long_pullback", "label": "Long Pullback", "direction": "long", "universe": "any",
        "description": "Buy healthy dips in confirmed uptrends — F&O or cash, same logic.",
        "gates": ["20-day avg turnover ≥ ₹25 cr", "close > SMA50", "SMA50 > SMA200"],
        "weights": WEIGHTS["long_pullback"], "tiers": TIERS["long_pullback"],
        "entry": "Enter at BUY tier (score ≥ 0.55) while gates hold.",
        "trade": "Stop = close − 1.5×ATR14 · Target = close + 3×ATR14 (2:1) · 1% risk, score-scaled 50–100%.",
    },
    "short_bounce": {
        "id": "short_bounce", "label": "Short Bounce", "direction": "short", "universe": "fno_only",
        "description": "Short weak bounces in confirmed downtrends — F&O-eligible symbols only.",
        "gates": ["20-day avg turnover ≥ ₹25 cr", "close < SMA50", "SMA50 < SMA200"],
        "weights": WEIGHTS["short_bounce"], "tiers": TIERS["short_bounce"],
        "entry": "Enter at SHORT tier (score ≥ 0.55) while gates hold.",
        "trade": "Stop = close + 1.5×ATR14 · Target = close − 3×ATR14 (2:1) · 0.75% flat risk.",
    },
    "accumulation": {
        "id": "accumulation", "label": "Accumulation", "direction": "long", "universe": "any",
        "description": "Spot quiet institutional buying; act only on the later breakout, not the score.",
        "gates": ["20-day avg turnover ≥ ₹25 cr", "5D delivery ≥ 1.10× 20D avg (cash) / 1.05× (F&O)",
                   "20-day price change ≤ 5%", "close > SMA200"],
        "weights": WEIGHTS["accumulation"], "tiers": TIERS["accumulation"],
        "entry": "Score ≥ 0.60 arms a 20-day watch; entry fires on a breakout above the prior 20-day high with volume ≥ 1.5× 20-day avg.",
        "trade": "Stop = close − 2×ATR14 · Target = close + 4×ATR14 (1:2) · 1% flat risk.",
    },
    "distribution": {
        "id": "distribution", "label": "Distribution", "direction": "short", "universe": "fno_only",
        "description": "Spot quiet institutional selling; short the later breakdown.",
        "gates": ["20-day avg turnover ≥ ₹25 cr", "5D volume ≥ 1.2× 20D avg", "20-day price change ≤ 2%",
                   "close ≥3% below the 20-day high", "close < SMA50"],
        "weights": WEIGHTS["distribution"], "tiers": TIERS["distribution"],
        "entry": "Score ≥ 0.60 arms a 20-day watch; entry fires on a breakdown below the prior 20-day low with volume ≥ 1.5× 20-day avg.",
        "trade": "Stop = close + 2×ATR14 · Target = close − 4×ATR14 (1:2) · 0.5% flat risk (smallest — noisiest signal).",
    },
    "zone_trade": {
        "id": "zone_trade", "label": "Support Zone Trade", "direction": "long", "universe": "any",
        "description": "Ported from the Trade Calculator sheet — buy a pullback into the SMA50 support zone in a confirmed uptrend, with an ATR-buffered stop and risk-% position sizing.",
        "gates": ["20-day avg turnover ≥ ₹25 cr", "close > SMA200 (uptrend)",
                   "bar's low touches the SMA50 zone, closes back above it"],
        "weights": WEIGHTS["zone_trade"], "tiers": TIERS["zone_trade"],
        "entry": "Enter at close on the zone-touch bar, only if the SL-vs-volatility check (risk/share ≥ 1×ATR14) passes.",
        "trade": "Stop = SMA50 − 0.5×ATR14 (zone buffer) · Target = entry + 2×risk-per-share (2:1 R:R, matches the sheet's min R:R gate) · 1% flat risk.",
    },
}


# ── Factor score transforms ──────────────────────────────────────────────────

def _triangular_score(actual: pd.Series, target: float, tolerance: float) -> pd.Series:
    """Peaks at 1.0 when actual==target, linear falloff to 0 at ±tolerance."""
    return (1 - (actual - target).abs() / tolerance).clip(lower=0, upper=1)


def _one_sided_score(actual: pd.Series, ideal_at: float, tolerance: float,
                     better: Literal["higher", "lower"]) -> pd.Series:
    """
    better="higher": 1.0 at actual>=ideal_at, 0 at actual<=ideal_at-tolerance.
    better="lower":  1.0 at actual<=ideal_at, 0 at actual>=ideal_at+tolerance.
    """
    if better == "higher":
        return ((actual - (ideal_at - tolerance)) / tolerance).clip(lower=0, upper=1)
    return (((ideal_at + tolerance) - actual) / tolerance).clip(lower=0, upper=1)


def _rsi_sweetness_short(rsi: pd.Series, lo: float = 45, hi: float = 58, band: float = 13) -> pd.Series:
    """Flat 1.0 inside [lo,hi] (the downtrend-suppressed RSI zone), linear falloff outside."""
    score = pd.Series(1.0, index=rsi.index)
    below = rsi < lo
    above = rsi > hi
    score = score.where(~below, (1 - (lo - rsi) / band).clip(lower=0))
    score = score.where(~above, (1 - (rsi - hi) / band).clip(lower=0))
    return score.clip(lower=0, upper=1)


# ── Feature attachment ───────────────────────────────────────────────────────

def _fetch_delivery(symbol: str, from_date: str, to_date: str) -> pd.DataFrame:
    db = get_db()
    return db.execute(
        "SELECT date, delivery_pct FROM stock_delivery WHERE symbol = ? AND date BETWEEN ? AND ? ORDER BY date",
        [symbol, from_date, to_date],
    ).df()


def fetch_nifty_series(from_date: str, to_date: str) -> pd.DataFrame:
    """Fetch NIFTY 50 once per request — passed into attach_quant_factors per symbol."""
    db = get_db()
    return db.execute(
        "SELECT date, close AS nifty_close FROM index_ohlcv WHERE index_name = 'NIFTY 50' AND date BETWEEN ? AND ? ORDER BY date",
        [from_date, to_date],
    ).df()


def attach_quant_factors(df: pd.DataFrame, symbol: str, from_date: str, to_date: str,
                         nifty_df: pd.DataFrame) -> pd.DataFrame:
    """
    Add every column the 4 algos' gates/scores need, on top of a prepare_frame()
    output (which already has sma_50/200, rsi_14, atr_14, volume_sma_20).
    All rolling windows are inclusive of the current bar, per spec.
    """
    df = df.copy()
    df["date"] = pd.to_datetime(df["date"])

    # pandas-ta returns an all-None OBJECT-dtype column (not float NaN) when there
    # aren't enough bars for a long-window indicator (e.g. sma_200 with <200 bars).
    # Comparing object-None with >/< raises TypeError instead of gracefully being
    # False — coerce to numeric so short date ranges degrade to "gate never fires"
    # instead of crashing.
    for col in ("sma_50", "sma_200", "rsi_14", "atr_14", "volume_sma_20"):
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")

    # Turnover (₹) and its 20-day average, in crores.
    df["turnover"] = df["close"].astype(float) * df["volume"].astype(float)
    df["turnover_sma_20_cr"] = df["turnover"].rolling(20).mean() / 1e7

    # 20-day high/low — inclusive (scoring) and prior-20-days (breakout trigger).
    df["high_20"] = df["high"].rolling(20).max()
    df["low_20"] = df["low"].rolling(20).min()
    df["high_20_prior"] = df["high_20"].shift(1)
    df["low_20_prior"] = df["low_20"].shift(1)

    # 5-day volume avg (volume_sma_20 already present from prepare_frame).
    df["volume_sma_5"] = df["volume"].astype(float).rolling(5).mean()
    df["vr5_20"] = df["volume_sma_5"] / df["volume_sma_20"].replace(0, np.nan)

    # 20-day price change %.
    df["chg_20d_pct"] = (df["close"] / df["close"].shift(20) - 1) * 100

    # Down-day volume bias — fraction of the last 5 days' volume on down-close days.
    down_vol = df["volume"].where(df["close"] < df["close"].shift(1), 0.0)
    df["down_day_vol_frac_5"] = (
        down_vol.rolling(5).sum() / df["volume"].rolling(5).sum().replace(0, np.nan)
    )

    # Delivery — separate table, joined by date, then rolling-averaged.
    deliv = _fetch_delivery(symbol, from_date, to_date)
    if not deliv.empty:
        deliv["date"] = pd.to_datetime(deliv["date"])
        deliv = deliv.sort_values("date")
        deliv["delivery_sma_5"] = deliv["delivery_pct"].rolling(5).mean()
        deliv["delivery_sma_20"] = deliv["delivery_pct"].rolling(20).mean()
        df = df.merge(deliv[["date", "delivery_pct", "delivery_sma_5", "delivery_sma_20"]], on="date", how="left")
    else:
        df["delivery_pct"] = np.nan
        df["delivery_sma_5"] = np.nan
        df["delivery_sma_20"] = np.nan
    df["delivery_ratio_20"] = (df["delivery_pct"] / df["delivery_sma_20"].replace(0, np.nan))
    df["delivery_surge_5v20"] = (df["delivery_sma_5"] / df["delivery_sma_20"].replace(0, np.nan))

    # NIFTY relative strength — 12-day stock return minus 12-day NIFTY return (pp).
    if not nifty_df.empty:
        nf = nifty_df.copy()
        nf["date"] = pd.to_datetime(nf["date"])
        df = df.merge(nf, on="date", how="left")
        df["nifty_close"] = df["nifty_close"].ffill()
        stock_ret_12 = df["close"].pct_change(12) * 100
        nifty_ret_12 = df["nifty_close"].pct_change(12) * 100
        df["nifty_rs_raw"] = stock_ret_12 - nifty_ret_12
    else:
        df["nifty_rs_raw"] = np.nan

    # Distance above/below SMA200, as a positive magnitude for both directions.
    df["pct_above_sma200"] = (df["close"] / df["sma_200"].replace(0, np.nan) - 1) * 100
    df["pct_below_sma200"] = -df["pct_above_sma200"]

    return df.reset_index(drop=True)


# ── Gates (hard AND filters, per algo) ──────────────────────────────────────

def _gates_long_pullback(df: pd.DataFrame) -> pd.Series:
    return (
        (df["turnover_sma_20_cr"] >= MIN_TURNOVER_CR)
        & (df["close"] > df["sma_50"])
        & (df["sma_50"] > df["sma_200"])
    ).fillna(False)


def _gates_short_bounce(df: pd.DataFrame) -> pd.Series:
    return (
        (df["turnover_sma_20_cr"] >= MIN_TURNOVER_CR)
        & (df["close"] < df["sma_50"])
        & (df["sma_50"] < df["sma_200"])
    ).fillna(False)


def _gates_accumulation(df: pd.DataFrame, is_fno: bool) -> pd.Series:
    surge_threshold = 1.05 if is_fno else 1.10
    return (
        (df["turnover_sma_20_cr"] >= MIN_TURNOVER_CR)
        & (df["delivery_surge_5v20"] >= surge_threshold)
        & (df["chg_20d_pct"].abs() <= 5)
        & (df["close"] > df["sma_200"])
    ).fillna(False)


def _gates_distribution(df: pd.DataFrame) -> pd.Series:
    gap_from_high_pct = (df["high_20"] - df["close"]) / df["high_20"].replace(0, np.nan) * 100
    return (
        (df["turnover_sma_20_cr"] >= MIN_TURNOVER_CR)
        & (df["vr5_20"] >= 1.2)
        & (df["chg_20d_pct"] <= 2)
        & (gap_from_high_pct >= 3)
        & (df["close"] < df["sma_50"])
    ).fillna(False)


# ── Scores (weighted 0-1 sum, per algo) ─────────────────────────────────────

def score_long_pullback(df: pd.DataFrame) -> tuple[pd.Series, dict[str, pd.Series]]:
    w = WEIGHTS["long_pullback"]
    dip_dist = (df["high_20"] - df["close"]) / df["atr_14"].replace(0, np.nan)
    factors = {
        "rsi":      _triangular_score(df["rsi_14"], 45, 20),
        "dip":      _triangular_score(dip_dist, 2.5, 2.5),
        "delivery": _one_sided_score(df["delivery_ratio_20"].fillna(1.0), 1.5, 1.0, "higher"),
        "vol_dry":  _one_sided_score(df["vr5_20"].fillna(1.0), 0.5, 1.0, "lower"),
        "rs":       _one_sided_score(df["nifty_rs_raw"].fillna(0.0), 8.0, 8.0, "higher"),
        "trend":    _one_sided_score(df["pct_above_sma200"].fillna(0.0), 15.0, 15.0, "higher"),
    }
    total = sum(factors[k] * w[k] for k in w)
    return total, factors


def score_short_bounce(df: pd.DataFrame) -> tuple[pd.Series, dict[str, pd.Series]]:
    w = WEIGHTS["short_bounce"]
    bounce_dist = (df["close"] - df["low_20"]) / df["atr_14"].replace(0, np.nan)
    factors = {
        "rsi":     _rsi_sweetness_short(df["rsi_14"]),
        "bounce":  _triangular_score(bounce_dist, 2.5, 2.5),
        "delivery": _one_sided_score(df["delivery_ratio_20"].fillna(1.0), 0.5, 1.0, "lower"),
        "vol_dry": _one_sided_score(df["vr5_20"].fillna(1.0), 0.5, 1.0, "lower"),
        "rs":      _one_sided_score(df["nifty_rs_raw"].fillna(0.0), -8.0, 8.0, "lower"),
        "trend":   _one_sided_score(df["pct_below_sma200"].fillna(0.0), 15.0, 15.0, "higher"),
    }
    total = sum(factors[k] * w[k] for k in w)
    return total, factors


def score_accumulation(df: pd.DataFrame) -> tuple[pd.Series, dict[str, pd.Series]]:
    w = WEIGHTS["accumulation"]
    factors = {
        "delivery_surge": _one_sided_score(df["delivery_surge_5v20"].fillna(1.0), 1.6, 0.5, "higher"),
        "tightness":      _one_sided_score(df["chg_20d_pct"].abs().fillna(5.0), 0.0, 5.0, "lower"),
    }
    total = sum(factors[k] * w[k] for k in w)
    return total, factors


def score_distribution(df: pd.DataFrame) -> tuple[pd.Series, dict[str, pd.Series]]:
    w = WEIGHTS["distribution"]
    effort = _one_sided_score(df["vr5_20"].fillna(1.0), 1.8, 0.6, "higher")
    result = _one_sided_score(df["chg_20d_pct"].abs().fillna(2.0), 0.0, 2.0, "lower")
    gap_from_high_pct = (df["high_20"] - df["close"]) / df["high_20"].replace(0, np.nan) * 100
    factors = {
        "effort_result": effort * result,
        "decay":         _one_sided_score(df["chg_20d_pct"].fillna(0.0), -10.0, 10.0, "lower"),
        "failed_highs":  _one_sided_score(gap_from_high_pct.fillna(0.0), 8.0, 5.0, "higher"),
        "down_vol_bias": df["down_day_vol_frac_5"].fillna(0.5).clip(0, 1),
        "rs":            _one_sided_score(df["nifty_rs_raw"].fillna(0.0), -8.0, 8.0, "lower"),
    }
    total = sum(factors[k] * w[k] for k in w)
    return total, factors


# ── Zone Trade (ported from the Trade Calculator sheet) ─────────────────────
# Entry rule is a designed proxy: the sheet takes a manually-read support zone;
# here the zone is SMA50 (support in an uptrend) so the algo can run
# systematically over history. SL/target are zone-relative, not entry-relative,
# so this algo passes explicit stop/target series into _run_direct_trades
# instead of the usual ATR-multiple-from-entry.

_ZONE_ATR_MULT = 0.5     # matches the sheet's default ATR multiplier
_ZONE_RR = 2.0           # matches the sheet's minimum-R:R gate (2:1)


def _gates_zone_trade(df: pd.DataFrame) -> pd.Series:
    return (
        (df["turnover_sma_20_cr"] >= MIN_TURNOVER_CR)
        & (df["close"] > df["sma_200"])       # uptrend context
        & (df["low"] <= df["sma_50"])          # pullback touched the zone
        & (df["close"] > df["sma_50"])         # zone held, closed back above it
    ).fillna(False)


def _zone_trade_levels(df: pd.DataFrame) -> tuple[pd.Series, pd.Series]:
    """Zone-relative stop/target, keyed to the entry bar (entry = that bar's close)."""
    stop = df["sma_50"] - _ZONE_ATR_MULT * df["atr_14"]
    risk_per_share = df["close"] - stop
    target = df["close"] + _ZONE_RR * risk_per_share
    return stop, target


def score_zone_trade(df: pd.DataFrame) -> tuple[pd.Series, dict[str, pd.Series]]:
    """Collapses the sheet's SL-vs-volatility check into a 0/1 'verdict' factor —
    the R:R check is always true by construction (target fixed at 2R); the
    risk-size and capital/leverage checks are account-level, applied at
    position-sizing time in the trade loop rather than per-bar here."""
    stop, _ = _zone_trade_levels(df)
    risk_per_share = df["close"] - stop
    sl_vol_ok = (risk_per_share >= df["atr_14"]).astype(float)
    return sl_vol_ok, {"verdict": sl_vol_ok}


def _assign_tier(score: float, algo: str) -> str:
    for threshold, label in TIERS[algo]:
        if score >= threshold:
            return label
    return "WEAK" if algo in ("accumulation", "distribution") else "NONE"


# ── Position sizing ──────────────────────────────────────────────────────────

def _scaled_risk_pct(score: float, base_pct: float, entry_threshold: float) -> float:
    """Long Pullback's 'score-scaled' risk: 50% of base at the entry threshold,
    ramping linearly to 100% of base at score=1.0. Designed default — flagged tunable."""
    frac = 0.5 + 0.5 * (score - entry_threshold) / (1.0 - entry_threshold)
    return base_pct * min(max(frac, 0.5), 1.0)


def _position_size(account_capital: float, risk_pct: float, entry: float, stop: float) -> int:
    risk_per_share = abs(entry - stop)
    if risk_per_share <= 0 or not math.isfinite(risk_per_share):
        return 0
    risk_amount = account_capital * risk_pct / 100
    shares = int(risk_amount // risk_per_share)
    max_affordable = int(account_capital // entry) if entry > 0 else 0
    return max(0, min(shares, max_affordable))


# ── Trade loops ───────────────────────────────────────────────────────────────

def _run_direct_trades(df: pd.DataFrame, gates: pd.Series, score: pd.Series, algo: str,
                       direction: Literal["long", "short"], entry_threshold: float,
                       atr_stop_mult: float, atr_target_mult: float,
                       base_risk_pct: float, score_scaled: bool,
                       account_capital: float,
                       stop_series: Optional[pd.Series] = None,
                       target_series: Optional[pd.Series] = None) -> list[dict]:
    trades: list[dict] = []
    in_trade = False
    entry_idx = entry_price = stop_price = target_price = 0.0
    shares = 0

    for i in range(1, len(df)):
        row = df.iloc[i]
        close, high, low = float(row["close"]), float(row["high"]), float(row["low"])
        if pd.isna(close) or pd.isna(high) or pd.isna(low):
            continue

        if in_trade:
            bars_held = i - entry_idx
            exit_price = exit_reason = None
            if direction == "long":
                if low <= stop_price:
                    exit_price, exit_reason = stop_price, "sl"
                elif high >= target_price:
                    exit_price, exit_reason = target_price, "target"
            else:
                if high >= stop_price:
                    exit_price, exit_reason = stop_price, "sl"
                elif low <= target_price:
                    exit_price, exit_reason = target_price, "target"
            if exit_price is None and bars_held >= MAX_HOLD_BARS:
                exit_price, exit_reason = close, "timeout"

            if exit_price is not None:
                pnl = (exit_price - entry_price) * shares if direction == "long" else (entry_price - exit_price) * shares
                pnl_pct = ((exit_price / entry_price - 1) * 100 if direction == "long"
                          else (entry_price / exit_price - 1) * 100)
                trades.append({
                    "entry_date": str(df.iloc[entry_idx]["date"]), "exit_date": str(row["date"]),
                    "entry_price": round(entry_price, 2), "stop_price": round(stop_price, 2),
                    "target_price": round(target_price, 2), "exit_price": round(exit_price, 2),
                    "exit_reason": exit_reason, "direction": direction, "shares": shares,
                    "pnl": round(pnl, 2), "pnl_pct": round(pnl_pct, 2),
                    "score": round(float(df.iloc[entry_idx]["_score"]), 3),
                    "tier": df.iloc[entry_idx]["_tier"],
                })
                in_trade = False

        if not in_trade and bool(gates.iloc[i]) and score.iloc[i] >= entry_threshold and close > 0:
            atr = float(row["atr_14"]) if not pd.isna(row["atr_14"]) else 0.0
            if atr <= 0:
                continue
            entry_price = close
            # stop_series/target_series let an algo specify a ZONE-relative stop
            # (e.g. support level minus an ATR buffer) instead of the default
            # entry-relative ATR-multiple stop every other algo here uses.
            if stop_series is not None and target_series is not None:
                stop_price = float(stop_series.iloc[i])
                target_price = float(target_series.iloc[i])
                if pd.isna(stop_price) or pd.isna(target_price):
                    continue
            else:
                stop_price = entry_price - atr_stop_mult * atr if direction == "long" else entry_price + atr_stop_mult * atr
                target_price = entry_price + atr_target_mult * atr if direction == "long" else entry_price - atr_target_mult * atr
            risk_pct = (_scaled_risk_pct(score.iloc[i], base_risk_pct, entry_threshold) if score_scaled else base_risk_pct)
            shares = _position_size(account_capital, risk_pct, entry_price, stop_price)
            if shares < 1:
                continue
            entry_idx = i
            in_trade = True
            df.at[df.index[i], "_score"] = score.iloc[i]
            df.at[df.index[i], "_tier"] = _assign_tier(score.iloc[i], algo)

    return trades


def _run_armed_trades(df: pd.DataFrame, gates: pd.Series, score: pd.Series, algo: str,
                      direction: Literal["long", "short"],
                      atr_stop_mult: float, atr_target_mult: float,
                      risk_pct: float, account_capital: float) -> tuple[list[dict], list[dict]]:
    trades: list[dict] = []
    armed_not_triggered: list[dict] = []
    in_trade = False
    entry_idx = entry_price = stop_price = target_price = 0.0
    shares = 0
    armed_since: Optional[int] = None
    trades_arm_date: Optional[str] = None
    trades_arm_score: Optional[float] = None

    for i in range(1, len(df)):
        row = df.iloc[i]
        close, high, low, volume = float(row["close"]), float(row["high"]), float(row["low"]), float(row["volume"])
        if pd.isna(close) or pd.isna(high) or pd.isna(low):
            continue

        if in_trade:
            bars_held = i - entry_idx
            exit_price = exit_reason = None
            if direction == "long":
                if low <= stop_price:
                    exit_price, exit_reason = stop_price, "sl"
                elif high >= target_price:
                    exit_price, exit_reason = target_price, "target"
            else:
                if high >= stop_price:
                    exit_price, exit_reason = stop_price, "sl"
                elif low <= target_price:
                    exit_price, exit_reason = target_price, "target"
            if exit_price is None and bars_held >= MAX_HOLD_BARS:
                exit_price, exit_reason = close, "timeout"

            if exit_price is not None:
                pnl = (exit_price - entry_price) * shares if direction == "long" else (entry_price - exit_price) * shares
                pnl_pct = ((exit_price / entry_price - 1) * 100 if direction == "long"
                          else (entry_price / exit_price - 1) * 100)
                trades.append({
                    "entry_date": str(df.iloc[entry_idx]["date"]), "exit_date": str(row["date"]),
                    "entry_price": round(entry_price, 2), "stop_price": round(stop_price, 2),
                    "target_price": round(target_price, 2), "exit_price": round(exit_price, 2),
                    "exit_reason": exit_reason, "direction": direction, "shares": shares,
                    "pnl": round(pnl, 2), "pnl_pct": round(pnl_pct, 2),
                    "arm_date": trades_arm_date, "trigger_date": str(df.iloc[entry_idx]["date"]),
                    "arm_score": trades_arm_score,
                })
                in_trade = False
            continue

        if armed_since is not None:
            if (i - armed_since) > ARM_EXPIRY_BARS:
                armed_not_triggered.append({
                    "arm_date": str(df.iloc[armed_since]["date"]),
                    "arm_score": round(float(score.iloc[armed_since]), 3),
                    "expired_date": str(row["date"]),
                })
                armed_since = None
                continue

            vol_sma_20 = float(row["volume_sma_20"]) if not pd.isna(row["volume_sma_20"]) else None
            vol_ok = vol_sma_20 is not None and vol_sma_20 > 0 and volume >= 1.5 * vol_sma_20
            hi_prior = row.get("high_20_prior")
            lo_prior = row.get("low_20_prior")
            triggered = False
            if direction == "long" and vol_ok and hi_prior is not None and not pd.isna(hi_prior) and close > hi_prior:
                triggered = True
            elif direction == "short" and vol_ok and lo_prior is not None and not pd.isna(lo_prior) and close < lo_prior:
                triggered = True

            if triggered:
                atr = float(row["atr_14"]) if not pd.isna(row["atr_14"]) else 0.0
                if atr <= 0:
                    armed_since = None
                    continue
                entry_price = close
                stop_price = entry_price - atr_stop_mult * atr if direction == "long" else entry_price + atr_stop_mult * atr
                target_price = entry_price + atr_target_mult * atr if direction == "long" else entry_price - atr_target_mult * atr
                shares = _position_size(account_capital, risk_pct, entry_price, stop_price)
                if shares < 1:
                    armed_since = None
                    continue
                trades_arm_date = str(df.iloc[armed_since]["date"])
                trades_arm_score = round(float(score.iloc[armed_since]), 3)
                entry_idx = i
                in_trade = True
                armed_since = None
            continue

        if bool(gates.iloc[i]) and score.iloc[i] >= 0.60:
            armed_since = i

    return trades, armed_not_triggered


# ── Top-level dispatch ───────────────────────────────────────────────────────

def run_quant_signal(df: pd.DataFrame, algo: str, is_fno: bool, account_capital: float) -> dict:
    """df must already be prepare_frame()'d + attach_quant_factors()'d."""
    df = df.copy()
    df["_score"] = np.nan
    df["_tier"] = ""

    if algo == "long_pullback":
        gates = _gates_long_pullback(df)
        score, factors = score_long_pullback(df)
        trades = _run_direct_trades(df, gates, score, algo, "long", 0.55, 1.5, 3.0, 1.0, True, account_capital)
        armed_not_triggered = []
    elif algo == "short_bounce":
        gates = _gates_short_bounce(df)
        score, factors = score_short_bounce(df)
        trades = _run_direct_trades(df, gates, score, algo, "short", 0.55, 1.5, 3.0, 0.75, False, account_capital)
        armed_not_triggered = []
    elif algo == "accumulation":
        gates = _gates_accumulation(df, is_fno)
        score, factors = score_accumulation(df)
        trades, armed_not_triggered = _run_armed_trades(df, gates, score, algo, "long", 2.0, 4.0, 1.0, account_capital)
    elif algo == "distribution":
        gates = _gates_distribution(df)
        score, factors = score_distribution(df)
        trades, armed_not_triggered = _run_armed_trades(df, gates, score, algo, "short", 2.0, 4.0, 0.5, account_capital)
    elif algo == "zone_trade":
        gates = _gates_zone_trade(df)
        score, factors = score_zone_trade(df)
        stop_series, target_series = _zone_trade_levels(df)
        trades = _run_direct_trades(df, gates, score, algo, "long", 1.0, 0.0, 0.0, 1.0, False, account_capital,
                                    stop_series=stop_series, target_series=target_series)
        armed_not_triggered = []
    else:
        raise ValueError(f"Unknown algo: {algo}")

    winners = [t for t in trades if t["pnl"] > 0]
    total = len(trades)
    stats = {
        "total_trades": total,
        "win_rate_pct": round(len(winners) / total * 100, 1) if total else 0.0,
        "total_pnl": round(sum(t["pnl"] for t in trades), 2),
        "avg_pnl_pct": round(sum(t["pnl_pct"] for t in trades) / total, 2) if total else 0.0,
    }

    tier_series = score.apply(lambda s: _assign_tier(s, algo) if not pd.isna(s) else "")
    score_series = [
        {"date": str(d), "score": round(float(s), 3), "tier": t}
        for d, s, t in zip(df["date"], score, tier_series)
        if not pd.isna(s)
    ][-120:]  # last ~6 months of daily bars is plenty for a sparkline

    ohlcv = [
        {"date": str(r["date"]), "open": r["open"], "high": r["high"], "low": r["low"], "close": r["close"]}
        for _, r in df.iterrows() if not pd.isna(r["close"])
    ]

    return {
        "trades": trades,
        "armed_not_triggered": armed_not_triggered,
        "stats": stats,
        "score_series": score_series,
        "ohlcv": ohlcv,
    }


def is_fno_eligible(symbol: str) -> bool:
    return symbol.upper() in FNO_STOCK_UNIVERSE
