"""Portfolio total route: stocks, fixed deposits, mutual funds and other investments added up in rupees."""

from datetime import date

from fastapi import APIRouter

from backend.core.portfolio_total import build_flows, combine, portfolio_xirr
from backend.db.connection import get_db
from backend.routes.portfolio import portfolio_detail
from backend.routes.portfolio_assets import asset_listing
from backend.routes.portfolio_fd import fd_listing
from backend.routes.portfolio_mf import mf_listing_with_flows

router = APIRouter(prefix="/portfolios/{pid}/total", tags=["portfolio"])


@router.get("")
def get_total(pid: int):
    db = get_db()
    stocks = portfolio_detail(db, pid)   # 404s for an unknown portfolio
    fds = fd_listing(db, pid)
    assets = asset_listing(db, pid)
    mf, mf_flows = mf_listing_with_flows(db, pid)
    total = combine(stocks["totals"], fds["totals"], assets["assets"], mf["totals"])
    flows, dated, counted = build_flows(stocks["holdings"], fds["fds"], assets["assets"], mf_flows, date.today())
    # mutual funds always have dates; count them once for each holding
    total["xirr_pct"] = portfolio_xirr(flows)
    total["xirr_items"] = {"dated": dated + len(mf["holdings"]), "total": counted + len(mf["holdings"])}
    return total
