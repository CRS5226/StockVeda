"""Drawing routes: save, list, update and delete the lines and rectangles drawn on the Charts page."""

from datetime import datetime
from typing import Literal, Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from backend.core.chart_drawing import validate_drawing
from backend.db.connection import get_db

router = APIRouter(prefix="/drawings", tags=["drawings"])

COLUMNS = "id, symbol, kind, time1, price1, time2, price2, color, created_at, updated_at"


class DrawingIn(BaseModel):
    symbol: str = Field(min_length=1, max_length=30)
    kind: Literal["line", "hline", "rect"]
    time1: datetime
    price1: float = Field(gt=0)
    time2: datetime
    price2: float = Field(gt=0)
    color: str = Field("#3b82f6", max_length=7)


def _iso(value: datetime) -> str:
    return value.replace(microsecond=0).isoformat()


def _row(r) -> dict:
    return {
        "id": r[0], "symbol": r[1], "kind": r[2], "time1": _iso(r[3]), "price1": r[4], "time2": _iso(r[5]),
        "price2": r[6], "color": r[7], "created_at": _iso(r[8]), "updated_at": _iso(r[9]),
    }


def _checked(body: DrawingIn) -> None:
    problem = validate_drawing(body.kind, body.price1, body.price2, body.color)
    if problem:
        raise HTTPException(400, problem)


@router.get("")
def list_drawings(symbol: Optional[str] = Query(None, min_length=1, max_length=30)):
    db = get_db()
    sql, params = f"SELECT {COLUMNS} FROM chart_drawings", []
    if symbol:
        sql += " WHERE symbol = ?"
        params.append(symbol.strip().upper())
    return [_row(r) for r in db.execute(sql + " ORDER BY id", params).fetchall()]


@router.post("")
def create_drawing(body: DrawingIn):
    _checked(body)
    db = get_db()
    did = db.execute("SELECT COALESCE(MAX(id), 0) + 1 FROM chart_drawings").fetchone()[0]
    db.execute(
        "INSERT INTO chart_drawings (id, symbol, kind, time1, price1, time2, price2, color) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        [did, body.symbol.strip().upper(), body.kind, body.time1.replace(tzinfo=None), body.price1,
         body.time2.replace(tzinfo=None), body.price2, body.color],
    )
    return _row(db.execute(f"SELECT {COLUMNS} FROM chart_drawings WHERE id = ?", [did]).fetchone())


@router.put("/{did}")
def update_drawing(did: int, body: DrawingIn):
    _checked(body)
    db = get_db()
    if db.execute("SELECT 1 FROM chart_drawings WHERE id = ?", [did]).fetchone() is None:
        raise HTTPException(404, "No such drawing.")
    db.execute(
        "UPDATE chart_drawings SET symbol = ?, kind = ?, time1 = ?, price1 = ?, time2 = ?, price2 = ?, color = ?, "
        "updated_at = now() WHERE id = ?",
        [body.symbol.strip().upper(), body.kind, body.time1.replace(tzinfo=None), body.price1,
         body.time2.replace(tzinfo=None), body.price2, body.color, did],
    )
    return _row(db.execute(f"SELECT {COLUMNS} FROM chart_drawings WHERE id = ?", [did]).fetchone())


@router.delete("/{did}")
def delete_drawing(did: int):
    db = get_db()
    if db.execute("SELECT 1 FROM chart_drawings WHERE id = ?", [did]).fetchone() is None:
        raise HTTPException(404, "No such drawing.")
    db.execute("DELETE FROM chart_drawings WHERE id = ?", [did])
    return {"ok": True}
