"""Data for the stocks of one portfolio only: 60-minute candles, fundamentals and a ratio snapshot, all from Yahoo.

Runs as a background job started by the Health tab's sync button and polled for progress. Each step fetches only what is
missing or old, one symbol at a time with a pause between requests, and a failure on one symbol never stops the rest.
"""

import logging
import time
from datetime import date, datetime

import pandas as pd
import yfinance as yf

from backend.core.portfolio_data import hourly_days_needed, snapshot_row
from backend.core.spot_prices import yahoo_ticker
from backend.data_sync.base import log_sync, upsert_df
from backend.data_sync.sync_fundamentals import parse_financials
from backend.data_sync.sync_intraday import fetch_intraday_symbol

logger = logging.getLogger(__name__)

PAUSE_SECONDS = 0.6
FUNDAMENTALS_PAUSE_SECONDS = 1.0       # the fundamentals call makes several requests per stock
STEPS = (("hourly", "1-hour candles"), ("fundamentals", "Fundamentals"), ("ratios", "Valuation ratios"))
data_jobs: dict = {}

RATIO_COLUMNS = ["symbol", "as_of", "pe", "forward_pe", "pb", "roe_pct", "debt_to_equity", "profit_margin_pct", "revenue_growth_pct",
                 "earnings_growth_pct", "dividend_yield_pct", "market_cap", "ev_to_ebitda", "beta", "sector", "industry"]


def _remember(key: str, sym: str, found: bool, rows: int, today: date) -> None:
    """Note that this symbol was tried, and whether Yahoo had anything, so an empty answer is not asked for again at once."""
    log_sync(f"pdata:{key}:{sym}", "success" if found else "empty", rows, today)


def _step(job: dict, key: str) -> dict:
    return next(s for s in job["steps"] if s["key"] == key)


def _hourly(symbols: dict[str, datetime | None], today: date, step: dict) -> None:
    for sym in sorted(symbols):
        try:
            df = fetch_intraday_symbol(sym, "60m", hourly_days_needed(symbols[sym], today))
            if not df.empty:
                step["rows"] += upsert_df(df, "stock_intraday_ohlcv")
                step["updated"] += 1
            else:
                step["no_data"].append(sym)
            _remember("hourly", sym, not df.empty, len(df), today)
        except KeyError:
            # Yahoo has no trading-hours data for this symbol (some REITs and new listings): the same as no data
            step["no_data"].append(sym)
            _remember("hourly", sym, False, 0, today)
        except Exception:
            logger.exception("1-hour fetch failed for %s", sym)
            step["failed"].append(sym)
        step["done"] += 1
        time.sleep(PAUSE_SECONDS)


def _fundamentals(symbols: list[str], today: date, step: dict) -> None:
    for sym in sorted(symbols):
        try:
            t = yf.Ticker(yahoo_ticker(sym))
            rows = parse_financials(t, sym, "Q") + parse_financials(t, sym, "A")
            df = pd.DataFrame(rows).dropna(subset=["revenue", "pat"], how="all") if rows else pd.DataFrame()
            if not df.empty:
                step["rows"] += upsert_df(df, "stock_fundamentals")
                step["updated"] += 1
            else:
                step["no_data"].append(sym)
            _remember("fundamentals", sym, not df.empty, len(df), today)
        except Exception:
            logger.exception("Fundamentals fetch failed for %s", sym)
            step["failed"].append(sym)
        step["done"] += 1
        time.sleep(FUNDAMENTALS_PAUSE_SECONDS)


def _ratios(symbols: list[str], today: date, step: dict) -> None:
    for sym in sorted(symbols):
        try:
            info = yf.Ticker(yahoo_ticker(sym)).info or {}
            row = snapshot_row(sym, info, today)
            found = any(row[k] is not None for k in ("pe", "pb", "roe_pct", "market_cap"))
            if found:
                step["rows"] += upsert_df(pd.DataFrame([row])[RATIO_COLUMNS], "stock_ratios_snapshot")
                step["updated"] += 1
            else:
                step["no_data"].append(sym)
            _remember("ratios", sym, found, int(found), today)
        except Exception:
            logger.exception("Ratio fetch failed for %s", sym)
            step["failed"].append(sym)
        step["done"] += 1
        time.sleep(PAUSE_SECONDS)


def run_data_sync(job_id: str, hourly: dict[str, datetime | None], fundamentals: list[str], ratios: list[str], today: date) -> None:
    """Run the steps that have something to do, one after the other, updating `data_jobs[job_id]` as it goes."""
    job = data_jobs[job_id]
    job["status"] = "running"
    try:
        for key, work, runner in (("hourly", hourly, lambda s: _hourly(hourly, today, s)),
                                  ("fundamentals", fundamentals, lambda s: _fundamentals(fundamentals, today, s)),
                                  ("ratios", ratios, lambda s: _ratios(ratios, today, s))):
            if not work:
                continue
            step = _step(job, key)
            job["current"] = key
            step["status"] = "running"
            runner(step)
            step["status"] = "done"
        job["status"] = "done"
        job["current"] = None
    except Exception:
        logger.exception("Portfolio data sync failed")
        job.update({"status": "error", "error": "Data sync failed; see server logs"})


def new_job(pid: int, hourly: int, fundamentals: int, ratios: int) -> dict:
    """The progress record of a job that is about to run."""
    counts = {"hourly": hourly, "fundamentals": fundamentals, "ratios": ratios}
    return {"pid": pid, "status": "queued", "current": None, "error": None, "steps": [
        {"key": k, "label": label, "total": counts[k], "done": 0, "updated": 0, "rows": 0, "status": "pending" if counts[k] else "skipped",
         "no_data": [], "failed": []} for k, label in STEPS]}
