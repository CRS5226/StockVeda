"""
Screener route — filter stocks by fundamental, technical, and flow conditions.
"""

from typing import Optional
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from backend.core.screener_engine import Condition, run_screen

router = APIRouter(prefix="/screener", tags=["screener"])


class ConditionIn(BaseModel):
    metric: str
    op: str
    value: float


class ScreenRequest(BaseModel):
    conditions: list[ConditionIn]
    limit: int = 200


@router.post("/run")
def run_screener(req: ScreenRequest):
    try:
        conditions = [Condition(metric=c.metric, op=c.op, value=c.value) for c in req.conditions]
        results = run_screen(conditions, limit=min(req.limit, 500))
        return {"count": len(results), "results": results}
    except ValueError as e:
        raise HTTPException(400, str(e))
    except RuntimeError as e:
        raise HTTPException(500, str(e))


@router.get("/presets")
def get_presets():
    """Return built-in screener presets for the UI."""
    return [
        {
            "name": "High Delivery",
            "description": "Stocks with >70% delivery percentage",
            "conditions": [{"metric": "delivery_pct", "op": "gte", "value": 70}],
        },
        {
            "name": "Low P/E Value Picks",
            "description": "P/E below 15, profitable",
            "conditions": [
                {"metric": "pe_ratio", "op": "gt", "value": 0},
                {"metric": "pe_ratio", "op": "lt", "value": 15},
                {"metric": "pat", "op": "gt", "value": 0},
            ],
        },
        {
            "name": "Strong Promoter Holding",
            "description": "Promoter stake above 50%",
            "conditions": [{"metric": "promoter_pct", "op": "gte", "value": 50}],
        },
        {
            "name": "Debt-Free",
            "description": "Debt-to-equity below 0.1",
            "conditions": [{"metric": "debt_to_equity", "op": "lt", "value": 0.1}],
        },
        {
            "name": "FII Buying",
            "description": "FII holding above 20%",
            "conditions": [{"metric": "fii_pct", "op": "gte", "value": 20}],
        },
        {
            "name": "High Volume Movers",
            "description": "Volume above 1 million shares",
            "conditions": [{"metric": "volume", "op": "gte", "value": 1_000_000}],
        },
    ]


@router.get("/metrics")
def get_allowed_metrics():
    from backend.core.screener_engine import ALLOWED_METRICS, ALLOWED_OPS
    return {"metrics": sorted(ALLOWED_METRICS), "operators": list(ALLOWED_OPS.keys())}
