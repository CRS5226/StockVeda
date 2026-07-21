"""
Trade Planner routes — a forward-looking, per-trade planning toolkit (position
sizing/R:R calculator, pivot levels, trade journal). Distinct from /backtest,
which scans historical bars; this serves one symbol's latest data to prefill a
manual trade plan, plus CRUD for a persistent trade log. All calculator/pivot
arithmetic itself lives in the frontend — this route only supplies prefill
data (last close, ATR14, previous completed week's H/L/C) and journal storage.
"""

from datetime import date
from typing import Optional

import pandas as pd
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from backend.db.connection import get_db
from backend.core.indicators import add_indicators
from backend.core.backtest_engine import aggregate_weekly

router = APIRouter(prefix="/planner", tags=["planner"])


# ── Prefill ──────────────────────────────────────────────────────────────────

@router.get("/prefill/{symbol}")
def prefill(symbol: str):
    db = get_db()
    df = db.execute(
        "SELECT date, open, high, low, close, volume FROM stock_ohlcv "
        "WHERE symbol = ? ORDER BY date",
        [symbol.upper()],
    ).df()
    if df.empty:
        raise HTTPException(404, f"No candle data for {symbol}. Sync it first via the Screener.")

    last_close = float(df["close"].iloc[-1])

    atr_df = add_indicators(df, indicators=["atr_14"])
    atr_series = atr_df["atr_14"].dropna()
    atr_14 = float(atr_series.iloc[-1]) if not atr_series.empty else None

    weekly = aggregate_weekly(df)
    # Drop the last row if it's still the current, in-progress calendar week —
    # "previous week's H/L/C" should mean the last *completed* week.
    today_period = pd.Timestamp.today().to_period("W")
    last_row_period = pd.to_datetime(weekly.iloc[-1]["date"]).to_period("W")
    if last_row_period == today_period and len(weekly) > 1:
        weekly = weekly.iloc[:-1]
    prev_week = weekly.iloc[-1] if not weekly.empty else None

    return {
        "symbol": symbol.upper(),
        "last_close": last_close,
        "atr_14": atr_14,
        "prev_week": None if prev_week is None else {
            "high": float(prev_week["high"]),
            "low": float(prev_week["low"]),
            "close": float(prev_week["close"]),
            "week_ending_date": str(prev_week["date"]),
        },
    }


# ── Trade Log CRUD ───────────────────────────────────────────────────────────

class TradeLogCreate(BaseModel):
    symbol: str
    direction: str          # "long" | "short"
    entry_date: date
    entry_price: float
    sl_price: float
    quantity: int
    notes: Optional[str] = None


class TradeLogUpdate(BaseModel):
    exit_date: Optional[date] = None
    exit_price: Optional[float] = None
    sl_price: Optional[float] = None
    notes: Optional[str] = None


_COLS = "id, symbol, direction, entry_date, entry_price, sl_price, quantity, exit_date, exit_price, notes, created_at"


def _row_to_dict(row) -> dict:
    return {
        "id": row[0], "symbol": row[1], "direction": row[2],
        "entry_date": str(row[3]), "entry_price": row[4], "sl_price": row[5],
        "quantity": row[6], "exit_date": str(row[7]) if row[7] else None,
        "exit_price": row[8], "notes": row[9], "created_at": str(row[10]),
    }


@router.post("/trades")
def create_trade(body: TradeLogCreate):
    if body.direction not in ("long", "short"):
        raise HTTPException(400, "direction must be 'long' or 'short'")
    db = get_db()
    tid = db.execute("SELECT nextval('trade_log_id_seq')").fetchone()[0]
    db.execute(
        "INSERT INTO trade_log (id, symbol, direction, entry_date, entry_price, sl_price, quantity, notes) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        [tid, body.symbol.upper(), body.direction, body.entry_date,
         body.entry_price, body.sl_price, body.quantity, body.notes],
    )
    row = db.execute(f"SELECT {_COLS} FROM trade_log WHERE id = ?", [tid]).fetchone()
    return _row_to_dict(row)


@router.get("/trades")
def list_trades():
    db = get_db()
    rows = db.execute(f"SELECT {_COLS} FROM trade_log ORDER BY entry_date DESC, id DESC").fetchall()
    return [_row_to_dict(r) for r in rows]


@router.patch("/trades/{trade_id}")
def update_trade(trade_id: int, body: TradeLogUpdate):
    db = get_db()
    existing = db.execute("SELECT id FROM trade_log WHERE id = ?", [trade_id]).fetchone()
    if not existing:
        raise HTTPException(404, "Trade not found")
    updates = body.model_dump(exclude_unset=True)
    if updates:
        set_clause = ", ".join(f"{k} = ?" for k in updates)
        db.execute(f"UPDATE trade_log SET {set_clause} WHERE id = ?", [*updates.values(), trade_id])
    row = db.execute(f"SELECT {_COLS} FROM trade_log WHERE id = ?", [trade_id]).fetchone()
    return _row_to_dict(row)


@router.delete("/trades/{trade_id}")
def delete_trade(trade_id: int):
    db = get_db()
    db.execute("DELETE FROM trade_log WHERE id = ?", [trade_id])
    return {"ok": True}
