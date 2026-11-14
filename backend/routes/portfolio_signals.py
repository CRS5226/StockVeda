"""Signals routes: what standard indicator rules say about each stock of a portfolio, and the thresholds for its zones.

Educational maths on candles. The answers are rule states and zones the user's own thresholds define, never a recommendation.
"""

import json
from typing import Optional

import pandas as pd
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from backend.core.portfolio_health import positions
from backend.core.signal_rules import alignment, evaluate_rules, to_weekly
from backend.core.signal_zones import classify_zone, clean_settings, sizing
from backend.db.connection import get_db
from backend.routes.portfolio_health import load_targets
from backend.routes.portfolio_total import compute_total

router = APIRouter(prefix="/portfolios/{pid}/signals", tags=["portfolio"])

COLUMNS = ["date", "open", "high", "low", "close", "volume"]


class SettingsIn(BaseModel):
    profit_gain_pct: Optional[float] = Field(None, gt=0)
    profit_rsi: Optional[float] = Field(None, gt=0, le=100)
    loss_pct: Optional[float] = Field(None, gt=0)
    trim_pct: Optional[float] = Field(None, gt=0, le=100)
    add_budget: Optional[float] = Field(None, gt=0)


def _require_portfolio(db, pid: int) -> None:
    if not db.execute("SELECT 1 FROM portfolios WHERE id = ?", [pid]).fetchall():
        raise HTTPException(404, "No such portfolio.")


def load_settings(db, pid: int) -> dict:
    rows = db.execute("SELECT settings FROM portfolio_signal_settings WHERE portfolio_id = ?", [pid]).fetchall()
    return clean_settings(json.loads(rows[0][0]) if rows and rows[0][0] else None)


@router.get("/settings")
def get_settings(pid: int):
    db = get_db()
    _require_portfolio(db, pid)
    return load_settings(db, pid)


@router.put("/settings")
def put_settings(pid: int, body: SettingsIn):
    db = get_db()
    _require_portfolio(db, pid)
    settings = clean_settings(body.model_dump(exclude_none=True))
    db.execute("DELETE FROM portfolio_signal_settings WHERE portfolio_id = ?", [pid])
    db.execute("INSERT INTO portfolio_signal_settings (portfolio_id, settings) VALUES (?, ?)", [pid, json.dumps(settings)])
    return settings


def _daily(db, symbols: list[str]) -> dict[str, pd.DataFrame]:
    """About two years of daily candles per symbol, in one query."""
    marks = ",".join("?" for _ in symbols)
    df = db.execute(
        f"SELECT symbol, {', '.join(COLUMNS)} FROM stock_ohlcv WHERE symbol IN ({marks}) AND date >= current_date - INTERVAL 800 DAY ORDER BY symbol, date", symbols,
    ).df()
    return {sym: g[COLUMNS].reset_index(drop=True) for sym, g in df.groupby("symbol")}


def _hourly(db, symbols: list[str]) -> dict[str, pd.DataFrame]:
    """The last year or so of 60-minute candles per symbol, in one query."""
    marks = ",".join("?" for _ in symbols)
    df = db.execute(
        f"SELECT symbol, datetime AS date, open, high, low, close, volume FROM stock_intraday_ohlcv WHERE interval = '60m' AND symbol IN ({marks}) "
        "AND datetime >= current_timestamp - INTERVAL 400 DAY ORDER BY symbol, datetime", symbols,
    ).df()
    return {sym: g[COLUMNS].reset_index(drop=True) for sym, g in df.groupby("symbol")}


def _slim(result: Optional[dict]) -> Optional[dict]:
    """What the page needs from one timeframe's result."""
    if result is None:
        return None
    return {k: result[k] for k in ("bars", "adx", "regime", "rules", "votes", "lean", "as_of")}


@router.get("")
def get_signals(pid: int):
    db = get_db()
    _require_portfolio(db, pid)
    total, stocks = compute_total(db, pid)
    settings, limits = load_settings(db, pid), load_targets(db, pid)
    rows = positions(stocks["holdings"])
    value = total["value"]
    symbols = [r["symbol"] for r in rows]
    daily = _daily(db, symbols) if symbols else {}
    hourly = _hourly(db, symbols) if symbols else {}

    out = []
    for r in sorted(rows, key=lambda r: -r["value"]):
        sym = r["symbol"]
        d = daily.get(sym)
        timeframes = {
            "1W": evaluate_rules(to_weekly(d)) if d is not None and len(d) >= 30 else None,
            "1D": evaluate_rules(d) if d is not None else None,
            "1H": evaluate_rules(hourly[sym]) if sym in hourly else None,
        }
        pnl_pct = (r["value"] / r["invested"] - 1) * 100 if r["invested"] else None
        zone, checks = classify_zone(pnl_pct, timeframes["1D"], settings)
        out.append({
            "symbol": sym, "kind": r["kind"], "weight_pct": r["value"] / value * 100 if value else 0.0,
            "qty": r["qty"], "avg_price": r["avg_price"], "last": r["last_price"], "pnl_pct": pnl_pct,
            "timeframes": {k: _slim(v) for k, v in timeframes.items()},
            "alignment": alignment([timeframes[k]["lean"] if timeframes[k] else None for k in ("1W", "1D", "1H")]),
            "zone": zone, "zone_checks": checks,
            "sizing": sizing(r["qty"], r["avg_price"], r["last_price"], r["value"], value, limits["max_position_pct"], settings),
        })
    return {
        "settings": settings,
        "max_position_pct": limits["max_position_pct"],
        "rows": out,
        "summary": {
            "stocks": len(out),
            "with_signals": sum(1 for o in out if o["timeframes"]["1D"]),
            "aligned_bullish": sum(1 for o in out if o["alignment"] == "bullish"),
            "aligned_bearish": sum(1 for o in out if o["alignment"] == "bearish"),
            "profit_zone": sum(1 for o in out if o["zone"] == "profit"),
            "recovery_zone": sum(1 for o in out if o["zone"] == "recovery"),
        },
    }
