"""
Backtest route — run strategy simulations on historical OHLCV data.
"""

import json
from datetime import date
from typing import Optional, Literal
from concurrent.futures import ThreadPoolExecutor, as_completed
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from backend.db.connection import get_db
from backend.core.backtest_engine import (
    run_backtest, BacktestParams,
    run_backtest_v2, BacktestParamsV2, ConditionRow,
    ENTRY_CONDITIONS, VALID_INDICATORS, VALID_OPERATORS,
)
from backend.core.fno_signals import attach_fno_signals
from backend.core.futures_continuous import build_continuous_futures
from backend.core.options_backtest import run_straddle_backtest, StraddleParams, STRATEGIES
from backend.core.options_spreads import run_spread_backtest, SpreadParams, SPREAD_STRATEGIES
from backend.core.markov_chain import attach_markov_signals
from backend.core.orb_backtest import run_orb_backtest, ORBParams, DIRECTIONS
from backend.core.backtest_engine import prepare_frame
from backend.core import grid_search as gs
import pandas as pd


def _load_price_df(db, sym: str, from_date: str, to_date: str, data_source: str) -> pd.DataFrame:
    """data_source: 'cash' (stock_ohlcv) or 'futures' (continuous roll-adjusted near-month series)."""
    if data_source == "futures":
        return build_continuous_futures(sym, from_date, to_date)
    return db.execute(
        """SELECT date, open, high, low, close, volume FROM stock_ohlcv
           WHERE symbol = ? AND date BETWEEN ? AND ? ORDER BY date""",
        [sym, from_date, to_date],
    ).df()


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
    data_source: Literal["cash", "futures"] = "cash"


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
        df = _load_price_df(db, sym, req.from_date, req.to_date, req.data_source)
        if len(df) < 30:
            continue
        df = attach_fno_signals(df, sym, req.from_date, req.to_date)
        df = attach_markov_signals(df, sym, req.from_date, req.to_date)
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
    data_source: Literal["cash", "futures"] = "cash"


@router.post("/run-matrix")
def run_matrix(req: MatrixRequest):
    # Pre-fetch all OHLCV data on the main thread (DuckDB is thread-local)
    db = get_db()
    ohlcv: dict[str, pd.DataFrame] = {}
    for sym in req.symbols:
        s = sym.upper()
        df = _load_price_df(db, s, req.from_date, req.to_date, req.data_source)
        if len(df) >= 30:
            ohlcv[s] = attach_markov_signals(attach_fno_signals(df, s, req.from_date, req.to_date), s, req.from_date, req.to_date)

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


def _build_matrix_result(matrix: dict, algo_params: list, ohlcv: dict) -> dict:
    """Shared aggregate builder for both streaming and non-streaming endpoints."""
    algo_label_map = {algo_id: label for algo_id, label, _ in algo_params}

    per_algo: dict = {}
    for algo_id, label, _ in algo_params:
        trades = [t for sym in matrix for t in matrix[sym].get(algo_id, {}).get("trades", [])]
        total = len(trades)
        per_algo[algo_id] = {
            "label": label,
            "total_trades": total,
            "win_rate_pct": round(len([t for t in trades if t["pnl"] > 0]) / total * 100, 1) if total else 0.0,
            "total_pnl": round(sum(t["pnl"] for t in trades), 2),
            "avg_pnl_pct": round(sum(t["pnl_pct"] for t in trades) / total, 2) if total else 0.0,
        }

    per_symbol: dict = {}
    for sym in matrix:
        trades = [t for algo_id in matrix[sym] for t in matrix[sym][algo_id].get("trades", [])]
        total = len(trades)
        per_symbol[sym] = {
            "total_trades": total,
            "win_rate_pct": round(len([t for t in trades if t["pnl"] > 0]) / total * 100, 1) if total else 0.0,
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
        "best_combo":  {"symbol": best_key[0],  "algo_id": best_key[1],  "win_rate_pct": _wr(combos_with_trades[best_key]["trades"]),  "total_pnl": round(combos_with_trades[best_key]["pnl"],  2)} if best_key  else None,
        "worst_combo": {"symbol": worst_key[0], "algo_id": worst_key[1], "win_rate_pct": _wr(combos_with_trades[worst_key]["trades"]), "total_pnl": round(combos_with_trades[worst_key]["pnl"], 2)} if worst_key else None,
    }

    return {"matrix": matrix, "per_algo": per_algo, "per_symbol": per_symbol, "aggregate": aggregate}


