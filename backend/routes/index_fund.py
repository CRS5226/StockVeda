"""
Index fund construction / replication (Phase 6b) — computed-proxy constituent weights
(niftyindices.com, the official source, is unreachable from this VPS). Every response
carries source="computed_proxy" so the UI can flag it clearly.
"""

from datetime import date, timedelta

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from backend.core.index_replication import (
    INDEX_UNIVERSE, ReplicationParams, build_replicating_portfolio, get_index_weights,
)

router = APIRouter(prefix="/index-fund", tags=["index-fund"])


@router.get("/indices")
def list_indices():
    return {"indices": list(INDEX_UNIVERSE.keys())}


@router.get("/weights/{index_name}")
def get_weights(index_name: str, force_refresh: bool = Query(False)):
    weights = get_index_weights(index_name.upper().replace("-", " "), force_refresh=force_refresh)
    if not weights:
        raise HTTPException(404, f"Could not compute weights for {index_name} (unknown index or no OHLCV data)")
    return {
        "index_name": index_name.upper(),
        "source": "computed_proxy",
        "total_weight_pct": round(sum(w.weight_pct for w in weights), 2),
        "constituents": [w.__dict__ for w in weights],
    }


class ReplicationRequest(BaseModel):
    index_name: str = "NIFTY 50"
    capital: float = 1_000_000.0
    rebalance_frequency: str = "none"
    from_date: str | None = None
    to_date: str | None = None


@router.post("/replicate")
def replicate(req: ReplicationRequest):
    params = ReplicationParams(
        index_name=req.index_name.upper(),
        capital=req.capital,
        rebalance_frequency=req.rebalance_frequency,  # type: ignore[arg-type]
        from_date=req.from_date or (date.today() - timedelta(days=365)).isoformat(),
        to_date=req.to_date or date.today().isoformat(),
    )
    result = build_replicating_portfolio(params)
    if "error" in result:
        raise HTTPException(404, result["error"])
    return result
