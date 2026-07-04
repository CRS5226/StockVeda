"""
Index fund construction / replication (Phase 6b) — computed-proxy weights, not official
NSE numbers. niftyindices.com (the authoritative source for constituent weights) is
unreachable from this VPS (confirmed: TLS handshake completes, HTTP response times out
with zero bytes — same Akamai-style blocking as nseindia.com's live API), so weights are
approximated as free-float market cap: latest close (stock_ohlcv) x shares outstanding
(yfinance) x (1 - promoter_pct/100) (shareholding table), normalized to sum to 100%.
Always flagged with source="computed_proxy" in the API response.
"""

import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from datetime import date
from typing import Literal

import pandas as pd
import yfinance as yf

from backend.core.screener_universe import NIFTY_50, NIFTY_100, NIFTY_NEXT_50
from backend.db.connection import get_db

INDEX_UNIVERSE: dict[str, list[str]] = {
    "NIFTY 50": NIFTY_50,
    "NIFTY 100": NIFTY_100,
    "NIFTY NEXT 50": NIFTY_NEXT_50,
}

_WEIGHTS_CACHE: dict[str, tuple[float, list[dict]]] = {}
_CACHE_TTL_SECONDS = 12 * 3600


@dataclass
class ConstituentWeight:
    symbol: str
    weight_pct: float
    market_cap_cr: float | None = None
    source: Literal["computed_proxy"] = "computed_proxy"


def _latest_close(symbol: str) -> float | None:
    db = get_db()
    row = db.execute(
        "SELECT close FROM stock_ohlcv WHERE symbol = ? ORDER BY date DESC LIMIT 1", [symbol]
    ).fetchone()
    return float(row[0]) if row and row[0] else None


def _latest_promoter_pct(symbol: str) -> float | None:
    db = get_db()
    row = db.execute(
        "SELECT promoter_pct FROM shareholding WHERE symbol = ? AND promoter_pct IS NOT NULL ORDER BY period DESC LIMIT 1",
        [symbol],
    ).fetchone()
    return float(row[0]) if row and row[0] is not None else None


def _shares_outstanding(symbol: str) -> float | None:
    try:
        info = yf.Ticker(f"{symbol}.NS").fast_info
        so = info.get("shares_outstanding") if hasattr(info, "get") else None
        if so:
            return float(so)
    except Exception:
        pass
    try:
        info = yf.Ticker(f"{symbol}.NS").info
        so = info.get("sharesOutstanding")
        return float(so) if so else None
    except Exception:
        return None


def _constituent_market_cap(symbol: str) -> dict | None:
    close = _latest_close(symbol)
    shares = _shares_outstanding(symbol)
    if close is None or shares is None:
        return None
    promoter_pct = _latest_promoter_pct(symbol)
    free_float_frac = 1 - (promoter_pct / 100 if promoter_pct is not None else 0.0)
    free_float_frac = max(free_float_frac, 0.05)  # floor so a stale/missing promoter% never zeroes a constituent out
    market_cap_cr = close * shares * free_float_frac / 1e7
    return {"symbol": symbol, "market_cap_cr": market_cap_cr}


def get_index_weights(index_name: str, force_refresh: bool = False) -> list[ConstituentWeight]:
    key = index_name.upper()
    now = time.time()
    if not force_refresh and key in _WEIGHTS_CACHE:
        cached_at, rows = _WEIGHTS_CACHE[key]
        if now - cached_at < _CACHE_TTL_SECONDS:
            return [ConstituentWeight(**r) for r in rows]

    symbols = INDEX_UNIVERSE.get(key)
    if symbols is None:
        return []

    caps: list[dict] = []
    with ThreadPoolExecutor(max_workers=10) as pool:
        futures = {pool.submit(_constituent_market_cap, s): s for s in symbols}
        for fut in as_completed(futures):
            result = fut.result()
            if result is not None:
                caps.append(result)

    total = sum(c["market_cap_cr"] for c in caps)
    if total <= 0:
        return []

    weights = [
        ConstituentWeight(
            symbol=c["symbol"],
            weight_pct=round(c["market_cap_cr"] / total * 100, 4),
            market_cap_cr=round(c["market_cap_cr"], 2),
        )
        for c in caps
    ]
    weights.sort(key=lambda w: w.weight_pct, reverse=True)
    _WEIGHTS_CACHE[key] = (now, [w.__dict__ for w in weights])
    return weights


@dataclass
class ReplicationParams:
    index_name: str = "NIFTY 50"
    capital: float = 1_000_000.0
    rebalance_frequency: Literal["none", "quarterly"] = "none"
    from_date: str = field(default_factory=lambda: (date.today().replace(year=date.today().year - 1)).isoformat())
    to_date: str = field(default_factory=lambda: date.today().isoformat())


