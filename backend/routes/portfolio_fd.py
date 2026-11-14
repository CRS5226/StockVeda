"""Fixed deposit routes: the FDs of a portfolio, with their value worked out for today."""

from datetime import date
from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from backend.core.fd import FdTerms, fd_status, validate_terms
from backend.db.connection import get_db

router = APIRouter(prefix="/portfolios/{pid}/fds", tags=["portfolio"])

Frequency = Literal["monthly", "quarterly", "half_yearly", "yearly"]

COLUMNS = "id, name, principal, annual_rate, start_date, maturity_date, compounding, payout"


class FdIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    principal: float = Field(gt=0)
    annual_rate: float = Field(ge=0, le=100)
    start_date: date
    maturity_date: date
    compounding: Frequency = "quarterly"
    payout: Literal["cumulative", "monthly", "quarterly", "half_yearly", "yearly"] = "cumulative"


def _require_portfolio(db, pid: int) -> None:
    if db.execute("SELECT 1 FROM portfolios WHERE id = ?", [pid]).fetchone() is None:
        raise HTTPException(404, "No such portfolio.")


def _checked(body: FdIn) -> None:
    problem = validate_terms(FdTerms(body.principal, body.annual_rate, body.start_date, body.maturity_date, body.compounding, body.payout))
    if problem:
        raise HTTPException(400, problem)


def fd_listing(db, pid: int) -> dict:
    today = date.today()
    fds = []
    for fid, name, principal, rate, start, maturity, compounding, payout in db.execute(
        f"SELECT {COLUMNS} FROM portfolio_fds WHERE portfolio_id = ? ORDER BY maturity_date, id", [pid]
    ).fetchall():
        status = fd_status(FdTerms(principal, rate, start, maturity, compounding, payout), today)
        fds.append({
            "id": fid, "name": name, "principal": principal, "annual_rate": rate, "start_date": str(start),
            "maturity_date": str(maturity), "compounding": compounding, "payout": payout, **status,
        })
    return {
        "fds": fds,
        "totals": {
            "principal": sum(f["principal"] for f in fds),
            "current_value": sum(f["current_value"] for f in fds),
            "interest_earned": sum(f["interest_earned"] for f in fds),
            "interest_received": sum(f["interest_received"] for f in fds),
            "maturity_value": sum(f["maturity_value"] for f in fds),
        },
    }


@router.get("")
def list_fds(pid: int):
    db = get_db()
    _require_portfolio(db, pid)
    return fd_listing(db, pid)


@router.post("")
def add_fd(pid: int, body: FdIn):
    _checked(body)
    db = get_db()
    _require_portfolio(db, pid)
    fid = db.execute("SELECT COALESCE(MAX(id), 0) + 1 FROM portfolio_fds").fetchone()[0]
    db.execute(
        "INSERT INTO portfolio_fds (id, portfolio_id, name, principal, annual_rate, start_date, maturity_date, compounding, payout) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [fid, pid, body.name.strip(), body.principal, body.annual_rate, body.start_date, body.maturity_date, body.compounding, body.payout],
    )
    return fd_listing(db, pid)


@router.put("/{fid}")
def update_fd(pid: int, fid: int, body: FdIn):
    _checked(body)
    db = get_db()
    _require_portfolio(db, pid)
    if db.execute("SELECT 1 FROM portfolio_fds WHERE id = ? AND portfolio_id = ?", [fid, pid]).fetchone() is None:
        raise HTTPException(404, "No such fixed deposit.")
    db.execute(
        "UPDATE portfolio_fds SET name = ?, principal = ?, annual_rate = ?, start_date = ?, maturity_date = ?, compounding = ?, payout = ? WHERE id = ?",
        [body.name.strip(), body.principal, body.annual_rate, body.start_date, body.maturity_date, body.compounding, body.payout, fid],
    )
    return fd_listing(db, pid)


@router.delete("/{fid}")
def delete_fd(pid: int, fid: int):
    db = get_db()
    _require_portfolio(db, pid)
    db.execute("DELETE FROM portfolio_fds WHERE id = ? AND portfolio_id = ?", [fid, pid])
    return fd_listing(db, pid)
