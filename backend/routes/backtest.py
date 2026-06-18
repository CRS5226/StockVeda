"""
Backtest route — run strategy simulations on historical OHLCV data.
"""

from datetime import date
from typing import Optional, Literal
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from backend.db.connection import get_db
from backend.core.backtest_engine import run_backtest, BacktestParams
import pandas as pd

router = APIRouter(prefix="/backtest", tags=["backtest"])


class BacktestRequest(BaseModel):
    symbol: str
    from_date: str = Field(..., description="YYYY-MM-DD")
    to_date:   str = Field(..., description="YYYY-MM-DD")
    initial_capital: float = Field(100_000.0, gt=0)
    entry_col: str = "close"
    entry_op: Literal["gt", "lt", "cross_above", "cross_below"] = "cross_above"
    entry_threshold_col: str = "sma_50"
    exit_bars: Optional[int] = Field(20, ge=1, le=500)
    exit_col: Optional[str] = None
    exit_op: Optional[Literal["gt", "lt", "cross_above", "cross_below"]] = None
    exit_threshold_col: Optional[str] = None
    position_pct: float = Field(1.0, gt=0, le=1)


@router.post("/run")
def run(req: BacktestRequest):
    db = get_db()
    df = db.execute(
        """SELECT date, open, high, low, close, volume FROM stock_ohlcv
           WHERE symbol = ? AND date BETWEEN ? AND ? ORDER BY date""",
        [req.symbol.upper(), req.from_date, req.to_date]
    ).df()

    if df.empty:
        raise HTTPException(404, f"No OHLCV data for {req.symbol} in that date range")
    if len(df) < 60:
        raise HTTPException(400, "Need at least 60 trading days of data")

    params = BacktestParams(
        symbol=req.symbol,
        from_date=req.from_date,
        to_date=req.to_date,
        initial_capital=req.initial_capital,
        entry_col=req.entry_col,
        entry_op=req.entry_op,
        entry_threshold_col=req.entry_threshold_col,
        exit_bars=req.exit_bars,
        exit_col=req.exit_col,
        exit_op=req.exit_op,
        exit_threshold_col=req.exit_threshold_col,
        position_pct=req.position_pct,
    )

    try:
        result = run_backtest(df, params)
    except Exception as e:
        raise HTTPException(500, str(e))

    if "error" in result:
        raise HTTPException(400, result["error"])

    return result


@router.get("/strategies")
def list_strategies():
    """Pre-defined strategy templates for the UI."""
    return [
        {
            "name": "Golden Cross",
            "description": "Buy when SMA-50 crosses above SMA-200; sell after 60 bars",
            "params": {
                "entry_col": "sma_50", "entry_op": "cross_above",
                "entry_threshold_col": "sma_200", "exit_bars": 60,
            },
        },
        {
            "name": "RSI Oversold Bounce",
            "description": "Buy when RSI-14 crosses above 30; sell when RSI crosses above 70",
            "params": {
                "entry_col": "rsi_14", "entry_op": "cross_above",
                "entry_threshold_col": "30",
                "exit_col": "rsi_14", "exit_op": "cross_above",
                "exit_threshold_col": "70",
            },
        },
        {
            "name": "Price above SMA-200",
            "description": "Buy when price crosses above SMA-200; sell after 30 bars",
            "params": {
                "entry_col": "close", "entry_op": "cross_above",
                "entry_threshold_col": "sma_200", "exit_bars": 30,
            },
        },
        {
            "name": "EMA-20 / EMA-50 Cross",
            "description": "Buy when EMA-20 crosses above EMA-50; sell on reverse",
            "params": {
                "entry_col": "ema_20", "entry_op": "cross_above",
                "entry_threshold_col": "ema_50",
                "exit_col": "ema_20", "exit_op": "cross_below",
                "exit_threshold_col": "ema_50",
            },
        },
    ]
