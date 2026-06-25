from fastapi import APIRouter, HTTPException, Query
from backend.db.connection import get_db
from backend.core.patterns import detect_patterns
from backend.core.outlook import compute_outlook
import pandas as pd

router = APIRouter(prefix="/api/v1", tags=["analysis"])


def _fetch_ohlcv(symbol: str) -> pd.DataFrame:
    db = get_db()
    return db.execute(
        "SELECT date, open, high, low, close, volume FROM stock_ohlcv WHERE symbol = ? ORDER BY date",
        [symbol.upper()],
    ).df()


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
