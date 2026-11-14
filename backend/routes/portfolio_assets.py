"""Other-asset routes: crypto, US stocks, mutual funds, bonds, gold and anything else in a portfolio, with prices typed in."""

from datetime import date
from typing import Literal, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from backend.core.other_assets import asset_metrics, asset_totals
from backend.db.connection import get_db

router = APIRouter(prefix="/portfolios/{pid}/assets", tags=["portfolio"])

COLUMNS = "id, name, asset_type, currency, qty, buy_price, current_price, buy_date"


class AssetIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    asset_type: Literal["crypto", "us_stock", "mutual_fund", "bond", "gold", "other"]
    currency: Literal["INR", "USD"] = "INR"
    qty: float = Field(gt=0)
    buy_price: float = Field(gt=0)
    current_price: float = Field(gt=0)
    buy_date: Optional[date] = None


class RateIn(BaseModel):
    usd_inr: Optional[float] = Field(None, gt=0)


def _usd_inr(db, pid: int) -> Optional[float]:
    row = db.execute("SELECT usd_inr FROM portfolios WHERE id = ?", [pid]).fetchone()
    if row is None:
        raise HTTPException(404, "No such portfolio.")
    return row[0]


def asset_listing(db, pid: int) -> dict:
    rate = _usd_inr(db, pid)
    assets = []
    for aid, name, kind, currency, qty, buy_price, price, buy_date in db.execute(
        f"SELECT {COLUMNS} FROM portfolio_assets WHERE portfolio_id = ? ORDER BY asset_type, name, id", [pid]
    ).fetchall():
        assets.append({
            "id": aid, "name": name, "asset_type": kind, "currency": currency, "qty": qty, "buy_price": buy_price,
            "current_price": price, "buy_date": str(buy_date) if buy_date else None,
            **asset_metrics(qty, buy_price, price, currency, rate),
        })
    return {"assets": assets, "usd_inr": rate, "totals": asset_totals(assets)}


@router.get("")
def list_assets(pid: int):
    return asset_listing(get_db(), pid)


@router.put("/usd-inr")
def set_usd_inr(pid: int, body: RateIn):
    db = get_db()
    _usd_inr(db, pid)
    db.execute("UPDATE portfolios SET usd_inr = ? WHERE id = ?", [body.usd_inr, pid])
    return asset_listing(db, pid)


@router.post("")
def add_asset(pid: int, body: AssetIn):
    db = get_db()
    _usd_inr(db, pid)
    aid = db.execute("SELECT COALESCE(MAX(id), 0) + 1 FROM portfolio_assets").fetchone()[0]
    db.execute(
        "INSERT INTO portfolio_assets (id, portfolio_id, name, asset_type, currency, qty, buy_price, current_price, buy_date) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [aid, pid, body.name.strip(), body.asset_type, body.currency, body.qty, body.buy_price, body.current_price, body.buy_date],
    )
    return asset_listing(db, pid)


@router.put("/{aid}")
def update_asset(pid: int, aid: int, body: AssetIn):
    db = get_db()
    _usd_inr(db, pid)
    if db.execute("SELECT 1 FROM portfolio_assets WHERE id = ? AND portfolio_id = ?", [aid, pid]).fetchone() is None:
        raise HTTPException(404, "No such asset.")
    db.execute(
        "UPDATE portfolio_assets SET name = ?, asset_type = ?, currency = ?, qty = ?, buy_price = ?, current_price = ?, buy_date = ? WHERE id = ?",
        [body.name.strip(), body.asset_type, body.currency, body.qty, body.buy_price, body.current_price, body.buy_date, aid],
    )
    return asset_listing(db, pid)


@router.delete("/{aid}")
def delete_asset(pid: int, aid: int):
    db = get_db()
    _usd_inr(db, pid)
    db.execute("DELETE FROM portfolio_assets WHERE id = ? AND portfolio_id = ?", [aid, pid])
    return asset_listing(db, pid)
