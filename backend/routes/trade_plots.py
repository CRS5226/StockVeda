"""Trade plot routes: save, list, update and delete the trade boxes drawn on the Charts page."""

from datetime import datetime
from typing import Literal, Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from backend.core.trade_plot import validate_levels
from backend.db.connection import get_db

router = APIRouter(prefix="/trade-plots", tags=["trade-plots"])

COLUMNS = "id, symbol, side, entry_time, end_time, entry_price, stop_loss, target, qty, note, created_at, updated_at"


class PlotIn(BaseModel):
    symbol: str = Field(min_length=1, max_length=30)
    side: Literal["long", "short"]
    entry_time: datetime
    end_time: datetime
    entry_price: float = Field(gt=0)
    stop_loss: float = Field(gt=0)
    target: float = Field(gt=0)
    qty: Optional[int] = Field(None, ge=1)
    note: str = Field("", max_length=500)


def _iso(value: datetime) -> str:
    return value.replace(microsecond=0).isoformat()


def _row(r) -> dict:
    return {
        "id": r[0], "symbol": r[1], "side": r[2], "entry_time": _iso(r[3]), "end_time": _iso(r[4]),
        "entry_price": r[5], "stop_loss": r[6], "target": r[7], "qty": r[8], "note": r[9] or "",
        "created_at": _iso(r[10]), "updated_at": _iso(r[11]),
    }


def _checked(body: PlotIn) -> tuple[datetime, datetime]:
    """Naive exchange times, after checking the box makes sense."""
    entry, end = body.entry_time.replace(tzinfo=None), body.end_time.replace(tzinfo=None)
    if end <= entry:
        raise HTTPException(400, "The box must end after its entry time.")
    problem = validate_levels(body.side, body.entry_price, body.stop_loss, body.target)
    if problem:
        raise HTTPException(400, problem)
    return entry, end


@router.get("")
def list_plots(symbol: Optional[str] = Query(None, min_length=1, max_length=30)):
    db = get_db()
    sql, params = f"SELECT {COLUMNS} FROM plotted_trades", []
    if symbol:
        sql += " WHERE symbol = ?"
        params.append(symbol.strip().upper())
    rows = db.execute(sql + " ORDER BY entry_time, id", params).fetchall()
    return [_row(r) for r in rows]


@router.post("")
def create_plot(body: PlotIn):
    entry, end = _checked(body)
    db = get_db()
    # Same approach as the watchlists: the next id from the table itself (single-writer app).
    pid = db.execute("SELECT COALESCE(MAX(id), 0) + 1 FROM plotted_trades").fetchone()[0]
    db.execute(
        "INSERT INTO plotted_trades (id, symbol, side, entry_time, end_time, entry_price, stop_loss, target, qty, note) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [pid, body.symbol.strip().upper(), body.side, entry, end, body.entry_price, body.stop_loss, body.target, body.qty, body.note],
    )
    return _row(db.execute(f"SELECT {COLUMNS} FROM plotted_trades WHERE id = ?", [pid]).fetchone())


@router.put("/{pid}")
def update_plot(pid: int, body: PlotIn):
    entry, end = _checked(body)
    db = get_db()
    if db.execute("SELECT 1 FROM plotted_trades WHERE id = ?", [pid]).fetchone() is None:
        raise HTTPException(404, "No such trade.")
    db.execute(
        "UPDATE plotted_trades SET symbol = ?, side = ?, entry_time = ?, end_time = ?, entry_price = ?, stop_loss = ?, "
        "target = ?, qty = ?, note = ?, updated_at = now() WHERE id = ?",
        [body.symbol.strip().upper(), body.side, entry, end, body.entry_price, body.stop_loss, body.target, body.qty, body.note, pid],
    )
    return _row(db.execute(f"SELECT {COLUMNS} FROM plotted_trades WHERE id = ?", [pid]).fetchone())


@router.delete("/{pid}")
def delete_plot(pid: int):
    db = get_db()
    if db.execute("SELECT 1 FROM plotted_trades WHERE id = ?", [pid]).fetchone() is None:
        raise HTTPException(404, "No such trade.")
    db.execute("DELETE FROM plotted_trades WHERE id = ?", [pid])
    return {"ok": True}
