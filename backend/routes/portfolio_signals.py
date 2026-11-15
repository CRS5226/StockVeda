"""Signals routes: what standard indicator rules say about each stock of a portfolio, and the thresholds for its zones.

Educational maths on candles. The answers are rule states and zones the user's own thresholds define, never a recommendation.
"""

import json
from typing import Optional

import pandas as pd
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from backend.core.candles import load_daily, load_hourly, load_sectors
from backend.core.stock_health import concentration, positions, trend_stats
from backend.core.signal_rules import alignment, evaluate_rules, to_weekly
from backend.core.signal_zones import classify_zone, clean_settings, sizing
from backend.db.connection import get_db
from backend.routes.portfolio import portfolio_detail

router = APIRouter(prefix="/portfolios/{pid}/signals", tags=["portfolio"])


class SettingsIn(BaseModel):
    max_position_pct: Optional[float] = Field(None, gt=0, le=100)
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


def _slim(result: Optional[dict]) -> Optional[dict]:
    """What the page needs from one timeframe's result."""
    if result is None:
        return None
    return {k: result[k] for k in ("bars", "adx", "regime", "rules", "votes", "lean", "as_of")}


@router.get("")
def get_signals(pid: int):
    """Everything the Signals tab shows about the stocks of a portfolio. Weights are shares of the stock holdings only."""
    db = get_db()
    _require_portfolio(db, pid)
    rows = positions(portfolio_detail(db, pid)["holdings"])
    stock_value = sum(r["value"] for r in rows)
    settings = load_settings(db, pid)
    symbols = [r["symbol"] for r in rows]
    daily, hourly = load_daily(db, symbols), load_hourly(db, symbols)
    sectors = load_sectors(db, symbols)

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
            "symbol": sym, "kind": r["kind"], "weight_pct": r["value"] / stock_value * 100 if stock_value else 0.0,
            "value": r["value"], "gain": r["value"] - r["invested"], "sector": sectors.get(sym), "qty": r["qty"], "avg_price": r["avg_price"], "last": r["last_price"], "pnl_pct": pnl_pct,
            "trend": trend_stats(d["close"]) if d is not None else trend_stats(pd.Series(dtype=float)),
            "timeframes": {k: _slim(v) for k, v in timeframes.items()},
            "alignment": alignment([timeframes[k]["lean"] if timeframes[k] else None for k in ("1W", "1D", "1H")]),
            "zone": zone, "zone_checks": checks,
            "sizing": sizing(r["qty"], r["avg_price"], r["last_price"], r["value"], stock_value, settings["max_position_pct"], settings),
        })
    conc = concentration(rows, stock_value, settings["max_position_pct"])
    with_200 = [o for o in out if o["trend"]["above_sma200"] is not None]
    return {
        "settings": settings,
        "stock_value": stock_value,
        "concentration": conc,
        "rows": out,
        "summary": {
            "stocks": len(out),
            "with_signals": sum(1 for o in out if o["timeframes"]["1D"]),
            "aligned_bullish": sum(1 for o in out if o["alignment"] == "bullish"),
            "aligned_bearish": sum(1 for o in out if o["alignment"] == "bearish"),
            "profit_zone": sum(1 for o in out if o["zone"] == "profit"),
            "recovery_zone": sum(1 for o in out if o["zone"] == "recovery"),
            "with_sma200": len(with_200),
            "below_sma200": sum(1 for o in with_200 if not o["trend"]["above_sma200"]),
            "deep_drawdown": sum(1 for o in out if o["trend"]["deep_drawdown"]),
            "over_limit": conc["over_limit"],
        },
    }
