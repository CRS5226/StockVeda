"""Simulation route: a Monte Carlo of the whole portfolio from its own past returns, with its outcome distributions.

Educational maths on past prices; not a forecast.
"""

from datetime import date, timedelta

import pandas as pd
from fastapi import APIRouter, HTTPException, Query

from backend.core.candles import load_daily
from backend.core.fd import FdTerms, fd_status
from backend.core.portfolio_simulation import MIN_RETURN_DAYS, assemble, simulate
from backend.core.stock_health import positions
from backend.db.connection import get_db
from backend.routes.portfolio import portfolio_detail
from backend.routes.portfolio_assets import asset_listing
from backend.routes.portfolio_fd import fd_listing
from backend.routes.portfolio_mf import mf_listing

router = APIRouter(prefix="/portfolios/{pid}/simulation", tags=["portfolio"])


def _nav_series(db, codes: list[str]) -> dict[str, pd.Series]:
    if not codes:
        return {}
    marks = ",".join("?" for _ in codes)
    df = db.execute(f"SELECT scheme_code, date, nav FROM mf_nav WHERE scheme_code IN ({marks}) AND date >= current_date - INTERVAL 800 DAY ORDER BY scheme_code, date", codes).df()
    return {code: pd.Series(g["nav"].to_numpy(), index=pd.to_datetime(g["date"])) for code, g in df.groupby("scheme_code")}


def _fd_path(fd: dict, months: int) -> list[float]:
    terms = FdTerms(fd["principal"], fd["annual_rate"], date.fromisoformat(fd["start_date"]), date.fromisoformat(fd["maturity_date"]), fd["compounding"], fd["payout"])
    today = date.today()
    return [fd_status(terms, today + timedelta(days=round(30.4375 * k)))["current_value"] for k in range(months + 1)]


@router.get("")
def get_simulation(pid: int, months: int = Query(12, ge=1, le=36), paths: int = Query(2000, ge=200, le=5000)):
    db = get_db()
    rows = positions(portfolio_detail(db, pid)["holdings"])        # 404s for an unknown portfolio
    funds = [h for h in mf_listing(db, pid)["holdings"] if h["current_value"]]
    closes = load_daily(db, [r["symbol"] for r in rows])
    navs = _nav_series(db, sorted({h["scheme_code"] for h in funds}))
    fund_values: dict[str, float] = {}
    for h in funds:
        fund_values[h["scheme_code"]] = fund_values.get(h["scheme_code"], 0.0) + h["current_value"]
    flat = [a for a in asset_listing(db, pid)["assets"] if a["value_inr"] is not None]

    sleeve, sleeve_value, fixed, split = assemble(
        {sym: pd.Series(df["close"].to_numpy(), index=pd.to_datetime(df["date"])) for sym, df in closes.items()},
        {r["symbol"]: r["value"] for r in rows}, navs, fund_values,
        [_fd_path(fd, months) for fd in fd_listing(db, pid)["fds"]], sum(a["value_inr"] for a in flat), months,
    )
    result = simulate(sleeve, sleeve_value, fixed, months, paths)
    return {
        "result": result,
        "error": None if result else "not_enough_history",
        "min_days": MIN_RETURN_DAYS,
        "composition": split,
        "held_flat": [{"name": a["name"], "type": a["asset_type"], "value": a["value_inr"]} for a in flat],
    }
