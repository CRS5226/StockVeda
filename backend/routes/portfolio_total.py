"""Portfolio total route: stocks, fixed deposits and other investments added up in rupees."""

from fastapi import APIRouter

from backend.core.portfolio_total import combine
from backend.db.connection import get_db
from backend.routes.portfolio import portfolio_detail
from backend.routes.portfolio_assets import asset_listing
from backend.routes.portfolio_fd import fd_listing

router = APIRouter(prefix="/portfolios/{pid}/total", tags=["portfolio"])


@router.get("")
def get_total(pid: int):
    db = get_db()
    stocks = portfolio_detail(db, pid)   # 404s for an unknown portfolio
    fds = fd_listing(db, pid)
    assets = asset_listing(db, pid)
    return combine(stocks["totals"], fds["totals"], assets["assets"])
