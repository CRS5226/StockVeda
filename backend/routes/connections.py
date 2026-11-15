"""Stock Connections routes: correlated stocks and peers for one symbol."""

from fastapi import APIRouter, HTTPException

from backend.core.correlation import DEFAULT_WINDOW, connections_for

router = APIRouter(tags=["connections"])


@router.get("/stock/{symbol}/connections/correlated")
def correlated(symbol: str, window: int = DEFAULT_WINDOW, top: int = 10):
    result = connections_for(symbol, window=window, top_n=min(max(top, 1), 30))
    if result is None:
        raise HTTPException(404, "No price data for this symbol.")
    return result
