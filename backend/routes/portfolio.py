"""Portfolio routes: portfolios and their stock holdings, entered by hand or started from a watchlist."""

from datetime import date
from typing import Literal, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from backend.core.dividends import buy_date_problem
from backend.core.instrument_type import effective_kind
from backend.core.portfolio import holding_metrics, latest_closes, portfolio_totals
from backend.db.connection import get_db

router = APIRouter(prefix="/portfolios", tags=["portfolio"])


class PortfolioIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)


class FromWatchlistIn(BaseModel):
    watchlist_id: int
    name: Optional[str] = Field(None, min_length=1, max_length=80)


class HoldingIn(BaseModel):
    symbol: str = Field(min_length=1, max_length=30)
    qty: Optional[float] = Field(None, gt=0)
    buy_price: Optional[float] = Field(None, gt=0)
    buy_date: Optional[date] = None
    kind: Optional[Literal["stock", "etf", "reit", "invit"]] = None   # set by hand; empty means worked out from the symbol


def _company_names(db, symbols: list[str]) -> dict[str, str]:
    if not symbols:
        return {}
    marks = ",".join("?" for _ in symbols)
    return dict(db.execute(f"SELECT symbol, company_name FROM nse_symbols WHERE symbol IN ({marks})", symbols).fetchall())


def _next_id(db, table: str) -> int:
    # Same approach as the watchlists: the next id from the table itself (single-writer app).
    return db.execute(f"SELECT COALESCE(MAX(id), 0) + 1 FROM {table}").fetchone()[0]


def _require_portfolio(db, pid: int) -> tuple:
    row = db.execute("SELECT id, name FROM portfolios WHERE id = ?", [pid]).fetchone()
    if row is None:
        raise HTTPException(404, "No such portfolio.")
    return row


def portfolio_detail(db, pid: int) -> dict:
    _, name = _require_portfolio(db, pid)
    lots = db.execute(
        "SELECT id, symbol, qty, buy_price, buy_date, kind FROM portfolio_holdings WHERE portfolio_id = ? ORDER BY symbol, id", [pid]
    ).fetchall()
    symbols = sorted({r[1] for r in lots})
    closes = latest_closes(db, symbols)
    names = _company_names(db, symbols)
    holdings = []
    for hid, symbol, qty, buy_price, buy_date, kind in lots:
        last, last_date = closes.get(symbol, (None, None))
        holdings.append({
            "id": hid, "symbol": symbol, "qty": qty, "buy_price": buy_price,
            "kind": effective_kind(kind, symbol, names.get(symbol)), "kind_override": kind,
            "buy_date": str(buy_date) if buy_date else None, "last_price": last, "last_date": last_date,
            **holding_metrics(qty, buy_price, last),
        })
    return {"id": pid, "name": name, "holdings": holdings, "totals": portfolio_totals(holdings)}


@router.get("")
def list_portfolios():
    db = get_db()
    rows = db.execute(
        "SELECT p.id, p.name, COUNT(h.id) FROM portfolios p LEFT JOIN portfolio_holdings h ON h.portfolio_id = p.id "
        "GROUP BY p.id, p.name ORDER BY p.id"
    ).fetchall()
    return [{"id": r[0], "name": r[1], "holdings": r[2]} for r in rows]


@router.post("")
def create_portfolio(body: PortfolioIn):
    db = get_db()
    pid = _next_id(db, "portfolios")
    db.execute("INSERT INTO portfolios (id, name) VALUES (?, ?)", [pid, body.name.strip()])
    return portfolio_detail(db, pid)


@router.post("/from-watchlist")
def create_from_watchlist(body: FromWatchlistIn):
    """A new portfolio with one empty holding per stock of the watchlist; quantity and buy price are filled in later."""
    db = get_db()
    wl = db.execute("SELECT name, symbols FROM watchlists WHERE id = ?", [body.watchlist_id]).fetchone()
    if wl is None:
        raise HTTPException(404, "No such watchlist.")
    pid = _next_id(db, "portfolios")
    db.execute("INSERT INTO portfolios (id, name) VALUES (?, ?)", [pid, (body.name or wl[0]).strip()])
    hid = _next_id(db, "portfolio_holdings")
    for offset, symbol in enumerate(dict.fromkeys(s.strip().upper() for s in (wl[1] or []))):
        db.execute("INSERT INTO portfolio_holdings (id, portfolio_id, symbol) VALUES (?, ?, ?)", [hid + offset, pid, symbol])
    return portfolio_detail(db, pid)