@router.post("/run-matrix-stream")
def run_matrix_stream(req: MatrixRequest):
    """SSE endpoint — streams progress events then final result."""
    db = get_db()
    ohlcv: dict[str, pd.DataFrame] = {}
    for sym in req.symbols:
        s = sym.upper()
        df = _load_price_df(db, s, req.from_date, req.to_date, req.data_source)
        if len(df) >= 30:
            ohlcv[s] = attach_markov_signals(attach_fno_signals(df, s, req.from_date, req.to_date), s, req.from_date, req.to_date)

    if not ohlcv:
        raise HTTPException(400, "No data found for any symbol in the given date range.")

    algo_params: list[tuple[str, str, BacktestParamsV2]] = []
    for algo in req.algos:
        if not algo.entry_conditions:
            raise HTTPException(400, f"Algo '{algo.label}' has no entry conditions")
        entry_rows = [ConditionRow(left=c.left, operator=c.operator, right=c.right) for c in algo.entry_conditions]
        exit_rows  = [ConditionRow(left=c.left, operator=c.operator, right=c.right) for c in algo.exit_conditions]
        params = BacktestParamsV2(
            entry_conditions=entry_rows, exit_conditions=exit_rows,
            target_pct=algo.target_pct, sl_pct=algo.sl_pct, max_bars=algo.max_bars,
            capital_per_trade=req.capital_per_trade, timeframe=req.timeframe,
        )
        algo_params.append((algo.id, algo.label, params))

    pairs = [(sym, algo_id, label, params) for sym in ohlcv for algo_id, label, params in algo_params]
    total = len(pairs)

    def run_pair(sym: str, df: pd.DataFrame, params: BacktestParamsV2) -> dict:
        try:
            return run_backtest_v2(df, params)
        except Exception:
            return {"trades": [], "stats": {"total_trades": 0, "win_rate_pct": 0.0, "total_pnl": 0.0, "avg_pnl_pct": 0.0}, "ohlcv": []}

    def generate():
        matrix: dict[str, dict[str, dict]] = {sym: {} for sym in ohlcv}
        done = 0
        with ThreadPoolExecutor(max_workers=min(total, 32)) as pool:
            futures = {
                pool.submit(run_pair, sym, ohlcv[sym], params): (sym, algo_id)
                for sym, algo_id, label, params in pairs
            }
            for future in as_completed(futures):
                sym, algo_id = futures[future]
                matrix[sym][algo_id] = future.result()
                done += 1
                yield f"data: {json.dumps({'done': done, 'total': total})}\n\n"

        result = _build_matrix_result(matrix, algo_params, ohlcv)
        yield f"data: {json.dumps({'done': total, 'total': total, 'result': result})}\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"X-Accel-Buffering": "no", "Cache-Control": "no-cache"},
    )


# ── Straddle / strangle backtester ──────────────────────────────────────────

class StraddleRequest(BaseModel):
    symbol: str
    from_date: str
    to_date: str
    strategy: Literal["short_straddle", "long_straddle", "short_strangle", "long_strangle"] = "short_straddle"
    strangle_width_pct: float = Field(2.0, gt=0, le=20)
    entry_dte: int = Field(7, ge=1, le=30)
    target_pct: float = Field(30.0, gt=0)
    sl_pct: float = Field(50.0, gt=0)
    force_exit_dte: int = Field(0, ge=0, le=5)
    capital_per_trade: float = Field(50_000.0, gt=0)
    data_source: Literal["cash", "futures"] = "cash"


@router.get("/straddle-strategies")
def get_straddle_strategies():
    return {"strategies": list(STRATEGIES)}


@router.post("/run-straddle")
def run_straddle(req: StraddleRequest):
    params = StraddleParams(
        strategy=req.strategy,
        strangle_width_pct=req.strangle_width_pct,
        entry_dte=req.entry_dte,
        target_pct=req.target_pct,
        sl_pct=req.sl_pct,
        force_exit_dte=req.force_exit_dte,
        capital_per_trade=req.capital_per_trade,
        data_source=req.data_source,
    )
    try:
        result = run_straddle_backtest(req.symbol, req.from_date, req.to_date, params)
    except Exception as e:
        raise HTTPException(500, str(e))

    if result["stats"]["total_trades"] == 0:
        raise HTTPException(
            400,
            f"No {req.strategy.replace('_', ' ')} cycles found for {req.symbol.upper()} in this range — "
            "fetch its option chain data across at least one full expiry cycle on the F&O page first."
        )
    return result


# ── Options spreads (Phase 4) ───────────────────────────────────────────────

class SpreadRequest(BaseModel):
    symbol: str
    from_date: str
    to_date: str
    strategy: Literal["bull_call_spread", "bear_put_spread", "iron_condor"] = "bull_call_spread"
    long_offset_pct: float = Field(0.0, ge=0, le=20)
    short_offset_pct: float = Field(3.0, gt=0, le=20)
    condor_call_short_pct: float = Field(3.0, gt=0, le=20)
    condor_call_long_pct: float = Field(6.0, gt=0, le=30)
    condor_put_short_pct: float = Field(3.0, gt=0, le=20)
    condor_put_long_pct: float = Field(6.0, gt=0, le=30)
    entry_dte: int = Field(20, ge=1, le=45)
    target_pct: float = Field(50.0, gt=0, le=100)
    sl_pct: float = Field(100.0, gt=0)
    force_exit_dte: int = Field(1, ge=0, le=5)
    capital_per_trade: float = Field(50_000.0, gt=0)
    data_source: Literal["cash", "futures"] = "cash"


