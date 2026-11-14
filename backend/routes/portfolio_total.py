"""Portfolio total route: stocks, fixed deposits, mutual funds and other investments added up in rupees."""

from datetime import date

from fastapi import APIRouter

from backend.core.portfolio_total import build_flows, combine, portfolio_xirr
from backend.db.connection import get_db
from backend.routes.portfolio import portfolio_detail
from backend.routes.portfolio_assets import asset_listing
from backend.routes.portfolio_dividends import dividend_rows
from backend.routes.portfolio_fd import fd_listing
from backend.routes.portfolio_mf import mf_listing_with_flows

router = APIRouter(prefix="/portfolios/{pid}/total", tags=["portfolio"])


def compute_total(db, pid: int) -> tuple[dict, dict]:
    """The portfolio total, and the stock detail it was built from (the health check needs both)."""
    stocks = portfolio_detail(db, pid)   # 404s for an unknown portfolio
    fds = fd_listing(db, pid)
    assets = asset_listing(db, pid)
    mf, mf_flows = mf_listing_with_flows(db, pid)
    dividends = dividend_rows(db, pid)
    total = combine(stocks["totals"], fds["totals"], assets["assets"], mf["totals"], sum(d["amount"] for d in dividends))
    flows, dated, counted = build_flows(stocks["holdings"], fds["fds"], assets["assets"], mf_flows, date.today(), dividends)
    # mutual funds always have dates; count them once for each holding
    total["xirr_pct"] = portfolio_xirr(flows)
    total["xirr_items"] = {"dated": dated + len(mf["holdings"]), "total": counted + len(mf["holdings"])}
    return total, stocks


@router.get("")
def get_total(pid: int):
    return compute_total(get_db(), pid)[0]
