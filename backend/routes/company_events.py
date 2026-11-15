"""Company events routes: order wins, ratings, deals and board meetings."""

from fastapi import APIRouter

from backend.core.company_events import recent_events, stock_events

router = APIRouter(tags=["company-events"])


@router.get("/stock/{symbol}/events")
def events_for_stock(symbol: str, days: int = 365, kind: str | None = None, limit: int = 100):
    return stock_events(symbol, days=days, kind=kind, limit=limit)


@router.get("/events/recent")
def events_recent(kind: str | None = None, days: int = 30, limit: int = 100):
    return recent_events(kind=kind, days=days, limit=limit)
