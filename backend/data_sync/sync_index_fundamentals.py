"""
Historical Nifty PE / PB / Dividend Yield (Phase 7) — self-computed approximation, not the
official NSE number. niftyindices.com (the authoritative source) is unreachable from this
VPS (same Akamai-style block as nseindia.com's live API), so this is a weighted average of
each constituent's own P/E, P/B, and dividend yield (yfinance) using the same computed-proxy
free-float weights as Phase 6b's get_index_weights(). Written only into market_breadth's
nifty_pe/nifty_pb/nifty_div_yield columns via a targeted UPDATE/INSERT, never a blind
INSERT OR REPLACE, since that table's other columns (advances/declines/etc.) are populated
independently and must not be clobbered with NULLs.
"""

from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date

import yfinance as yf

from backend.core.index_replication import get_index_weights
from backend.data_sync.base import log_sync
from backend.db.connection import get_db

SOURCE_ID = "index_fundamentals"


def _constituent_ratios(symbol: str) -> dict | None:
    try:
        info = yf.Ticker(f"{symbol}.NS").info
    except Exception:
        return None
    pe = info.get("trailingPE")
    pb = info.get("priceToBook")
    div_yield = info.get("trailingAnnualDividendYield")
    if pe is None and pb is None and div_yield is None:
        return None
    return {
        "symbol": symbol,
        "pe": float(pe) if pe is not None else None,
        "pb": float(pb) if pb is not None else None,
        "div_yield_pct": float(div_yield) * 100 if div_yield is not None else None,
    }


def _weighted_avg(weights: dict[str, float], values: dict[str, float | None]) -> float | None:
    """Renormalizes over whichever constituents actually have a value for this metric."""
    usable = {sym: v for sym, v in values.items() if v is not None and sym in weights}
    total_weight = sum(weights[sym] for sym in usable)
    if total_weight <= 0:
        return None
    return sum(weights[sym] * usable[sym] for sym in usable) / total_weight


def compute_index_pe_pb(index_name: str, as_of_date: date) -> dict:
    weights_list = get_index_weights(index_name)
    if not weights_list:
        return {"error": f"Could not compute weights for {index_name}"}
    weights = {w.symbol: w.weight_pct for w in weights_list}

    ratios: list[dict] = []
    with ThreadPoolExecutor(max_workers=10) as pool:
        futures = {pool.submit(_constituent_ratios, sym): sym for sym in weights}
        for fut in as_completed(futures):
            r = fut.result()
            if r is not None:
                ratios.append(r)

    pe_vals = {r["symbol"]: r["pe"] for r in ratios}
    pb_vals = {r["symbol"]: r["pb"] for r in ratios}
    div_vals = {r["symbol"]: r["div_yield_pct"] for r in ratios}

    return {
        "index_name": index_name,
        "as_of_date": as_of_date.isoformat(),
        "nifty_pe": round(_weighted_avg(weights, pe_vals), 2) if _weighted_avg(weights, pe_vals) is not None else None,
        "nifty_pb": round(_weighted_avg(weights, pb_vals), 2) if _weighted_avg(weights, pb_vals) is not None else None,
        "nifty_div_yield": round(_weighted_avg(weights, div_vals), 2) if _weighted_avg(weights, div_vals) is not None else None,
        "n_constituents_used": len(ratios),
        "source": "computed_proxy",
    }


def run(index_name: str = "NIFTY 50") -> dict:
    today = date.today()
    result = compute_index_pe_pb(index_name, today)
    if "error" in result:
        log_sync(SOURCE_ID, "failed", 0, None, result["error"])
        return result

    db = get_db()
    db.execute("""
        INSERT INTO market_breadth (date, nifty_pe, nifty_pb, nifty_div_yield)
        VALUES (?, ?, ?, ?)
        ON CONFLICT (date) DO UPDATE SET
            nifty_pe = excluded.nifty_pe,
            nifty_pb = excluded.nifty_pb,
            nifty_div_yield = excluded.nifty_div_yield
    """, [today, result["nifty_pe"], result["nifty_pb"], result["nifty_div_yield"]])

    log_sync(SOURCE_ID, "ok", 1, today)
    return result
