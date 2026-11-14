"""Mutual fund routes: the SIPs and lump sums of a portfolio, valued from stored NAV history."""

from datetime import date
from typing import Literal, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from backend.core.mf_analytics import xirr
from backend.core.mf_holding import MfTerms, evaluate
from backend.db.connection import get_db
from backend.routes.mutual_fund import load_meta_and_history

router = APIRouter(prefix="/portfolios/{pid}/mf", tags=["portfolio"])

COLUMNS = "h.id, h.scheme_code, h.scheme_name, h.kind, h.amount, h.start_date, h.end_date, m.plan, m.option_type, m.category"


class MfIn(BaseModel):
    scheme_code: str = Field(min_length=1, max_length=20)
    kind: Literal["sip", "lumpsum"]
    amount: float = Field(gt=0)
    start_date: date
    end_date: Optional[date] = None


def _require_portfolio(db, pid: int) -> None:
    # fetchall, not fetchone: an unfinished result would block the NAV backfill that registers a temp table on this connection
    if not db.execute("SELECT 1 FROM portfolios WHERE id = ?", [pid]).fetchall():
        raise HTTPException(404, "No such portfolio.")


def _checked(body: MfIn) -> None:
    if body.end_date is not None and (body.kind != "sip" or body.end_date <= body.start_date):
        raise HTTPException(400, "Only a SIP has an end date, and it must be after the start date.")
    if body.start_date > date.today():
        raise HTTPException(400, "The start date cannot be in the future.")


def _nav_history(db, codes: list[str]) -> dict[str, tuple[list, list]]:
    """Stored NAV dates and values per scheme, in one query."""
    if not codes:
        return {}
    marks = ",".join("?" for _ in codes)
    out: dict[str, tuple[list, list]] = {c: ([], []) for c in codes}
    for code, d, nav in db.execute(f"SELECT scheme_code, date, nav FROM mf_nav WHERE scheme_code IN ({marks}) ORDER BY date", codes).fetchall():
        out[code][0].append(d)
        out[code][1].append(nav)
    return out


def mf_listing_with_flows(db, pid: int) -> tuple[dict, list]:
    """The portfolio's mutual funds with figures, and all their dated cash flows (for the portfolio XIRR)."""
    _require_portfolio(db, pid)
    rows = db.execute(
        f"SELECT {COLUMNS} FROM portfolio_mf h LEFT JOIN mf_scheme_master m ON m.scheme_code = h.scheme_code "
        "WHERE h.portfolio_id = ? ORDER BY h.id", [pid]
    ).fetchall()
    history = _nav_history(db, sorted({r[1] for r in rows}))
    today = date.today()
    holdings, flows = [], []
    for hid, code, name, kind, amount, start, end, plan, option, category in rows:
        dates, navs = history[code]
        result = evaluate(MfTerms(kind, amount, start, end), dates, navs, today)
        flows.extend(result.pop("flows"))
        holdings.append({
            "id": hid, "scheme_code": code, "scheme_name": name, "kind": kind, "amount": amount, "start_date": str(start),
            "end_date": str(end) if end else None, "plan": plan, "option_type": option, "category": category, **result,
        })
    invested = sum(h["invested"] or 0 for h in holdings)
    value = sum(h["current_value"] or 0 for h in holdings)
    rate = xirr(flows) if flows else None
    totals = {
        "invested": invested, "current_value": value, "returns": value - invested,
        "returns_pct": (value - invested) / invested * 100 if invested else None,
        "xirr_pct": rate * 100 if rate is not None else None,
    }
    return {"holdings": holdings, "totals": totals}, flows


def mf_listing(db, pid: int) -> dict:
    return mf_listing_with_flows(db, pid)[0]


@router.get("")
def list_mf(pid: int):
    return mf_listing(get_db(), pid)


def _scheme_name(db, code: str) -> str:
    rows = db.execute("SELECT scheme_name FROM mf_scheme_master WHERE scheme_code = ?", [code]).fetchall()
    if not rows:
        raise HTTPException(404, "Unknown mutual fund scheme. Sync the scheme list from the Mutual Funds page first.")
    return rows[0][0]


@router.post("")
def add_mf(pid: int, body: MfIn):
    _checked(body)
    db = get_db()
    _require_portfolio(db, pid)
    name = _scheme_name(db, body.scheme_code)
    load_meta_and_history(body.scheme_code)   # fetches the NAV history once if it is not stored yet
    mid = db.execute("SELECT COALESCE(MAX(id), 0) + 1 FROM portfolio_mf").fetchone()[0]
    db.execute(
        "INSERT INTO portfolio_mf (id, portfolio_id, scheme_code, scheme_name, kind, amount, start_date, end_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        [mid, pid, body.scheme_code, name, body.kind, body.amount, body.start_date, body.end_date],
    )
    return mf_listing(db, pid)


@router.put("/{mid}")
def update_mf(pid: int, mid: int, body: MfIn):
    _checked(body)
    db = get_db()
    _require_portfolio(db, pid)
    if not db.execute("SELECT 1 FROM portfolio_mf WHERE id = ? AND portfolio_id = ?", [mid, pid]).fetchall():
        raise HTTPException(404, "No such mutual fund holding.")
    name = _scheme_name(db, body.scheme_code)
    load_meta_and_history(body.scheme_code)
    db.execute(
        "UPDATE portfolio_mf SET scheme_code = ?, scheme_name = ?, kind = ?, amount = ?, start_date = ?, end_date = ? WHERE id = ?",
        [body.scheme_code, name, body.kind, body.amount, body.start_date, body.end_date, mid],
    )
    return mf_listing(db, pid)


@router.delete("/{mid}")
def delete_mf(pid: int, mid: int):
    db = get_db()
    _require_portfolio(db, pid)
    db.execute("DELETE FROM portfolio_mf WHERE id = ? AND portfolio_id = ?", [mid, pid])
    return mf_listing(db, pid)