@router.get("/spread-strategies")
def get_spread_strategies():
    return {"strategies": list(SPREAD_STRATEGIES)}


@router.post("/run-spread")
def run_spread(req: SpreadRequest):
    params = SpreadParams(
        strategy=req.strategy,
        long_offset_pct=req.long_offset_pct,
        short_offset_pct=req.short_offset_pct,
        condor_call_short_pct=req.condor_call_short_pct,
        condor_call_long_pct=req.condor_call_long_pct,
        condor_put_short_pct=req.condor_put_short_pct,
        condor_put_long_pct=req.condor_put_long_pct,
        entry_dte=req.entry_dte,
        target_pct=req.target_pct,
        sl_pct=req.sl_pct,
        force_exit_dte=req.force_exit_dte,
        capital_per_trade=req.capital_per_trade,
        data_source=req.data_source,
    )
    try:
        result = run_spread_backtest(req.symbol, req.from_date, req.to_date, params)
    except Exception as e:
        raise HTTPException(500, str(e))

    if result["stats"]["total_trades"] == 0:
        raise HTTPException(
            400,
            f"No {req.strategy.replace('_', ' ')} cycles found for {req.symbol.upper()} in this range — "
            "fetch its option chain data across at least one full expiry cycle on the F&O page first."
        )
    return result


# ── Opening Range Breakout (Phase 10) ───────────────────────────────────────

class ORBRequest(BaseModel):
    symbol: str
    from_date: str
    to_date: str
    or_minutes: int = Field(15, ge=1, le=120)
    direction: Literal["long_only", "short_only", "both"] = "long_only"
    target_pct: float = Field(1.0, gt=0)
    sl_pct: float = Field(0.5, gt=0)
    force_exit_time: str = "15:20"
    capital_per_trade: float = Field(50_000.0, gt=0)
    interval: str = "5m"


@router.get("/orb-directions")
def get_orb_directions():
    return {"directions": list(DIRECTIONS)}


@router.post("/run-orb")
def run_orb(req: ORBRequest):
    params = ORBParams(
        or_minutes=req.or_minutes,
        direction=req.direction,
        target_pct=req.target_pct,
        sl_pct=req.sl_pct,
        force_exit_time=req.force_exit_time,
        capital_per_trade=req.capital_per_trade,
        interval=req.interval,
    )
    try:
        result = run_orb_backtest(req.symbol, req.from_date, req.to_date, params)
    except Exception as e:
        raise HTTPException(500, str(e))

    if result["stats"]["total_trades"] == 0:
        raise HTTPException(
            400,
            f"No ORB trades found for {req.symbol.upper()} in this range — "
            "fetch intraday data for this symbol/interval on the ORB page first."
        )
    return result


# ── Grid Search (hyperparameter sweep over rule-based strategies) ────────────

class SweepDimIn(BaseModel):
    kind: Literal["threshold", "indicator_period"]
    condition_index: int = 0
    column: str = ""
    values: list[float] = Field(..., min_length=1, max_length=gs.MAX_VALUES_PER_DIM)


class GridSearchRequest(BaseModel):
    symbols: list[str] = Field(..., min_length=1, max_length=gs.MAX_SYMBOLS)
    from_date: str
    to_date: str
    entry_conditions: list[ConditionRowIn] = Field(..., min_length=1)
    exit_conditions: list[ConditionRowIn] = []
    sweep_dims: list[SweepDimIn] = Field(..., min_length=1, max_length=gs.MAX_DIMS)
    target_pct: float = 15.0
    sl_pct: float = 7.0
    max_bars: int = Field(30, ge=1, le=252)
    capital_per_trade: float = Field(10_000.0, gt=0)
    timeframe: str = "1D"
    data_source: Literal["cash", "futures"] = "cash"
    train_ratio: float = Field(0.7, ge=0.5, le=0.9)
    top_n: int = Field(20, ge=1, le=gs.MAX_TOP_N)


@router.get("/grid-sweepables")
def get_grid_sweepables():
    return {
        "period_columns": gs.SWEEPABLE_PERIOD_COLUMNS,
        "max_combos": gs.MAX_COMBOS,
        "max_dims": gs.MAX_DIMS,
        "max_values_per_dim": gs.MAX_VALUES_PER_DIM,
        "max_symbols": gs.MAX_SYMBOLS,
    }


