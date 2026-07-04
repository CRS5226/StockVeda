from datetime import date, timedelta
from fastapi import APIRouter, HTTPException, Query
from backend.db.connection import get_db
from backend.core.patterns import detect_patterns
from backend.core.outlook import compute_outlook
from backend.core.markov_chain import run_markov_analysis, MarkovParams
import pandas as pd

router = APIRouter(prefix="/api/v1", tags=["analysis"])


def _fetch_ohlcv(symbol: str) -> pd.DataFrame:
    db = get_db()
    return db.execute(
        "SELECT date, open, high, low, close, volume FROM stock_ohlcv WHERE symbol = ? ORDER BY date",
        [symbol.upper()],
    ).df()


@router.get("/candle-patterns/index/{index_name}")
def get_index_candle_patterns(index_name: str, limit: int = Query(500, ge=1, le=5000)):
    """Return TA-Lib candle pattern hits for a market index."""
    db = get_db()
    df = db.execute(
        "SELECT date, open, high, low, close FROM index_ohlcv WHERE index_name = ? ORDER BY date",
        [index_name.upper()],
    ).df()
    if df.empty:
        df = db.execute(
            "SELECT date, open, high, low, close FROM index_ohlcv WHERE UPPER(index_name) = ? ORDER BY date",
            [index_name.upper()],
        ).df()
    if df.empty:
        raise HTTPException(404, f"No OHLCV data for index {index_name}")
    df["volume"] = 0
    if len(df) > limit:
        df = df.iloc[-limit:].reset_index(drop=True)
    return detect_patterns(df)


@router.get("/candle-patterns/{symbol}")
def get_candle_patterns(symbol: str, limit: int = Query(500, ge=1, le=5000)):
    """Return TA-Lib candle pattern hits for a symbol (most recent `limit` bars)."""
    df = _fetch_ohlcv(symbol)
    if df.empty:
        raise HTTPException(404, f"No OHLCV data for {symbol}")
    if len(df) > limit:
        df = df.iloc[-limit:].reset_index(drop=True)
    return detect_patterns(df)


@router.get("/outlook/{symbol}")
def get_outlook(symbol: str):
    """Return trend outlook: indicator confluence score + historical pattern win-rates."""
    df = _fetch_ohlcv(symbol)
    if df.empty:
        raise HTTPException(404, f"No OHLCV data for {symbol}")
    result = compute_outlook(df)
    if "error" in result:
        # Return a neutral skeleton rather than a 400 so the UI always shows something
        return {
            "score": 0, "label": "Neutral",
            "components": {"rsi": 0, "macd": 0, "sma20": 0, "sma50": 0, "volume": 0, "patterns": 0},
            "indicators": {"rsi": 50.0, "macd_hist": None, "sma20_diff_pct": None, "close": float(df["close"].iloc[-1])},
            "recent_patterns": [],
            "pattern_stats": [],
            "_note": result["error"],
        }
    return result


@router.get("/markov/{symbol}")
def get_markov(
    symbol: str,
    from_date: str | None = Query(None, description="YYYY-MM-DD, defaults to 2 years ago"),
    to_date: str | None = Query(None, description="YYYY-MM-DD, defaults to today"),
    n_states: int = Query(3, ge=2, le=9),
    flat_band_pct: float = Query(0.5, gt=0),
    lookback_days: int = Query(252, ge=20, le=2000),
    horizon_days: int = Query(5, ge=1, le=30),
):
    """
    Markov chain snapshot: current state, transition matrix (estimated over the trailing
    lookback_days), forward-projected state probabilities, and the historical state
    timeline for charting. Not a backtest condition — see markov_p_up/markov_p_down/
    markov_confidence in the condition-builder indicator list for that.
    """
    td = to_date or date.today().isoformat()
    fd = from_date or (date.today() - timedelta(days=730)).isoformat()
    params = MarkovParams(n_states=n_states, flat_band_pct=flat_band_pct, lookback_days=lookback_days, horizon_days=horizon_days)
    result = run_markov_analysis(symbol, fd, td, params)
    if "error" in result:
        raise HTTPException(404, result["error"])
    return result
