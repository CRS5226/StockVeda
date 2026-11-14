"""Dividend routes: dividends received on the stocks of a portfolio, typed in by hand."""

from datetime import date

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from backend.core.dividends import summarize
from backend.db.connection import get_db

router = APIRouter(prefix="/portfolios/{pid}/dividends", tags=["portfolio"])

COLUMNS = "id, symbol, pay_date, amount, tds"


class DividendIn(BaseModel):
    symbol: str = Field(min_length=1, max_length=30)
    pay_date: date
    amount: float = Field(gt=0)
    tds: float = Field(0, ge=0)


def _require_portfolio(db, pid: int) -> None:
    if not db.execute("SELECT 1 FROM portfolios WHERE id = ?", [pid]).fetchall():
        raise HTTPException(404, "No such portfolio.")


def _checked(body: DividendIn) -> None:
    if body.pay_date > date.today():
        raise HTTPException(400, "The payment date cannot be in the future.")


def dividend_rows(db, pid: int) -> list[dict]:
    rows = db.execute(f"SELECT {COLUMNS} FROM portfolio_dividends WHERE portfolio_id = ? ORDER BY pay_date DESC, id DESC", [pid]).fetchall()
    return [{"id": r[0], "symbol": r[1], "pay_date": r[2], "amount": r[3], "tds": r[4] or 0.0} for r in rows]


def dividend_listing(db, pid: int) -> dict:
    _require_portfolio(db, pid)
    rows = dividend_rows(db, pid)
    summary = summarize(rows, date.today())
    return {"dividends": [{**r, "pay_date": str(r["pay_date"])} for r in rows], "summary": summary}


@router.get("")
def list_dividends(pid: int):
    return dividend_listing(get_db(), pid)


@router.post("")
def add_dividend(pid: int, body: DividendIn):
    _checked(body)
    db = get_db()
    _require_portfolio(db, pid)
    did = db.execute("SELECT COALESCE(MAX(id), 0) + 1 FROM portfolio_dividends").fetchall()[0][0]
    db.execute(
        "INSERT INTO portfolio_dividends (id, portfolio_id, symbol, pay_date, amount, tds) VALUES (?, ?, ?, ?, ?, ?)",
        [did, pid, body.symbol.strip().upper(), body.pay_date, body.amount, body.tds],
    )
    return dividend_listing(db, pid)


@router.put("/{did}")
def update_dividend(pid: int, did: int, body: DividendIn):
    _checked(body)
    db = get_db()
    _require_portfolio(db, pid)
    if not db.execute("SELECT 1 FROM portfolio_dividends WHERE id = ? AND portfolio_id = ?", [did, pid]).fetchall():
        raise HTTPException(404, "No such dividend.")
    db.execute(
        "UPDATE portfolio_dividends SET symbol = ?, pay_date = ?, amount = ?, tds = ? WHERE id = ?",
        [body.symbol.strip().upper(), body.pay_date, body.amount, body.tds, did],
    )
    return dividend_listing(db, pid)


@router.delete("/{did}")
def delete_dividend(pid: int, did: int):
    db = get_db()
    _require_portfolio(db, pid)
    db.execute("DELETE FROM portfolio_dividends WHERE id = ? AND portfolio_id = ?", [did, pid])
    return dividend_listing(db, pid)
