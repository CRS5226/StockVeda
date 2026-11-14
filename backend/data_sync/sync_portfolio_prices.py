"""Latest daily closes for the symbols of a portfolio (Yahoo) and the latest NAVs of its mutual funds (mfapi.in).

Runs as a background job started by the portfolio's Sync button and polled for progress, like the intraday fetch.
Only what is missing is fetched: each symbol from the day after its newest stored close, symbols one chunk at a time.
"""

import logging
import time
from datetime import date

import pandas as pd
import yfinance as yf

from backend.core.price_sync import fetch_start
from backend.core.spot_prices import yahoo_ticker
from backend.data_sync.base import upsert_df
from backend.data_sync.sync_mf_nav import backfill_nav
from backend.db.connection import get_db

logger = logging.getLogger(__name__)

CHUNK = 25                 # tickers per Yahoo request
PAUSE_SECONDS = 0.5        # between requests, so the source is never hammered
price_jobs: dict = {}


def closes_from_download(raw: pd.DataFrame, ticker_to_symbol: dict[str, str]) -> pd.DataFrame:
    """Rows shaped like `stock_ohlcv` (date, symbol, open, high, low, close, volume) from a yfinance download.

    Handles both the grouped layout (one block of columns per ticker) and the flat layout yfinance uses for one ticker.
    """
    if raw is None or raw.empty:
        return pd.DataFrame(columns=["date", "symbol", "open", "high", "low", "close", "volume"])
    frames = []
    for ticker, symbol in ticker_to_symbol.items():
        if isinstance(raw.columns, pd.MultiIndex):
            if ticker not in raw.columns.get_level_values(0):
                continue
            block = raw[ticker]
        else:
            block = raw
        block = block.rename(columns=str.lower)
        if "close" not in block.columns:
            continue
        block = block.dropna(subset=["close"]).copy()
        if block.empty:
            continue
        block["date"] = pd.to_datetime(block.index).tz_localize(None).date if getattr(block.index, "tz", None) is not None else pd.to_datetime(block.index).date
        block["symbol"] = symbol
        block["volume"] = block["volume"].fillna(0).astype("int64")
        frames.append(block[["date", "symbol", "open", "high", "low", "close", "volume"]])
    if not frames:
        return pd.DataFrame(columns=["date", "symbol", "open", "high", "low", "close", "volume"])
    return pd.concat(frames, ignore_index=True)


def fetch_closes(symbols: list[str], start: date) -> pd.DataFrame:
    """Download daily bars for the symbols from `start` in one request (Yahoo)."""
    ticker_to_symbol = {yahoo_ticker(s): s for s in symbols}
    raw = yf.download(" ".join(ticker_to_symbol), start=str(start), group_by="ticker", auto_adjust=False,
                      actions=False, progress=False, threads=False)
    return closes_from_download(raw, ticker_to_symbol)


def run_price_sync(job_id: str, symbols: dict[str, date | None], schemes: dict[str, tuple[str, str | None]], expected: date, today: date,
                   first_load_days: int = 30) -> None:
    """Fetch what is stale. `symbols` maps each stale symbol to its newest stored close date (None: start from
    `first_load_days` back), `schemes` each stale scheme code to (name, isin)."""
    job = price_jobs[job_id]
    job.update({"status": "running", "total": len(symbols) + len(schemes), "done": 0})
    try:
        names = sorted(symbols)
        for i in range(0, len(names), CHUNK):
            chunk = names[i:i + CHUNK]
            start = fetch_start([symbols[s] for s in chunk], today, first_load_days)
            try:
                df = fetch_closes(chunk, start)
            except Exception:
                logger.exception("Price fetch failed for %s", chunk)
                df = pd.DataFrame()
            df = df[df["date"] <= expected] if not df.empty else df     # never store a day that is still trading
            if not df.empty:
                job["prices"] += upsert_df(df[["date", "symbol", "open", "high", "low", "close", "volume"]], "stock_ohlcv")
            got = set(df["symbol"]) if not df.empty else set()
            job["updated_symbols"] += len(got)
            job["no_data"] += [s for s in chunk if s not in got and symbols[s] is None]   # never had a close and still none
            job["done"] += len(chunk)
            time.sleep(PAUSE_SECONDS)
        for code, (name, isin) in sorted(schemes.items()):
            if backfill_nav(code, name, isin):
                job["navs"] += 1
            job["done"] += 1
        job["status"] = "done"
    except Exception:
        logger.exception("Portfolio price sync failed")
        job.update({"status": "error", "error": "Price sync failed; see server logs"})