def _index_ohlcv_close(index_name: str, from_date: str, to_date: str) -> pd.DataFrame:
    db = get_db()
    df = db.execute(
        "SELECT date, close FROM index_ohlcv WHERE index_name = ? AND date BETWEEN ? AND ? ORDER BY date",
        [index_name, from_date, to_date],
    ).df()
    if not df.empty:
        df["date"] = df["date"].astype(str)
    return df


def compute_tracking_error(portfolio_returns: pd.Series, index_returns: pd.Series) -> dict:
    diff = portfolio_returns - index_returns
    tracking_error_annualized = float(diff.std() * (252 ** 0.5) * 100) if len(diff) > 1 else None
    correlation = float(portfolio_returns.corr(index_returns)) if len(portfolio_returns) > 1 else None
    cumulative_drift_pct = float(
        ((1 + portfolio_returns).prod() - (1 + index_returns).prod()) * 100
    ) if len(diff) > 0 else None
    return {
        "tracking_error_annualized_pct": round(tracking_error_annualized, 4) if tracking_error_annualized is not None else None,
        "correlation": round(correlation, 4) if correlation is not None else None,
        "cumulative_drift_pct": round(cumulative_drift_pct, 4) if cumulative_drift_pct is not None else None,
    }


def build_replicating_portfolio(params: ReplicationParams) -> dict:
    weights = get_index_weights(params.index_name)
    if not weights:
        return {"error": f"Could not compute weights for {params.index_name}"}

    db = get_db()
    rows = []
    total_allocated = 0.0
    for w in weights:
        alloc = params.capital * w.weight_pct / 100
        close = _latest_close(w.symbol)
        if close is None or close <= 0:
            continue
        shares = int(alloc // close)
        actual_alloc = shares * close
        total_allocated += actual_alloc
        rows.append({
            "symbol": w.symbol,
            "weight_pct": w.weight_pct,
            "target_allocation": round(alloc, 2),
            "price": close,
            "shares": shares,
            "actual_allocation": round(actual_alloc, 2),
            "source": w.source,
        })

    # Portfolio value path: hold whole-share quantities fixed (rebalance_frequency="none"), mark to market daily.
    # Only symbols with near-complete history over the window are used here — many constituents in this DB
    # only have a handful of recently-synced days, and outer-joining + forward-filling those in would fabricate
    # a fake return out of missing data (the value jumping the moment a sparse symbol's price first appears).
    index_df = _index_ohlcv_close(params.index_name, params.from_date, params.to_date)
    expected_days = max(len(index_df), 1)
    min_coverage = 0.9

    symbols_in_portfolio = [r["symbol"] for r in rows]
    price_frames = []
    excluded_symbols = []
    for sym in symbols_in_portfolio:
        df = db.execute(
            "SELECT date, close FROM stock_ohlcv WHERE symbol = ? AND date BETWEEN ? AND ? ORDER BY date",
            [sym, params.from_date, params.to_date],
        ).df()
        if len(df) < expected_days * min_coverage:
            excluded_symbols.append(sym)
            continue
        df["date"] = df["date"].astype(str)
        df = df.rename(columns={"close": sym}).set_index("date")
        price_frames.append(df)

    value_path: list[dict] = []
    tracking = {}
    if price_frames:
        merged = pd.concat(price_frames, axis=1, join="inner")
        shares_map = {r["symbol"]: r["shares"] for r in rows}
        portfolio_value = sum(merged[sym] * shares_map.get(sym, 0) for sym in merged.columns)
        value_path = [{"date": d, "value": round(float(v), 2)} for d, v in portfolio_value.items()]

        if not index_df.empty and len(portfolio_value) > 1:
            port_returns = portfolio_value.pct_change().dropna()
            index_series = index_df.set_index("date")["close"]
            aligned = pd.concat([port_returns, index_series.pct_change()], axis=1, join="inner").dropna()
            if not aligned.empty:
                tracking = compute_tracking_error(aligned.iloc[:, 0], aligned.iloc[:, 1])

    return {
        "index_name": params.index_name,
        "capital": params.capital,
        "total_allocated": round(total_allocated, 2),
        "cash_remaining": round(params.capital - total_allocated, 2),
        "constituents": rows,
        "value_path": value_path,
        "value_path_coverage": {
            "included_symbols": len(price_frames),
            "excluded_symbols": excluded_symbols,
            "note": (
                "value_path/tracking_error only include constituents with >= 90% OHLCV coverage over the "
                "window, to avoid fabricating returns from symbols with sparse history."
            ) if excluded_symbols else None,
        },
        "tracking_error": tracking,
        "source": "computed_proxy",
    }
