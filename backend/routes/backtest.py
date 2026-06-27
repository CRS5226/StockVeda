"""
Backtest route — run strategy simulations on historical OHLCV data.
"""

from datetime import date
from typing import Optional, Literal
from concurrent.futures import ThreadPoolExecutor, as_completed
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from backend.db.connection import get_db
from backend.core.backtest_engine import (
    run_backtest, BacktestParams,
    run_backtest_v2, BacktestParamsV2, ConditionRow,
    ENTRY_CONDITIONS, VALID_INDICATORS, VALID_OPERATORS,
)
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


# ── V2 endpoints ───────────────────────────────────────────────────────────

@router.get("/entry-conditions")
def get_entry_conditions():
    return ENTRY_CONDITIONS


@router.get("/indicators")
def get_indicators():
    return {"indicators": VALID_INDICATORS, "operators": VALID_OPERATORS}


class ConditionRowIn(BaseModel):
    left: str
    operator: str
    right: str


class BacktestV2Request(BaseModel):
    symbols: list[str]
    from_date: str
    to_date: str
    entry_conditions: list[ConditionRowIn]
    exit_conditions: list[ConditionRowIn] = []
    target_pct: float = 15.0
    sl_pct: float = 7.0
    max_bars: int = Field(30, ge=1, le=252)
    capital_per_trade: float = Field(10_000.0, gt=0)
    timeframe: str = "1D"


@router.post("/run-v2")
def run_v2(req: BacktestV2Request):
    if not req.entry_conditions:
        raise HTTPException(400, "At least one entry condition is required")

    db = get_db()
    entry_rows = [ConditionRow(left=c.left, operator=c.operator, right=c.right) for c in req.entry_conditions]
    exit_rows  = [ConditionRow(left=c.left, operator=c.operator, right=c.right) for c in req.exit_conditions]

    params = BacktestParamsV2(
        entry_conditions=entry_rows,
        exit_conditions=exit_rows,
        target_pct=req.target_pct,
        sl_pct=req.sl_pct,
        max_bars=req.max_bars,
        capital_per_trade=req.capital_per_trade,
        timeframe=req.timeframe,
    )

    per_symbol: dict = {}
    for sym in req.symbols:
        sym = sym.upper()
        df = db.execute(
            """SELECT date, open, high, low, close, volume FROM stock_ohlcv
               WHERE symbol = ? AND date BETWEEN ? AND ? ORDER BY date""",
            [sym, req.from_date, req.to_date],
        ).df()
        if len(df) < 30:
            continue
        try:
            per_symbol[sym] = run_backtest_v2(df, params)
        except Exception:
            continue

    if not per_symbol:
        raise HTTPException(400, "No data found for any symbol in the given date range. Sync data first via the Screener.")

    # Aggregate stats
    all_trades = [t for r in per_symbol.values() for t in r["trades"]]
    total_trades = len(all_trades)
    winners = [t for t in all_trades if t["exit_reason"] == "target" or t["pnl"] > 0]
    total_pnl = sum(t["pnl"] for t in all_trades)

    sym_pnl = {sym: sum(t["pnl"] for t in r["trades"]) for sym, r in per_symbol.items() if r["trades"]}
    best  = max(sym_pnl, key=sym_pnl.get) if sym_pnl else ""
    worst = min(sym_pnl, key=sym_pnl.get) if sym_pnl else ""

    aggregate = {
        "total_trades":  total_trades,
        "win_rate_pct":  round(len(winners) / total_trades * 100, 1) if total_trades else 0,
        "total_pnl":     round(total_pnl, 2),
        "avg_pnl_pct":   round(sum(t["pnl_pct"] for t in all_trades) / total_trades, 2) if total_trades else 0,
        "best_symbol":   best,
        "worst_symbol":  worst,
    }

    return {"aggregate": aggregate, "per_symbol": per_symbol}


# ── Matrix backtest (M algos × N stocks) ──────────────────────────────────

class MatrixAlgoIn(BaseModel):
    id: str
    label: str
    entry_conditions: list[ConditionRowIn]
    exit_conditions: list[ConditionRowIn] = []
    target_pct: float = 15.0
    sl_pct: float = 7.0
    max_bars: int = Field(30, ge=1, le=252)


class MatrixRequest(BaseModel):
    symbols: list[str] = Field(..., min_length=1, max_length=200)
    algos: list[MatrixAlgoIn] = Field(..., min_length=1, max_length=10)
    from_date: str
    to_date: str
    capital_per_trade: float = Field(10_000.0, gt=0)
    timeframe: str = "1D"


