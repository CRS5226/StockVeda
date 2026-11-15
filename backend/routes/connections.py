"""Stock Connections routes: correlated stocks and peers for one symbol."""

from fastapi import APIRouter, HTTPException

from backend.core.correlation import DEFAULT_WINDOW, connections_for
from backend.core.ownership_graph import ownership_graph
from backend.core.shareholders import get_shareholders

router = APIRouter(tags=["connections"])


@router.get("/stock/{symbol}/connections/correlated")
def correlated(symbol: str, window: int = DEFAULT_WINDOW, top: int = 10):
    result = connections_for(symbol, window=window, top_n=min(max(top, 1), 30))
    if result is None:
        raise HTTPException(404, "No price data for this symbol.")
    return result


@router.get("/stock/{symbol}/shareholders")
def shareholders(symbol: str):
    result = get_shareholders(symbol)
    if result is None:
        raise HTTPException(404, "No shareholder data for this symbol yet. Run the shareholders sync.")
    return result


@router.get("/stock/{symbol}/ownership-graph")
def ownership(symbol: str, depth: int = 1):
    result = ownership_graph(symbol, depth=depth)
    if result is None:
        raise HTTPException(404, "No shareholder data for this symbol yet. Run the shareholders sync.")
    return result