@router.get("/{pid}")
def get_portfolio(pid: int):
    return portfolio_detail(get_db(), pid)


@router.put("/{pid}")
def rename_portfolio(pid: int, body: PortfolioIn):
    db = get_db()
    _require_portfolio(db, pid)
    db.execute("UPDATE portfolios SET name = ? WHERE id = ?", [body.name.strip(), pid])
    return portfolio_detail(db, pid)


@router.delete("/{pid}")
def delete_portfolio(pid: int):
    db = get_db()
    _require_portfolio(db, pid)
    db.execute("DELETE FROM portfolio_holdings WHERE portfolio_id = ?", [pid])
    db.execute("DELETE FROM portfolio_fds WHERE portfolio_id = ?", [pid])
    db.execute("DELETE FROM portfolio_assets WHERE portfolio_id = ?", [pid])
    db.execute("DELETE FROM portfolio_mf WHERE portfolio_id = ?", [pid])
    db.execute("DELETE FROM portfolio_dividends WHERE portfolio_id = ?", [pid])
    db.execute("DELETE FROM portfolios WHERE id = ?", [pid])
    return {"ok": True}


@router.post("/{pid}/holdings")
def add_holding(pid: int, body: HoldingIn):
    db = get_db()
    _require_portfolio(db, pid)
    db.execute(
        "INSERT INTO portfolio_holdings (id, portfolio_id, symbol, qty, buy_price, buy_date, kind) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [_next_id(db, "portfolio_holdings"), pid, body.symbol.strip().upper(), body.qty, body.buy_price, body.buy_date, body.kind],
    )
    return portfolio_detail(db, pid)


def _check_dividends_still_after_purchase(db, pid: int, hid: int, body: HoldingIn) -> None:
    """A new buy date must not put a dividend of the stock before its purchase."""
    symbol = body.symbol.strip().upper()
    others = [r[0] for r in db.execute(
        "SELECT buy_date FROM portfolio_holdings WHERE portfolio_id = ? AND symbol = ? AND id <> ?", [pid, symbol, hid]).fetchall()]
    first = db.execute("SELECT MIN(pay_date) FROM portfolio_dividends WHERE portfolio_id = ? AND symbol = ?", [pid, symbol]).fetchall()[0][0]
    problem = buy_date_problem(symbol, others + [body.buy_date], first)
    if problem:
        raise HTTPException(400, problem)


@router.put("/{pid}/holdings/{hid}")
def update_holding(pid: int, hid: int, body: HoldingIn):
    db = get_db()
    _require_portfolio(db, pid)
    if db.execute("SELECT 1 FROM portfolio_holdings WHERE id = ? AND portfolio_id = ?", [hid, pid]).fetchone() is None:
        raise HTTPException(404, "No such holding.")
    _check_dividends_still_after_purchase(db, pid, hid, body)
    db.execute(
        "UPDATE portfolio_holdings SET symbol = ?, qty = ?, buy_price = ?, buy_date = ?, kind = ? WHERE id = ?",
        [body.symbol.strip().upper(), body.qty, body.buy_price, body.buy_date, body.kind, hid],
    )
    return portfolio_detail(db, pid)


def _refuse_if_it_would_orphan_dividends(db, pid: int, hid: int) -> None:
    """Removing the last lot of a stock would leave its dividends with no purchase behind them."""
    row = db.execute("SELECT symbol FROM portfolio_holdings WHERE id = ? AND portfolio_id = ?", [hid, pid]).fetchall()
    if not row:
        return
    symbol = row[0][0]
    others = db.execute("SELECT COUNT(*) FROM portfolio_holdings WHERE portfolio_id = ? AND symbol = ? AND id <> ?", [pid, symbol, hid]).fetchall()[0][0]
    dividends = db.execute("SELECT COUNT(*) FROM portfolio_dividends WHERE portfolio_id = ? AND symbol = ?", [pid, symbol]).fetchall()[0][0]
    if others == 0 and dividends > 0:
        raise HTTPException(400, f"{symbol} has {dividends} recorded {'dividend' if dividends == 1 else 'dividends'}. Delete them before removing the stock.")


@router.delete("/{pid}/holdings/{hid}")
def delete_holding(pid: int, hid: int):
    db = get_db()
    _require_portfolio(db, pid)
    _refuse_if_it_would_orphan_dividends(db, pid, hid)
    db.execute("DELETE FROM portfolio_holdings WHERE id = ? AND portfolio_id = ?", [hid, pid])
    return portfolio_detail(db, pid)