@router.post("/run-matrix")
def run_matrix(req: MatrixRequest):
    # Pre-fetch all OHLCV data on the main thread (DuckDB is thread-local)
    db = get_db()
    ohlcv: dict[str, pd.DataFrame] = {}
    for sym in req.symbols:
        s = sym.upper()
        df = db.execute(
            """SELECT date, open, high, low, close, volume FROM stock_ohlcv
               WHERE symbol = ? AND date BETWEEN ? AND ? ORDER BY date""",
            [s, req.from_date, req.to_date],
        ).df()
        if len(df) >= 30:
            ohlcv[s] = df

    if not ohlcv:
        raise HTTPException(400, "No data found for any symbol in the given date range. Sync data first via the Screener.")

    # Build BacktestParamsV2 per algo
    algo_params: list[tuple[str, str, BacktestParamsV2]] = []
    for algo in req.algos:
        if not algo.entry_conditions:
            raise HTTPException(400, f"Algo '{algo.label}' has no entry conditions")
        entry_rows = [ConditionRow(left=c.left, operator=c.operator, right=c.right) for c in algo.entry_conditions]
        exit_rows  = [ConditionRow(left=c.left, operator=c.operator, right=c.right) for c in algo.exit_conditions]
        params = BacktestParamsV2(
            entry_conditions=entry_rows,
            exit_conditions=exit_rows,
            target_pct=algo.target_pct,
            sl_pct=algo.sl_pct,
            max_bars=algo.max_bars,
            capital_per_trade=req.capital_per_trade,
            timeframe=req.timeframe,
        )
        algo_params.append((algo.id, algo.label, params))

    # Run all (symbol, algo) pairs in parallel — pure computation, no DB access
    def run_pair(sym: str, df: pd.DataFrame, params: BacktestParamsV2) -> dict:
        try:
            return run_backtest_v2(df, params)
        except Exception:
            return {"trades": [], "stats": {"total_trades": 0, "win_rate_pct": 0.0, "total_pnl": 0.0, "avg_pnl_pct": 0.0}, "ohlcv": []}

    pairs = [(sym, algo_id, label, params) for sym in ohlcv for algo_id, label, params in algo_params]
    matrix: dict[str, dict[str, dict]] = {sym: {} for sym in ohlcv}

    with ThreadPoolExecutor(max_workers=min(len(pairs), 32)) as pool:
        futures = {
            pool.submit(run_pair, sym, ohlcv[sym], params): (sym, algo_id)
            for sym, algo_id, label, params in pairs
        }
        for future in as_completed(futures):
            sym, algo_id = futures[future]
            matrix[sym][algo_id] = future.result()

    # Aggregate stats
    algo_label_map = {algo_id: label for algo_id, label, _ in algo_params}

    per_algo: dict = {}
    for algo_id, label, _ in algo_params:
        trades = [t for sym in matrix for t in matrix[sym].get(algo_id, {}).get("trades", [])]
        total = len(trades)
        winners = [t for t in trades if t["pnl"] > 0]
        per_algo[algo_id] = {
            "label": label,
            "total_trades": total,
            "win_rate_pct": round(len(winners) / total * 100, 1) if total else 0.0,
            "total_pnl": round(sum(t["pnl"] for t in trades), 2),
            "avg_pnl_pct": round(sum(t["pnl_pct"] for t in trades) / total, 2) if total else 0.0,
        }

    per_symbol: dict = {}
    for sym in matrix:
        trades = [t for algo_id in matrix[sym] for t in matrix[sym][algo_id].get("trades", [])]
        total = len(trades)
        winners = [t for t in trades if t["pnl"] > 0]
        per_symbol[sym] = {
            "total_trades": total,
            "win_rate_pct": round(len(winners) / total * 100, 1) if total else 0.0,
            "total_pnl": round(sum(t["pnl"] for t in trades), 2),
        }

    all_trades = [t for sym in matrix for algo_id in matrix[sym] for t in matrix[sym][algo_id].get("trades", [])]
    total_all = len(all_trades)
    winners_all = [t for t in all_trades if t["pnl"] > 0]

    def _wr(trades: list) -> float:
        return round(len([t for t in trades if t["pnl"] > 0]) / len(trades) * 100, 1) if trades else 0.0

    combos_with_trades = {
        (sym, algo_id): {
            "trades": matrix[sym].get(algo_id, {}).get("trades", []),
            "pnl": sum(t["pnl"] for t in matrix[sym].get(algo_id, {}).get("trades", [])),
        }
        for sym in matrix for algo_id in algo_label_map
        if matrix[sym].get(algo_id, {}).get("trades")
    }

    best_key  = max(combos_with_trades, key=lambda k: combos_with_trades[k]["pnl"]) if combos_with_trades else None
    worst_key = min(combos_with_trades, key=lambda k: combos_with_trades[k]["pnl"]) if combos_with_trades else None

    aggregate = {
        "total_trades": total_all,
        "win_rate_pct": round(len(winners_all) / total_all * 100, 1) if total_all else 0.0,
        "total_pnl": round(sum(t["pnl"] for t in all_trades), 2),
        "avg_pnl_pct": round(sum(t["pnl_pct"] for t in all_trades) / total_all, 2) if total_all else 0.0,
        "best_combo": {
            "symbol": best_key[0], "algo_id": best_key[1],
            "win_rate_pct": _wr(combos_with_trades[best_key]["trades"]),
            "total_pnl": round(combos_with_trades[best_key]["pnl"], 2),
        } if best_key else None,
        "worst_combo": {
            "symbol": worst_key[0], "algo_id": worst_key[1],
            "win_rate_pct": _wr(combos_with_trades[worst_key]["trades"]),
            "total_pnl": round(combos_with_trades[worst_key]["pnl"], 2),
        } if worst_key else None,
    }

    return {"matrix": matrix, "per_algo": per_algo, "per_symbol": per_symbol, "aggregate": aggregate}