@router.post("/run-grid-search")
def run_grid_search(req: GridSearchRequest):
    """SSE endpoint — streams prep/train/test progress then the ranked leaderboard."""
    entry_rows = [ConditionRow(left=c.left, operator=c.operator, right=c.right) for c in req.entry_conditions]
    exit_rows  = [ConditionRow(left=c.left, operator=c.operator, right=c.right) for c in req.exit_conditions]
    dims = [gs.SweepDim(kind=d.kind, condition_index=d.condition_index, column=d.column, values=d.values)
            for d in req.sweep_dims]

    try:
        combos = gs.expand_combos(entry_rows, dims)
    except ValueError as e:
        raise HTTPException(400, str(e))

    union_extra = sorted({c for combo in combos for c in combo.extra_indicators})

    # Pre-fetch OHLCV on the main thread (DuckDB is thread-local), attach signals.
    db = get_db()
    raw: dict[str, pd.DataFrame] = {}
    for sym in req.symbols:
        s = sym.upper()
        df = _load_price_df(db, s, req.from_date, req.to_date, req.data_source)
        if len(df) >= 60:
            raw[s] = attach_markov_signals(
                attach_fno_signals(df, s, req.from_date, req.to_date), s, req.from_date, req.to_date
            )
    if not raw:
        raise HTTPException(400, "No data (need ≥60 bars/symbol). Sync data first via the Screener.")

    base_params = BacktestParamsV2(
        entry_conditions=entry_rows, exit_conditions=exit_rows,
        target_pct=req.target_pct, sl_pct=req.sl_pct, max_bars=req.max_bars,
        capital_per_trade=req.capital_per_trade, timeframe=req.timeframe,
    )

    def generate():
        # Phase 1: prepare + split each symbol once (shared across all combos).
        train_frames: dict[str, pd.DataFrame] = {}
        test_frames: dict[str, pd.DataFrame] = {}
        boundaries: dict[str, str] = {}
        n_sym = len(raw)
        for i, (sym, df) in enumerate(raw.items(), 1):
            try:
                prepared = prepare_frame(df, req.timeframe, union_extra)
                tr, te, bnd = gs.split_frame(prepared, req.train_ratio)
                train_frames[sym] = tr
                test_frames[sym] = te
                if bnd:
                    boundaries[sym] = bnd
            except Exception:
                pass
            yield f"data: {json.dumps({'phase': 'prep', 'done': i, 'total': n_sym})}\n\n"

        # Phase 2: evaluate every combo on TRAIN (threaded, pure compute).
        n_combos = len(combos)
        train_stats: dict[str, dict] = {}
        done = 0
        with ThreadPoolExecutor(max_workers=min(n_combos, 16)) as pool:
            futures = {pool.submit(gs.evaluate_combo, train_frames, combo, base_params): combo
                       for combo in combos}
            for future in as_completed(futures):
                combo = futures[future]
                train_stats[combo.combo_id] = future.result()
                done += 1
                yield f"data: {json.dumps({'phase': 'train', 'done': done, 'total': n_combos})}\n\n"

        # Rank by train PnL (tiebreak win rate); validate top-N on TEST.
        ranked = sorted(
            combos,
            key=lambda c: (train_stats[c.combo_id]["total_pnl"], train_stats[c.combo_id]["win_rate_pct"]),
            reverse=True,
        )
        top = ranked[: req.top_n]
        test_stats: dict[str, dict] = {}
        for j, combo in enumerate(top, 1):
            test_stats[combo.combo_id] = gs.evaluate_combo(test_frames, combo, base_params)
            yield f"data: {json.dumps({'phase': 'test', 'done': j, 'total': len(top)})}\n\n"

        leaderboard = []
        for combo in ranked:
            tr = train_stats[combo.combo_id]
            te = test_stats.get(combo.combo_id)
            gap = None
            if te is not None:
                gap = {
                    "win_rate_gap": round(tr["win_rate_pct"] - te["win_rate_pct"], 1),
                    "avg_pnl_gap": round(tr["avg_pnl_pct"] - te["avg_pnl_pct"], 2),
                }
            leaderboard.append({
                "combo_id": combo.combo_id,
                "params": combo.params,
                "conditions": [{"left": c.left, "operator": c.operator, "right": c.right} for c in combo.conditions],
                "train": tr,
                "test": te,
                "gap": gap,
            })

        result = {
            "total_combos": n_combos,
            "symbols_used": list(raw.keys()),
            "split": {"train_ratio": req.train_ratio, "boundary_dates": boundaries},
            "leaderboard": leaderboard,
        }
        yield f"data: {json.dumps({'phase': 'done', 'result': result})}\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"X-Accel-Buffering": "no", "Cache-Control": "no-cache"},
    )
