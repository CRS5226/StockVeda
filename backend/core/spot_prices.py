"""Daily candles of the underlying: an index (NIFTY, BANKNIFTY, ...) or a stock symbol."""

import pandas as pd

from backend.db.connection import get_db

INDEX_SYMBOLS = {"NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "SENSEX", "NIFTYBANK"}

# Short index names used across the app, mapped to the names stored in index_ohlcv.
IDX_NAME_MAP = {
    "NIFTY": "NIFTY 50", "BANKNIFTY": "NIFTY BANK", "NIFTYBANK": "NIFTY BANK",
    "FINNIFTY": "NIFTY FINANCIAL SERVICES", "MIDCPNIFTY": "NIFTY MIDCAP SELECT",
    "SENSEX": "SENSEX",
}


# Yahoo Finance tickers of the indices it has intraday data for. A stock is SYMBOL.NS; an index such as NIFTY
# has no .NS ticker, so asking for NIFTY.NS finds nothing.
YAHOO_INDEX_TICKERS = {"NIFTY": "^NSEI", "BANKNIFTY": "^NSEBANK", "NIFTYBANK": "^NSEBANK", "SENSEX": "^BSESN"}


def yahoo_ticker(symbol: str) -> str:
    """The Yahoo Finance ticker for a stock symbol or an index short name."""
    sym = symbol.strip().upper()
    return YAHOO_INDEX_TICKERS.get(sym, f"{sym}.NS")


def get_spot_ohlcv(sym: str, from_date: str, to_date: str) -> pd.DataFrame:
    """Full OHLC cash/index candles for charting and analysis (date as text)."""
    db = get_db()
    sym = sym.strip().upper()
    if sym in INDEX_SYMBOLS:
        df = db.execute(
            "SELECT date, open, high, low, close FROM index_ohlcv WHERE index_name = ? AND date BETWEEN ? AND ? ORDER BY date",
            [IDX_NAME_MAP.get(sym, sym), from_date, to_date],
        ).df()
    else:
        df = db.execute(
            "SELECT date, open, high, low, close FROM stock_ohlcv WHERE symbol = ? AND date BETWEEN ? AND ? ORDER BY date",
            [sym, from_date, to_date],
        ).df()
    if not df.empty:
        df["date"] = df["date"].astype(str)
    return df
