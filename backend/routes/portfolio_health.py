"""Portfolio health routes: the check of a portfolio against the user's own targets, and those targets."""

import json
from typing import Optional

import pandas as pd
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from backend.core.portfolio_health import (
    DEFAULT_BAND_PP, DEFAULT_MAX_POSITION_PCT, allocation_check, concentration, parse_targets, positions, trend_stats,
)
from backend.db.connection import get_db
from backend.routes.portfolio_total import compute_total

router = APIRouter(prefix="/portfolios/{pid}/health", tags=["portfolio"])


class TargetsIn(BaseModel):
    max_position_pct: float = Field(DEFAULT_MAX_POSITION_PCT, gt=0, le=100)
    band_pp: float = Field(DEFAULT_BAND_PP, ge=0, le=50)
    targets: dict[str, float] = Field(default_factory=dict)


def load_targets(db, pid: int) -> dict:
    rows = db.execute("SELECT max_position_pct, band_pp, targets FROM portfolio_targets WHERE portfolio_id = ?", [pid]).fetchall()
    if not rows:
        return {"max_position_pct": DEFAULT_MAX_POSITION_PCT, "band_pp": DEFAULT_BAND_PP, "targets": {}}
    maximum, band, raw = rows[0]
    return {"max_position_pct": maximum, "band_pp": band, "targets": parse_targets(json.loads(raw) if raw else {})}


def _require_portfolio(db, pid: int) -> None:
    if not db.execute("SELECT 1 FROM portfolios WHERE id = ?", [pid]).fetchall():
        raise HTTPException(404, "No such portfolio.")


@router.get("/targets")
def get_targets(pid: int):
    db = get_db()
    _require_portfolio(db, pid)
    return load_targets(db, pid)


@router.put("/targets")
def put_targets(pid: int, body: TargetsIn):
    db = get_db()
    _require_portfolio(db, pid)
    targets = parse_targets(body.targets)
    if sum(targets.values()) > 100.0001:
        raise HTTPException(400, "The targets add up to more than 100%.")
    db.execute("DELETE FROM portfolio_targets WHERE portfolio_id = ?", [pid])
    db.execute("INSERT INTO portfolio_targets (portfolio_id, max_position_pct, band_pp, targets) VALUES (?, ?, ?, ?)",
               [pid, body.max_position_pct, body.band_pp, json.dumps(targets)])
    return load_targets(db, pid)


def _closes(db, symbols: list[str]) -> dict[str, pd.Series]:
    """About a year and a half of daily closes per symbol, in one query."""
    if not symbols:
        return {}
    marks = ",".join("?" for _ in symbols)
    df = db.execute(
        f"SELECT symbol, date, close FROM stock_ohlcv WHERE symbol IN ({marks}) AND date >= current_date - INTERVAL 560 DAY ORDER BY symbol, date",
        symbols,
    ).df()
    return {sym: g["close"].reset_index(drop=True) for sym, g in df.groupby("symbol")}


@router.get("")
def get_health(pid: int):
    db = get_db()
    _require_portfolio(db, pid)
    total, stocks = compute_total(db, pid)
    settings = load_targets(db, pid)
    rows = positions(stocks["holdings"])
    value = total["value"]

    conc = concentration(rows, value, settings["max_position_pct"])
    closes = _closes(db, [r["symbol"] for r in rows])
    weight = {p["symbol"]: p["weight_pct"] for p in conc["positions"]}
    trend = []
    for r in rows:
        stats = trend_stats(closes[r["symbol"]]) if r["symbol"] in closes else trend_stats(pd.Series(dtype=float))
        trend.append({"symbol": r["symbol"], "kind": r["kind"], "weight_pct": weight.get(r["symbol"], 0.0), **stats})
    with_200 = [t for t in trend if t["above_sma200"] is not None]
    allocation = allocation_check(total["parts"], value, settings["targets"], settings["band_pp"])
    return {
        "total_value": value,
        "settings": settings,
        "concentration": conc,
        "allocation": allocation,
        "trend": trend,
        "summary": {
            "stocks": len(rows),
            "below_sma200": sum(1 for t in with_200 if not t["above_sma200"]),
            "with_sma200": len(with_200),
            "deep_drawdown": sum(1 for t in trend if t["deep_drawdown"]),
            "types_out_of_band": sum(1 for a in allocation if a["status"] in ("over", "under")),
        },
    }
