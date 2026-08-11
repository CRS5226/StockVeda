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

ALGO_IDS = ["long_pullback", "short_bounce", "accumulation", "distribution", "zone_trade", "swing_pullback", "swing_pullback_v2", "swing_pullback_sector_rs", "swing_pullback_v4", "swing_pullback_v5"]

MAX_SYMBOLS = 250
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
    "swing_pullback": {"rsi": 0.25, "dip": 0.20, "delivery": 0.20, "vol_dry": 0.15, "rs": 0.12, "trend": 0.08},
    "swing_pullback_v2": {"rsi": 0.25, "dip": 0.20, "delivery": 0.20, "vol_dry": 0.15, "rs": 0.12, "trend": 0.08},
    "swing_pullback_sector_rs": {"rsi": 0.25, "dip": 0.20, "delivery": 0.20, "vol_dry": 0.15, "rs": 0.12, "trend": 0.08},
    "swing_pullback_v4": {"rsi": 0.25, "dip": 0.20, "delivery": 0.20, "vol_dry": 0.15, "rs": 0.12, "trend": 0.08},
    "swing_pullback_v5": {"rsi": 0.25, "dip": 0.20, "delivery": 0.20, "vol_dry": 0.15, "rs": 0.12, "trend": 0.08},
}

TIERS = {
    "long_pullback": [(0.70, "STRONG BUY"), (0.55, "BUY"), (0.40, "WATCH")],
    "short_bounce":  [(0.70, "STRONG SHORT"), (0.55, "SHORT"), (0.40, "WATCH")],
    "accumulation":  [(0.60, "WATCH")],
    "distribution":  [(0.60, "WATCH")],
    "zone_trade":    [(1.0, "GO")],
    "swing_pullback": [(0.70, "STRONG BUY"), (0.55, "BUY"), (0.40, "WATCH")],
    "swing_pullback_v2": [(0.70, "STRONG BUY"), (0.55, "BUY"), (0.40, "WATCH")],
    "swing_pullback_sector_rs": [(0.70, "STRONG BUY"), (0.55, "BUY"), (0.40, "WATCH")],
    "swing_pullback_v4": [(0.70, "STRONG BUY"), (0.55, "BUY"), (0.40, "WATCH")],
    "swing_pullback_v5": [(0.70, "STRONG BUY"), (0.55, "BUY"), (0.40, "WATCH")],
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
        "description": "Short weak bounces in confirmed downtrends — F&O-eligible symbols only. Fills at the next day's open (not the signal day's own close, which isn't realistically fillable) and requires a higher-conviction score (≥0.65, raised from 0.55) — validated on the full 204-stock F&O universe: cut the 3yr loss from -₹13.9L to -₹3.4L and raised win rate to 32.3%, close to the 33.3% breakeven this setup's 2:1 reward:risk needs. Still net-negative overall — a bull-market-heavy 3yr test window is a real headwind for any short strategy, not a fixable bug.",
        "gates": ["20-day avg turnover ≥ ₹25 cr", "close < SMA50", "SMA50 < SMA200"],
        "weights": WEIGHTS["short_bounce"], "tiers": TIERS["short_bounce"],
        "entry": "Score ≥ 0.65 (raised from 0.55) while gates hold; fires on the next trading day's open, not same-day.",
        "trade": "Stop = entry + 1.5×ATR14 · Target = entry − 3×ATR14 (2:1) · 0.75% flat risk.",
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
    "swing_pullback": {
        "id": "swing_pullback", "label": "Swing Trade Pullback", "direction": "long", "universe": "any",
        "description": "Momentum/delivery pullback with a multi-source support-zone confluence read (fractal swings, weekly pivots, MAs, fib retracement, round numbers, role-reversal) — buys a confirmed dip in a rising trend at a computed zone-anchored entry.",
        "gates": ["20-day avg turnover ≥ ₹25 cr", "close > SMA50", "SMA50 > SMA200", "SMA50 rising vs 10 days ago"],
        "weights": WEIGHTS["swing_pullback"], "tiers": TIERS["swing_pullback"],
        "entry": "Score ≥ 0.40 (WATCH) builds a confluence support zone (Omega score) and arms a pending PULLBACK/RETEST/BREAKOUT order for up to 20 trading days; fires when price reaches the computed entry level.",
        "trade": "Stop = min(swing-low, zone-low) − ATR-scaled buffer (buffer widens with confirmation + volatility regime) · Target = min(3R, nearest resistance wall), capped at the 52-week high, gated at ≥2:1 R:R · Risk % scales with ATR% and score, capped at 2% of capital.",
    },
    "swing_pullback_v2": {
        "id": "swing_pullback_v2", "label": "Swing Trade Pullback v2 (Midcap-tuned)", "direction": "long", "universe": "any",
        "description": "Identical to Swing Trade Pullback, with one tuned exception for symbols in your \"midcap 150\" watchlist: the zone-anchored discount entry fires more readily (0.25×ATR overshoot threshold vs 0.5× for everything else), since backtesting showed the default chase-the-breakout entry underperforms specifically on midcap names. Live watchlist lookup, not a frozen list — edit \"midcap 150\" to update which symbols get the tuned behavior. Verified: Midcap 150 3yr PF 0.90×→1.20×, P&L -₹37,146→+₹55,898; every other symbol's behavior is byte-for-byte identical to v1.",
        "gates": ["20-day avg turnover ≥ ₹25 cr", "close > SMA50", "SMA50 > SMA200", "SMA50 rising vs 10 days ago"],
        "weights": WEIGHTS["swing_pullback_v2"], "tiers": TIERS["swing_pullback_v2"],
        "entry": "Same as Swing Trade Pullback, except symbols in the \"midcap 150\" watchlist get a lower (0.25×ATR) zone-anchor overshoot threshold, routing more of them into the discount entry.",
        "trade": "Same as Swing Trade Pullback for non-midcap symbols; midcap-watchlist symbols get the zone-anchored entry more often.",
    },
    "swing_pullback_sector_rs": {
        "id": "swing_pullback_sector_rs", "label": "Swing Trade Pullback v3 (Sector-RS)", "direction": "long", "universe": "any",
        "description": "Identical to Swing Trade Pullback, except the relative-strength factor compares each stock to its own NIFTY sector index (Bank, IT, FMCG, Pharma, Metal, Energy, Realty) instead of broad Nifty 50 — a bank stock's strength is measured against Bank Nifty, not diluted by unrelated sectors. Falls back to the Nifty-relative version for any symbol whose sector isn't mapped or has no matching index data. Sector classification is cached (yfinance, once per symbol) rather than fetched live every run. Verified: beats v1 on all 9 tested index baskets with zero regressions, including flipping Nifty Bank and Nifty Next 50 from losses to profits.",
        "gates": ["20-day avg turnover ≥ ₹25 cr", "close > SMA50", "SMA50 > SMA200", "SMA50 rising vs 10 days ago"],
        "weights": WEIGHTS["swing_pullback_sector_rs"], "tiers": TIERS["swing_pullback_sector_rs"],
        "entry": "Same as Swing Trade Pullback — only the RS factor's benchmark changes (sector index vs Nifty).",
        "trade": "Same as Swing Trade Pullback — only the RS factor's benchmark changes, not stop/target/sizing.",
    },
    "swing_pullback_v4": {
        "id": "swing_pullback_v4", "label": "Swing Trade Pullback v4 (Sector-RS + Volume)", "direction": "long", "universe": "any",
        "description": "Builds on Swing Trade Pullback v3 (sector-relative-strength) with the volume principle applied to PULLBACK entries: a healthy retest shows volume drying up (≤1.0× 20-day avg, was ≥1.2×), and the actual breakout/trigger day must show volume picking up (≥1.5× avg). Validated via train/holdout split across all 9 index baskets on both v1 and v3 bases — broad, genuine win in most baskets, but Nifty Mid Select regresses on holdout (PF ~1.9×→0.53×) under both bases, a known caveat rather than a disqualifier. Chosen as v4's base over v1 since v3+volume beat v1+volume in almost every basket.",
        "gates": ["20-day avg turnover ≥ ₹25 cr", "close > SMA50", "SMA50 > SMA200", "SMA50 rising vs 10 days ago"],
        "weights": WEIGHTS["swing_pullback_v4"], "tiers": TIERS["swing_pullback_v4"],
        "entry": "Same as v3, except PULLBACK confirmation requires volume ≤1.0× 20-day avg (quiet retest) and the trigger/fill day requires volume ≥1.5× avg (breakout pickup).",
        "trade": "Same as v3 — only the PULLBACK entry's volume conditions change, not stop/target/sizing.",
    },
    "swing_pullback_v5": {
        "id": "swing_pullback_v5", "label": "Swing Trade Pullback v5 (No Fibonacci)", "direction": "long", "universe": "any",
        "description": "Identical to v4 (sector-RS + volume), with the Fibonacci retracement levels (0.5 and 0.618 of the last swing) dropped from the confluence-zone level pool. Motivated by external research finding no standalone empirical support for Fibonacci retracements, and confirmed here: an isolated ablation test (train/holdout split, all 9 index baskets) showed removing Fib improved holdout PF in 13 of 16 basket/variant combinations — including fixing v4's one known weak spot, Nifty Mid Select (holdout PF 0.53×→1.32×). Training-set results were mixed, consistent with Fib being a training-data curve-fit rather than a durable signal.",
        "gates": ["20-day avg turnover ≥ ₹25 cr", "close > SMA50", "SMA50 > SMA200", "SMA50 rising vs 10 days ago"],
        "weights": WEIGHTS["swing_pullback_v5"], "tiers": TIERS["swing_pullback_v5"],
        "entry": "Same as v4, except the confluence-zone level pool excludes the two Fibonacci retracement levels.",
        "trade": "Same as v4 — only the confluence-zone level pool changes, not stop/target/sizing.",
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


def fetch_midcap_scope() -> frozenset:
    """swing_pullback_v2 only — live lookup of the user-maintained "midcap 150"
    watchlist (fetched once per request, not hardcoded) so the sector-tuned entry
    logic stays current if the watchlist is ever edited, instead of drifting out
    of sync with actual index membership like a frozen symbol list would."""
    db = get_db()
    row = db.execute("SELECT symbols FROM watchlists WHERE name = 'midcap 150'").fetchone()
    return frozenset(row[0]) if row else frozenset()


# swing_pullback_sector_rs only — maps yfinance's per-stock "sector" string to
# the matching NIFTY sector index. Same mapping used by the Stock Detail page's
# sector-compare chart (backend/routes/stock.py:_SECTOR_INDEX) — duplicated
# here rather than imported to avoid routes-importing-into-core coupling.
_SECTOR_INDEX_MAP = {
    "Technology": "NIFTY IT",
    "Financial Services": "NIFTY BANK",
    "Consumer Staples": "NIFTY FMCG",
    "Healthcare": "NIFTY PHARMA",
    "Basic Materials": "NIFTY METAL",
    "Energy": "NIFTY ENERGY",
    "Real Estate": "NIFTY REALTY",
}


def get_sector_index(symbol: str) -> Optional[str]:
    """Cached lookup of which NIFTY sector index a symbol maps to. yfinance's
    sector classification was previously fetched live on every call with zero
    caching (see stock.py's sector-compare endpoint) — cached here in
    stock_sector (schema.sql) so it's a live yfinance call once per symbol
    ever, not once per backtest run."""
    db = get_db()
    row = db.execute("SELECT sector FROM stock_sector WHERE symbol = ?", [symbol]).fetchone()
    if row is not None:
        sector = row[0] or ""
    else:
        sector = ""
        try:
            import yfinance as yf
            sector = yf.Ticker(f"{symbol}.NS").info.get("sector") or ""
        except Exception:
            pass
        db.execute("INSERT OR REPLACE INTO stock_sector (symbol, sector) VALUES (?, ?)", [symbol, sector])
    return _SECTOR_INDEX_MAP.get(sector)


def fetch_sector_index_series(index_name: str, from_date: str, to_date: str) -> pd.DataFrame:
    db = get_db()
    return db.execute(
        "SELECT date, close AS sector_close FROM index_ohlcv WHERE index_name = ? AND date BETWEEN ? AND ? ORDER BY date",
        [index_name, from_date, to_date],
    ).df()


# ── Market regime (year-wise Nifty/Sensex context) ──────────────────────────
# Context panel for the Quant Signals UI — separate from any single algo's
# gates/score, just "what was the broad market doing" per calendar year over
# the chosen date range. Label rule is intentionally the simple sign-based one
# the user asked for (negative Nifty return = bearish year) — a flat/neutral
# band can be layered on later once this is checked against real data.

def _fetch_index_series(index_name: str, from_date: str, to_date: str) -> pd.DataFrame:
    db = get_db()
    return db.execute(
        "SELECT date, close FROM index_ohlcv WHERE index_name = ? AND date BETWEEN ? AND ? ORDER BY date",
        [index_name, from_date, to_date],
    ).df()


def compute_market_regime(from_date: str, to_date: str) -> list[dict]:
    """Per-calendar-year Nifty/Sensex return over [from_date, to_date], each
    year clipped to the requested range (so the first/last year may be partial).
    Label is sign-based on the Nifty return: negative = Bearish, else Bullish."""
    nifty = _fetch_index_series("NIFTY 50", from_date, to_date)
    sensex = _fetch_index_series("SENSEX", from_date, to_date)
    if nifty.empty:
        return []
    nifty["date"] = pd.to_datetime(nifty["date"])
    sensex["date"] = pd.to_datetime(sensex["date"]) if not sensex.empty else sensex

    start_year = nifty["date"].min().year
    end_year = nifty["date"].max().year

    def _year_return(df: pd.DataFrame, year: int) -> Optional[dict]:
        if df.empty:
            return None
        yr = df[df["date"].dt.year == year]
        if len(yr) < 2:
            return None
        first, last = float(yr["close"].iloc[0]), float(yr["close"].iloc[-1])
        if first <= 0:
            return None
        return {
            "start": round(first, 2), "end": round(last, 2),
            "return_pct": round((last / first - 1) * 100, 2),
            "from_date": str(yr["date"].iloc[0].date()), "to_date": str(yr["date"].iloc[-1].date()),
        }

    years = []
    for year in range(start_year, end_year + 1):
        nifty_yr = _year_return(nifty, year)
        if nifty_yr is None:
            continue
        sensex_yr = _year_return(sensex, year)
        label = "Bearish" if nifty_yr["return_pct"] < 0 else "Bullish"
        years.append({
            "year": year, "label": label,
            "nifty": nifty_yr, "sensex": sensex_yr,
        })
    return years


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
        # ideal_at=1.3/tolerance=0.3 (floor=1.0) recalibrated against observed
        # 5v20 delivery-surge ratios, which rarely exceed ~1.2-1.3x in practice —
        # the original 1.6x reference was unreachable, so WATCH (>=0.60) never fired.
        "delivery_surge": _one_sided_score(df["delivery_surge_5v20"].fillna(1.0), 1.3, 0.3, "higher"),
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


# ── Swing Trade Pullback (MOM_PULLBACK / DELIVERY_PULLBACK formula) ─────────
# Ported from the user's standalone formula spec. Unlike the other algos, this
# one builds a genuine multi-source support/resistance confluence map (fractal
# swings, weekly pivots, MAs/EMAs, fib retracement, round numbers, role-reversal)
# and derives entry/stop/target from that zone rather than a flat ATR multiple.
# Where the spec leaves a curve shape/tolerance/lookback unstated, a designed
# default is used (flagged inline) — same convention as the rest of this file.

_LEVEL_WEIGHTS = {"swing_high": 3, "swing_low": 3, "ma_ema": 2, "role_reversal": 2, "fib": 2,
                   "weekly_pivot": 1, "round_number": 1}
_TICK_SIZE = 0.05                  # NSE cash-segment tick
_SWING_LOOKBACK = 5                # fractal bars required on each side
_ROLE_REVERSAL_WINDOW = 120        # designed default — spec doesn't bound recency
_ROLE_REVERSAL_MAX_CANDIDATES = 6
_TARGET_52W_HEADROOM = 0.06         # allow target 6% past the old 52w high before capping —
                                    # a pure at-the-high cap was rejecting most pullback setups
                                    # in strong stocks via REJECT_RR (diagnostics-confirmed)
_TARGET_WALL_MIN_WEIGHT = 6        # confluence needed for a nearby wall to override the 3R
                                    # target (was 4, same as the support-zone threshold) —
                                    # raised so a marginal wall doesn't compress T1 below 2:1
_SWING_ARM_EXPIRY_BARS = 30        # separate from the shared ARM_EXPIRY_BARS (accum/distrib) —
                                    # 66% of armed swing_pullback orders expired unfilled at 20 bars
_ZONE_ANCHOR_OVERSHOOT_ATR = 0.5   # tried 0.25 globally (regressed PF/P&L on the full 3yr universe,
                                    # 1.157→1.102) AND tried 0.25 scoped to just Nifty Bank symbols
                                    # (made Nifty Bank itself worse too: 2yr PF 1.13→0.71, 3yr 0.72→0.40)
                                    # — a small-sample entry-style split (zone_anchored trades looked
                                    # better than default-entry trades for that sector) did NOT hold up
                                    # once actually forced at scale. See quant_signals_experiments.md.
_MIDCAP_ZONE_ANCHOR_OVERSHOOT_ATR = 0.25  # swing_pullback_v2 only — same idea, scoped to the "midcap 150"
                                    # watchlist instead, confirmed on real data: Midcap 150 3yr PF
                                    # 0.90×→1.20×, P&L -₹37,146→+₹55,898, control basket (Nifty Next 50,
                                    # 0 symbol overlap) completely unchanged. See quant_signals_experiments.md.


def attach_swing_pullback_factors(df: pd.DataFrame, symbol: str = "", sector_rs: bool = False) -> pd.DataFrame:
    """Extra columns for Swing Trade Pullback, on top of attach_quant_factors()
    output (already has sma_50/200, rsi_14, atr_14, volume_sma_20, high_20,
    delivery_ratio_20, pct_above_sma200, nifty_close, turnover_sma_20_cr).
    sector_rs (swing_pullback_sector_rs only) blends in sector-relative RS —
    falls back to the Nifty-relative version per-row wherever the symbol's
    sector is unmapped or its index has no data for that date, so it degrades
    gracefully instead of going NaN outright."""
    df = df.copy()
    df["sma_10"] = df["close"].rolling(10).mean()
    df["ema_10"] = df["close"].ewm(span=10, adjust=False).mean()
    df["high_52w"] = df["high"].rolling(252, min_periods=50).max()
    df["rvol"] = df["volume"].astype(float) / df["volume_sma_20"].replace(0, np.nan)

    nifty_ma200 = df["nifty_close"].rolling(200, min_periods=50).mean()
    nifty_rs_component = (df["nifty_close"] / nifty_ma200.replace(0, np.nan) - 1) * 100
    df["rs_pct"] = df["pct_above_sma200"] - nifty_rs_component

    if sector_rs:
        index_name = get_sector_index(symbol)
        if index_name:
            from_date = str(pd.to_datetime(df["date"].min()).date())
            to_date = str(pd.to_datetime(df["date"].max()).date())
            sec_df = fetch_sector_index_series(index_name, from_date, to_date)
            if not sec_df.empty:
                sec_df = sec_df.copy()
                sec_df["date"] = pd.to_datetime(sec_df["date"])
                df = df.merge(sec_df, on="date", how="left")
                df["sector_close"] = df["sector_close"].ffill()
                sector_ma200 = df["sector_close"].rolling(200, min_periods=50).mean()
                sector_rs_component = (df["sector_close"] / sector_ma200.replace(0, np.nan) - 1) * 100
                sector_rs_pct = df["pct_above_sma200"] - sector_rs_component
                df["rs_pct"] = sector_rs_pct.where(sector_rs_pct.notna(), df["rs_pct"])

    # Weekly pivots — most recently COMPLETED trading week's H/L/C, forward-carried.
    iso = df["date"].dt.isocalendar()
    tmp = df.assign(_iso_year=iso["year"], _iso_week=iso["week"])
    weekly = (tmp.groupby(["_iso_year", "_iso_week"])
              .agg(w_high=("high", "max"), w_low=("low", "min"), w_close=("close", "last"),
                   w_last_date=("date", "max"))
              .reset_index().sort_values("w_last_date"))
    weekly_lookup = weekly[["w_last_date", "w_high", "w_low", "w_close"]].rename(columns={"w_last_date": "date"})
    df = pd.merge_asof(df.sort_values("date"), weekly_lookup, on="date", direction="backward",
                       allow_exact_matches=False)

    pp = (df["w_high"] + df["w_low"] + df["w_close"]) / 3
    hl = df["w_high"] - df["w_low"]
    df["piv_pp"] = pp
    df["piv_r1"] = 2 * pp - df["w_low"]
    df["piv_s1"] = 2 * pp - df["w_high"]
    df["piv_r2"] = pp + hl
    df["piv_s2"] = pp - hl
    df["piv_r3"] = df["w_high"] + 2 * (pp - df["w_low"])
    df["piv_s3"] = df["w_low"] - 2 * (df["w_high"] - pp)
    df["piv_fr1"] = pp + 0.382 * hl
    df["piv_fs1"] = pp - 0.382 * hl
    df["piv_fr2"] = pp + 0.618 * hl
    df["piv_fs2"] = pp - 0.618 * hl
    df["piv_fr3"] = pp + 1.0 * hl
    df["piv_fs3"] = pp - 1.0 * hl

    return df.reset_index(drop=True)


def _gates_swing_pullback(df: pd.DataFrame) -> pd.Series:
    return (
        (df["turnover_sma_20_cr"] >= MIN_TURNOVER_CR)
        & (df["close"] > df["sma_50"])
        & (df["sma_50"] > df["sma_200"])
        & (df["sma_50"] > df["sma_50"].shift(10))
    ).fillna(False)


def score_swing_pullback(df: pd.DataFrame) -> tuple[pd.Series, dict[str, pd.Series]]:
    w = WEIGHTS["swing_pullback"]
    dip = (df["high_20"] - df["close"]) / df["atr_14"].replace(0, np.nan)
    factors = {
        "rsi":      _triangular_score(df["rsi_14"], 45, 5),
        "dip":      _triangular_score(dip, 2.5, 1),
        "delivery": _one_sided_score(df["delivery_ratio_20"].fillna(1.0), 1.5, 0.5, "higher"),
        "vol_dry":  _one_sided_score(df["rvol"].fillna(1.0), 0.7, 0.6, "lower"),
        "rs":       _one_sided_score(df["rs_pct"].fillna(0.0), 10.0, 10.0, "higher"),
        "trend":    _one_sided_score(df["pct_above_sma200"].fillna(0.0), 15.0, 15.0, "higher"),
    }
    total = sum(factors[k] * w[k] for k in w)
    return total, factors


def _fractal_swings(df: pd.DataFrame, lookback: int = _SWING_LOOKBACK) -> tuple[np.ndarray, np.ndarray]:
    """Confirmed fractal swing highs/lows — a swing needs `lookback` bars on BOTH
    sides, so as of bar i only fractals up to index (i - lookback) are known."""
    highs = df["high"].to_numpy(dtype=float)
    lows = df["low"].to_numpy(dtype=float)
    n = len(df)
    is_high = np.zeros(n, dtype=bool)
    is_low = np.zeros(n, dtype=bool)
    for i in range(lookback, n - lookback):
        wh = highs[i - lookback:i + lookback + 1]
        wl = lows[i - lookback:i + lookback + 1]
        if highs[i] == np.nanmax(wh):
            is_high[i] = True
        if lows[i] == np.nanmin(wl):
            is_low[i] = True
    return is_high, is_low


def _round_step(price: float) -> float:
    """Designed default — spec says "step 10/50/100/500 depending on price" without exact bands."""
    if price < 250:
        return 10.0
    if price < 1000:
        return 50.0
    if price < 5000:
        return 100.0
    return 500.0


def _round_number_levels(close: float, atr: float) -> list[float]:
    step = _round_step(close)
    lo, hi = close - 2 * atr, close + 8 * atr
    start = math.floor(lo / step) * step
    levels, p = [], start
    while p <= hi:
        if p >= lo:
            levels.append(p)
        p += step
    return levels


def _omega(price: float, levels: list[tuple[float, int]], atr: float) -> float:
    if atr <= 0 or not math.isfinite(atr):
        return 0.0
    band = 0.5 * atr
    return float(sum(wt for p, wt in levels if abs(p - price) <= band))


def _matched_levels(price: float, levels: list[tuple[float, int]], atr: float) -> list[tuple[float, int]]:
    band = 0.5 * atr
    return [(p, wt) for p, wt in levels if abs(p - price) <= band]


def _role_reversal_levels(close_arr: np.ndarray, low_arr: np.ndarray, i: int,
                          sh_idx: np.ndarray, sh_val: np.ndarray, atr_today: float) -> list[float]:
    """Old swing highs that price later closed above (breakout) and then retested
    from below. Recency-windowed — designed default, spec doesn't bound lookback."""
    window_start = max(0, i - _ROLE_REVERSAL_WINDOW)
    cand = [(int(k), float(p)) for k, p in zip(sh_idx, sh_val) if window_start <= k < i]
    cand = cand[-_ROLE_REVERSAL_MAX_CANDIDATES:]
    tol = 0.3 * atr_today if atr_today > 0 else 0.0
    levels = []
    for k, level in cand:
        seg_close = close_arr[k + 1:i + 1]
        seg_low = low_arr[k + 1:i + 1]
        above = np.where(seg_close > level)[0]
        if above.size == 0:
            continue
        after = seg_low[above[0] + 1:]
        if after.size and np.any(after <= level + tol):
            levels.append(level)
    return levels


def _chain_walls(candidates: list[tuple[float, int]], atr: float, min_weight: float) -> list[tuple[float, float, float]]:
    """Merge levels within 0.5*ATR of the next into resistance walls; keep walls
    whose combined weight clears the confluence threshold."""
    walls, n, j = [], len(candidates), 0
    while j < n:
        group = [candidates[j]]
        k = j + 1
        while k < n and (candidates[k][0] - group[-1][0]) <= 0.5 * atr:
            group.append(candidates[k])
            k += 1
        total_w = sum(wt for _, wt in group)
        if total_w >= min_weight:
            walls.append((min(p for p, _ in group), max(p for p, _ in group), total_w))
        j = k
    return walls


def _build_swing_pullback_signal(df: pd.DataFrame, i: int, score_i: float,
                                 close_arr: np.ndarray, high_arr: np.ndarray, low_arr: np.ndarray,
                                 volume_arr: np.ndarray, sh_idx: np.ndarray, sh_val: np.ndarray,
                                 sl_idx: np.ndarray, sl_val: np.ndarray,
                                 account_capital: float, symbol: str = "",
                                 midcap_scope: Optional[frozenset] = None,
                                 new_volume_logic: bool = False,
                                 ablate_fib: bool = False) -> dict:
    """STEP5-13 of the formula, evaluated for a single (already gated+scored) bar.
    Always returns a dict with a "verdict" — NO_DATA / NO_ANCHOR / REJECT_SL /
    REJECT_RR / QTY_ZERO (don't trade, tagged so the caller can tally *why*) or
    TRIGGERED / PLANNED (arm a pending order) plus entry/stop/target/qty."""
    row = df.iloc[i]
    close, high, low, volume = close_arr[i], high_arr[i], low_arr[i], volume_arr[i]
    atr = float(row["atr_14"]) if not pd.isna(row["atr_14"]) else 0.0
    if atr <= 0 or close <= 0:
        return {"verdict": "NO_DATA", "entry_type": None}
    vol20 = float(row["volume_sma_20"]) if not pd.isna(row["volume_sma_20"]) else 0.0

    cut = i - _SWING_LOOKBACK
    hi_mask = sh_idx <= cut
    lo_mask = sl_idx <= cut
    sh_i, sh_v = sh_idx[hi_mask], sh_val[hi_mask]
    sl_i, sl_v = sl_idx[lo_mask], sl_val[lo_mask]
    swing_low_price = float(sl_v[-1]) if sl_v.size else None
    swing_high_price = float(sh_v[-1]) if sh_v.size else None

    # STEP5 — level pool
    levels: list[tuple[float, int]] = []
    if swing_high_price is not None:
        levels.append((swing_high_price, _LEVEL_WEIGHTS["swing_high"]))
    if swing_low_price is not None:
        levels.append((swing_low_price, _LEVEL_WEIGHTS["swing_low"]))
    for col in ("sma_10", "sma_20", "sma_50", "ema_10", "ema_20"):
        v = row.get(col)
        if v is not None and not pd.isna(v):
            levels.append((float(v), _LEVEL_WEIGHTS["ma_ema"]))
    for lvl in _role_reversal_levels(close_arr, low_arr, i, sh_i, sh_v, atr):
        levels.append((lvl, _LEVEL_WEIGHTS["role_reversal"]))
    if swing_high_price is not None and swing_low_price is not None and not ablate_fib:
        span = swing_high_price - swing_low_price
        levels.append((swing_high_price - 0.5 * span, _LEVEL_WEIGHTS["fib"]))
        levels.append((swing_high_price - 0.618 * span, _LEVEL_WEIGHTS["fib"]))
    for col in ("piv_pp", "piv_r1", "piv_s1", "piv_r2", "piv_s2", "piv_r3", "piv_s3",
                "piv_fr1", "piv_fs1", "piv_fr2", "piv_fs2", "piv_fr3", "piv_fs3"):
        v = row.get(col)
        if v is not None and not pd.isna(v):
            levels.append((float(v), _LEVEL_WEIGHTS["weekly_pivot"]))
    for lvl in _round_number_levels(close, atr):
        levels.append((lvl, _LEVEL_WEIGHTS["round_number"]))

    # STEP6 — zone anchor
    sma50 = float(row["sma_50"]) if not pd.isna(row["sma_50"]) else None
    ema20 = float(row["ema_20"]) if not pd.isna(row["ema_20"]) else None
    if swing_low_price is not None and swing_low_price < close:
        anchor = swing_low_price
    elif sma50 is not None:
        anchor = sma50
    else:
        return {"verdict": "NO_ANCHOR", "entry_type": None}

    omega_anchor = _omega(anchor, levels, atr)
    if omega_anchor < 4 and ema20 is not None:
        omega_ema20 = _omega(ema20, levels, atr)
        if omega_ema20 > omega_anchor:
            anchor, omega_anchor = ema20, omega_ema20

    levels_for_zone = levels
    reset_swing_low = False
    if abs(anchor - close) > atr:
        below = [(p, wt) for p, wt in levels if p <= close]
        cand_levels = below if below else levels
        close_omega = _omega(close, cand_levels, atr)
        if close_omega >= 4:
            anchor, omega_anchor, levels_for_zone = close, close_omega, cand_levels
            reset_swing_low = True

    # STEP7 — support zone
    matched = _matched_levels(anchor, levels_for_zone, atr)
    if matched:
        zs_low = min(p for p, _ in matched)
        zs_high = max(p for p, _ in matched)
    else:
        zs_low = zs_high = anchor
    if reset_swing_low:
        swing_low_price = zs_low
    weak_zone = omega_anchor < 4

    # STEP8 — entry type
    zr = swing_high_price if (swing_high_price is not None and _omega(swing_high_price, levels, atr) >= 4) else None
    entry_type = "PULLBACK"
    if zr is not None:
        retest = close > zr and low >= zr - 0.5 * atr
        breakout = (not retest) and close > zr and (close - zr) <= 1.0 * atr and vol20 > 0 and volume >= 1.5 * vol20
        if retest:
            entry_type = "RETEST"
        elif breakout:
            entry_type = "BREAKOUT"

    # STEP9 — entry
    zone_anchored = False
    if entry_type == "PULLBACK":
        mid = (high + low) / 2
        if new_volume_logic:
            # Volume principle: a healthy retest sees volume DRY UP, not spike —
            # flipped from requiring >=1.2x avg to <=1.0x avg.
            # The corresponding "volume on breakout" half of the principle is
            # enforced separately, at the actual trigger day in
            # _run_swing_pullback_trades (this candle is the signal day, not
            # necessarily the day the order fills).
            confirmed = close > mid and vol20 > 0 and volume <= 1.0 * vol20
        else:
            confirmed = close > mid and vol20 > 0 and volume >= 1.2 * vol20
        entry = high + max(0.001 * high, _TICK_SIZE)
        overshoot_atr = (_MIDCAP_ZONE_ANCHOR_OVERSHOOT_ATR
                         if midcap_scope is not None and symbol in midcap_scope
                         else _ZONE_ANCHOR_OVERSHOOT_ATR)
        if (high - zs_high) > overshoot_atr * atr:
            entry = zs_low + max(0.001 * zs_low, _TICK_SIZE)
            confirmed = False
            zone_anchored = True
    elif entry_type == "BREAKOUT":
        entry, confirmed = zr + max(0.1 * atr, _TICK_SIZE), True
    else:  # RETEST
        entry, confirmed = zr + 0.25 * atr, True

    # STEP10 — stop loss
    sl_base = min(swing_low_price, zs_low) if swing_low_price is not None else zs_low
    if not confirmed:
        k = 1.0
    else:
        atr_pct = atr / close * 100
        k = 1.5 if atr_pct > 5 else 0.5
    sl = sl_base - k * atr
    risk_per_share = entry - sl
    d_atr = risk_per_share / atr if atr > 0 else 0.0
    reject_sl = risk_per_share <= 0 or d_atr < 0.75 or (risk_per_share / entry > 0.10)
    sweet_spot = 1.0 <= d_atr <= 2.5

    # STEP11 — targets
    above = sorted([(p, wt) for p, wt in levels if p > entry], key=lambda t: t[0])
    strong_above = [(p, wt) for p, wt in above if wt >= 2]
    walls = _chain_walls(strong_above, atr, _TARGET_WALL_MIN_WEIGHT)
    if not walls:
        walls = _chain_walls(above, atr, _TARGET_WALL_MIN_WEIGHT)
    zr_next = walls[0][0] if len(walls) >= 1 else None
    zr_next2 = walls[1][0] if len(walls) >= 2 else None

    ext_1618 = (close + 1.618 * (swing_high_price - swing_low_price)
               if swing_high_price is not None and swing_low_price is not None else None)

    r3 = entry + 3 * risk_per_share
    t1 = min(zr_next, r3) if zr_next is not None else r3
    single_target = False
    if zr_next2 is not None and zr_next2 > t1:
        t2 = zr_next2
    elif ext_1618 is not None and ext_1618 > t1:
        t2 = ext_1618
    else:
        t2, single_target = None, True

    high_52w = row.get("high_52w")
    if high_52w is not None and not pd.isna(high_52w):
        high_52w_cap = float(high_52w) * (1 + _TARGET_52W_HEADROOM)
        t1 = min(t1, high_52w_cap)
        if t2 is not None:
            t2 = min(t2, high_52w_cap)
        if t1 <= entry:
            t1 = None

    # STEP12 — R:R filter
    if t1 is None or risk_per_share <= 0:
        reject_rr = True
    else:
        reject_rr = (abs(t1 - entry) / risk_per_share) < 2.0
    rr2_weak = t2 is not None and risk_per_share > 0 and (abs(t2 - entry) / risk_per_share) < 2.0

    if reject_sl:
        verdict = "REJECT_SL"
    elif reject_rr:
        verdict = "REJECT_RR"
    else:
        verdict = "TRIGGERED" if confirmed else "PLANNED"
    if verdict in ("REJECT_SL", "REJECT_RR"):
        return {"verdict": verdict, "entry_type": entry_type}

    # STEP13 — position sizing
    atr_pct = atr / close * 100
    rho_adj = min(0.01 * (3.0 / atr_pct), 0.02) if atr_pct > 0 else 0.0
    score_frac = min(1.0, score_i / 0.70)
    turnover20_cr = float(row["turnover_sma_20_cr"]) if not pd.isna(row.get("turnover_sma_20_cr")) else 0.0
    q_risk = math.floor(account_capital * rho_adj * score_frac / risk_per_share) if risk_per_share > 0 else 0
    q_exposure = math.floor(account_capital * 0.20 / entry)
    q_liq_vol = math.floor(0.005 * vol20) if vol20 > 0 else 0
    q_liq_turn = math.floor(0.02 * turnover20_cr * 1e7 / entry)
    qty = max(0, min(q_risk, q_exposure, q_liq_vol, q_liq_turn))
    if qty < 1:
        return {"verdict": "QTY_ZERO", "entry_type": entry_type}

    qualifiers = []
    if zone_anchored:
        qualifiers.append("zone_anchored")
    if weak_zone:
        qualifiers.append("weak_zone")
    if single_target:
        qualifiers.append("single_target")
    if sweet_spot:
        qualifiers.append("sweet_spot")
    if rr2_weak:
        qualifiers.append("rr2_weak")

    return {
        "verdict": verdict, "entry_type": entry_type, "entry": entry, "stop": sl,
        "target1": t1, "target2": t2, "qty": qty, "confirmed": confirmed,
        "zone_anchored": zone_anchored, "qualifiers": qualifiers,
    }


def _run_swing_pullback_trades(df: pd.DataFrame, gates: pd.Series, score: pd.Series,
                               sh_idx: np.ndarray, sh_val: np.ndarray,
                               sl_idx: np.ndarray, sl_val: np.ndarray,
                               account_capital: float, symbol: str = "",
                               midcap_scope: Optional[frozenset] = None,
                               new_volume_logic: bool = False,
                               ablate_fib: bool = False) -> tuple[list[dict], list[dict], dict]:
    """Returns (trades, armed_not_triggered, diagnostics). diagnostics is a
    funnel of what happened to every gate+score-qualifying day — this is the
    only place visibility into silently-dropped signals (REJECT_SL/REJECT_RR/
    NO_ANCHOR/NO_DATA/QTY_ZERO) exists, since _build_swing_pullback_signal's
    non-arming verdicts otherwise vanish with no trace."""
    trades: list[dict] = []
    armed_not_triggered: list[dict] = []
    diagnostics = {
        "qualifying_days": 0, "armed": 0, "expired_unfilled": 0,
        "reject_sl": 0, "reject_rr": 0, "no_anchor": 0, "no_data": 0, "qty_zero": 0,
    }
    state = "idle"  # idle | armed | in_trade
    pending: Optional[dict] = None
    entry_idx = entry_price = stop_price = target_price = 0.0
    shares = 0
    trade_score = trade_tier = trade_arm_date = trade_entry_type = None
    trade_qualifiers: list[str] = []

    close_arr = df["close"].to_numpy(dtype=float)
    high_arr = df["high"].to_numpy(dtype=float)
    low_arr = df["low"].to_numpy(dtype=float)
    volume_arr = df["volume"].to_numpy(dtype=float)

    for i in range(1, len(df)):
        row = df.iloc[i]
        close, high, low = close_arr[i], high_arr[i], low_arr[i]
        if pd.isna(close) or pd.isna(high) or pd.isna(low):
            continue

        if state == "in_trade":
            bars_held = i - entry_idx
            exit_price = exit_reason = None
            if low <= stop_price:
                exit_price, exit_reason = stop_price, "sl"
            elif high >= target_price:
                exit_price, exit_reason = target_price, "target"
            elif bars_held >= MAX_HOLD_BARS:
                exit_price, exit_reason = close, "timeout"
            if exit_price is not None:
                pnl = (exit_price - entry_price) * shares
                pnl_pct = (exit_price / entry_price - 1) * 100
                trades.append({
                    "entry_date": str(df.iloc[entry_idx]["date"]), "exit_date": str(row["date"]),
                    "entry_price": round(entry_price, 2), "stop_price": round(stop_price, 2),
                    "target_price": round(target_price, 2), "exit_price": round(exit_price, 2),
                    "exit_reason": exit_reason, "direction": "long", "shares": shares,
                    "pnl": round(pnl, 2), "pnl_pct": round(pnl_pct, 2),
                    "score": round(trade_score, 3), "tier": trade_tier,
                    "arm_date": trade_arm_date, "trigger_date": str(df.iloc[entry_idx]["date"]),
                    "arm_score": round(trade_score, 3),
                    "entry_type": trade_entry_type, "qualifiers": trade_qualifiers,
                })
                state, pending = "idle", None
            continue

        if state == "armed":
            bars_armed = i - pending["signal_idx"]
            if bars_armed > _SWING_ARM_EXPIRY_BARS:
                armed_not_triggered.append({
                    "arm_date": str(df.iloc[pending["signal_idx"]]["date"]),
                    "arm_score": round(pending["score"], 3),
                    "expired_date": str(row["date"]),
                })
                diagnostics["expired_unfilled"] += 1
                state, pending = "idle", None
                continue
            triggered = (low <= pending["entry"]) if pending["zone_anchored"] else (high >= pending["entry"])
            if (triggered and new_volume_logic and pending["entry_type"] == "PULLBACK"
                    and not pending["zone_anchored"]):
                # Volume principle, other half: the actual
                # breakout/trigger day should show volume picking up, not just
                # price crossing the level — mirrors the 1.5x threshold already
                # used elsewhere in this file for breakout-style confirmation
                # (accumulation/distribution, STEP8's own BREAKOUT gate).
                vol20_i = float(row["volume_sma_20"]) if not pd.isna(row["volume_sma_20"]) else 0.0
                triggered = vol20_i > 0 and volume_arr[i] >= 1.5 * vol20_i
            if triggered:
                entry_price, stop_price, target_price, shares = (
                    pending["entry"], pending["stop"], pending["target"], pending["qty"])
                entry_idx = i
                trade_score, trade_tier = pending["score"], pending["tier"]
                trade_arm_date = str(df.iloc[pending["signal_idx"]]["date"])
                trade_entry_type, trade_qualifiers = pending["entry_type"], pending["qualifiers"]
                state, pending = "in_trade", None
            continue

        if bool(gates.iloc[i]) and not pd.isna(score.iloc[i]) and score.iloc[i] >= 0.40:
            diagnostics["qualifying_days"] += 1
            sig = _build_swing_pullback_signal(df, i, float(score.iloc[i]), close_arr, high_arr, low_arr,
                                               volume_arr, sh_idx, sh_val, sl_idx, sl_val, account_capital, symbol,
                                               midcap_scope, new_volume_logic, ablate_fib)
            verdict = sig.get("verdict")
            if verdict in ("TRIGGERED", "PLANNED"):
                diagnostics["armed"] += 1
                pending = {
                    "signal_idx": i, "entry": sig["entry"], "stop": sig["stop"], "target": sig["target1"],
                    "qty": sig["qty"], "zone_anchored": sig["zone_anchored"], "entry_type": sig["entry_type"],
                    "score": float(score.iloc[i]), "tier": _assign_tier(float(score.iloc[i]), "swing_pullback"),
                    "qualifiers": sig["qualifiers"],
                }
                state = "armed"
            elif verdict == "REJECT_SL":
                diagnostics["reject_sl"] += 1
            elif verdict == "REJECT_RR":
                diagnostics["reject_rr"] += 1
            elif verdict == "NO_ANCHOR":
                diagnostics["no_anchor"] += 1
            elif verdict == "NO_DATA":
                diagnostics["no_data"] += 1
            elif verdict == "QTY_ZERO":
                diagnostics["qty_zero"] += 1

    return trades, armed_not_triggered, diagnostics


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
                       target_series: Optional[pd.Series] = None,
                       enter_next_bar: bool = False) -> list[dict]:
    """enter_next_bar=True fills at the NEXT bar's open instead of the signal
    bar's own close — the signal bar's close/indicators (RSI, delivery, etc.)
    aren't knowable until that day's market has shut, so filling at that same
    close is a look-ahead artifact. Defaults to False to preserve zone_trade's
    documented "enter at close on the zone-touch bar" design, which reflects a
    same-day intrabar touch-and-close condition, not an EOD-computed score."""
    trades: list[dict] = []
    in_trade = False
    pending_signal_idx: Optional[int] = None
    entry_idx = entry_price = stop_price = target_price = 0.0
    shares = 0

    for i in range(1, len(df)):
        row = df.iloc[i]
        close, high, low = float(row["close"]), float(row["high"]), float(row["low"])
        open_ = float(row["open"]) if enter_next_bar else 0.0
        if pd.isna(close) or pd.isna(high) or pd.isna(low) or (enter_next_bar and pd.isna(open_)):
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
            continue

        if enter_next_bar and pending_signal_idx is not None:
            sig_i = pending_signal_idx
            pending_signal_idx = None
            sig_row = df.iloc[sig_i]
            atr = float(sig_row["atr_14"]) if not pd.isna(sig_row["atr_14"]) else 0.0
            if atr <= 0 or open_ <= 0:
                continue
            entry_price = open_
            stop_price = entry_price - atr_stop_mult * atr if direction == "long" else entry_price + atr_stop_mult * atr
            target_price = entry_price + atr_target_mult * atr if direction == "long" else entry_price - atr_target_mult * atr
            sig_score = float(score.iloc[sig_i])
            risk_pct = (_scaled_risk_pct(sig_score, base_risk_pct, entry_threshold) if score_scaled else base_risk_pct)
            shares = _position_size(account_capital, risk_pct, entry_price, stop_price)
            if shares < 1:
                continue
            entry_idx = i
            in_trade = True
            df.at[df.index[i], "_score"] = sig_score
            df.at[df.index[i], "_tier"] = _assign_tier(sig_score, algo)
            continue

        if bool(gates.iloc[i]) and score.iloc[i] >= entry_threshold and close > 0:
            if enter_next_bar:
                pending_signal_idx = i
                continue
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

def run_quant_signal(df: pd.DataFrame, algo: str, is_fno: bool, account_capital: float, symbol: str = "",
                     midcap_scope: Optional[frozenset] = None) -> dict:
    """df must already be prepare_frame()'d + attach_quant_factors()'d."""
    df = df.copy()
    df["_score"] = np.nan
    df["_tier"] = ""

    diagnostics: Optional[dict] = None
    if algo == "long_pullback":
        gates = _gates_long_pullback(df)
        score, factors = score_long_pullback(df)
        # enter_next_bar=True: fill at the next day's open, not the signal day's
        # own close — the signal day's close/indicators aren't known until that
        # day's market has already shut, so same-bar-close fills were look-ahead.
        trades = _run_direct_trades(df, gates, score, algo, "long", 0.55, 1.5, 3.0, 1.0, True, account_capital,
                                    enter_next_bar=True)
        armed_not_triggered = []
    elif algo == "short_bounce":
        gates = _gates_short_bounce(df)
        score, factors = score_short_bounce(df)
        # Entry threshold raised 0.55->0.65 (idea #19 in quant_signals_experiments.md):
        # cut the full-F&O-universe 3yr loss from -Rs13.9L to -Rs3.4L and pushed win
        # rate to 32.3%, close to the 33.3% breakeven this R:R needs. Non-monotonic —
        # 0.70/0.75 tested worse — 0.65 is the validated sweet spot, not "tighter is
        # always better."
        trades = _run_direct_trades(df, gates, score, algo, "short", 0.65, 1.5, 3.0, 0.75, False, account_capital,
                                    enter_next_bar=True)
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
    elif algo in ("swing_pullback", "swing_pullback_v2", "swing_pullback_sector_rs", "swing_pullback_v4", "swing_pullback_v5"):
        df = attach_swing_pullback_factors(df, symbol=symbol, sector_rs=(algo in ("swing_pullback_sector_rs", "swing_pullback_v4", "swing_pullback_v5")))
        gates = _gates_swing_pullback(df)
        score, factors = score_swing_pullback(df)
        is_high, is_low = _fractal_swings(df)
        sh_idx = np.where(is_high)[0]
        sh_val = df["high"].to_numpy(dtype=float)[sh_idx]
        sl_idx = np.where(is_low)[0]
        sl_val = df["low"].to_numpy(dtype=float)[sl_idx]
        scope = midcap_scope if algo == "swing_pullback_v2" else None
        # v4: volume principle (quiet retest, volume pickup on trigger) layered on
        # top of v3's sector-RS base — validated via train/holdout split across all
        # 9 index baskets; broad win, except Nifty Mid Select regresses on holdout
        # (a known caveat, logged in quant_signals_experiments.md).
        # v5: same as v4, minus the Fibonacci retracement levels in the confluence
        # zone pool — an isolated ablation test found removing Fib improved holdout
        # PF in 13/16 basket combinations, including fixing v4's Nifty Mid Select
        # regression (logged in quant_signals_experiments.md).
        trades, armed_not_triggered, diagnostics = _run_swing_pullback_trades(
            df, gates, score, sh_idx, sh_val, sl_idx, sl_val, account_capital, symbol, scope,
            new_volume_logic=(algo in ("swing_pullback_v4", "swing_pullback_v5")),
            ablate_fib=(algo == "swing_pullback_v5"))
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

    result = {
        "trades": trades,
        "armed_not_triggered": armed_not_triggered,
        "stats": stats,
        "score_series": score_series,
        "ohlcv": ohlcv,
    }
    if diagnostics is not None:
        result["diagnostics"] = diagnostics
    return result


def is_fno_eligible(symbol: str) -> bool:
    return symbol.upper() in FNO_STOCK_UNIVERSE
