"""Correlated stocks and same-industry peers, from our own daily closes.

The maths works on a wide frame of closes (dates x symbols) so it can be tested
without a database; `connections_for` loads that frame with one SQL query.
"""

import pandas as pd

from backend.db.connection import get_db

DEFAULT_WINDOW = 120
MIN_WINDOW, MAX_WINDOW = 30, 500
LOOKBACK_DAYS = 63            # enough history for the 3-month return
MAX_CANDIDATES = 1000         # most traded symbols considered besides the target and its peers
MIN_COVERAGE = 0.8            # a symbol needs closes on this share of the days to be ranked
MAX_PEERS = 12
TRADING_DAYS_1M, TRADING_DAYS_3M = 21, 63


def daily_returns(closes: pd.DataFrame) -> pd.DataFrame:
    """Day-on-day returns; gaps are not filled, so a missing close does not create a fake return."""
    return closes.pct_change(fill_method=None)


def correlation_with(returns: pd.DataFrame, target: str, window: int, min_coverage: float = MIN_COVERAGE) -> pd.Series:
    """Pearson correlation of every other symbol's returns with the target over the last `window` days.

    Symbols with too few overlapping days are dropped rather than ranked on a handful of points.
    """
    if target not in returns.columns:
        return pd.Series(dtype=float)
    recent = returns.tail(window)
    others = recent.drop(columns=[target])
    corr = others.corrwith(recent[target])
    # Days on which both the symbol and the target have a return, not just the symbol alone.
    overlap = others.notna().mul(recent[target].notna(), axis=0).sum()
    return corr[overlap >= int(window * min_coverage)].dropna()


def rank_correlated(corr: pd.Series, top_n: int) -> tuple[pd.Series, pd.Series]:
    """The top_n most positively and most negatively correlated symbols."""
    ordered = corr.sort_values(ascending=False)
    positive = ordered[ordered > 0].head(top_n)
    negative = ordered[ordered < 0].sort_values().head(top_n)
    return positive, negative


def period_return(closes: pd.DataFrame, symbol: str, days: int) -> float | None:
    """Percent change of the last close against the close `days` trading days earlier."""
    if symbol not in closes.columns:
        return None
    series = closes[symbol].dropna()
    if len(series) <= days:
        return None
    return round(float(series.iloc[-1] / series.iloc[-1 - days] - 1) * 100, 2)


def beta(stock_returns: pd.Series, index_returns: pd.Series) -> float | None:
    """Slope of the stock's returns on the index's returns, on the days both exist."""
    both = pd.concat([stock_returns, index_returns], axis=1, keys=["s", "i"]).dropna()
    if len(both) < 20 or both["i"].var() == 0:
        return None
    return round(float(both["s"].cov(both["i"]) / both["i"].var()), 2)


def _load_closes(db, symbol: str, peers: list[str], days: int) -> pd.DataFrame:
    """Closes for the last `days` trading dates: the target, its peers and the most traded symbols."""
    dates = db.execute("SELECT DISTINCT date FROM stock_ohlcv ORDER BY date DESC LIMIT ?", [days]).fetchall()
    if not dates:
        return pd.DataFrame()
    since = dates[-1][0]
    df = db.execute("""
        WITH liquid AS (
            SELECT symbol FROM stock_ohlcv
            WHERE date >= ?
            GROUP BY symbol
            HAVING COUNT(*) >= ?
            ORDER BY SUM(close * volume) DESC NULLS LAST
            LIMIT ?
        )
        SELECT date, symbol, close FROM stock_ohlcv
        WHERE date >= ? AND (symbol = ? OR list_contains(?, symbol) OR symbol IN (SELECT symbol FROM liquid))
    """, [since, int(days * MIN_COVERAGE), MAX_CANDIDATES, since, symbol, peers]).df()
    return df.pivot(index="date", columns="symbol", values="close").sort_index()


def _index_returns(db, dates: pd.Index) -> pd.Series:
    df = db.execute(
        "SELECT date, close FROM index_ohlcv WHERE index_name = 'NIFTY 50' AND date >= ? ORDER BY date",
        [dates.min()],
    ).df()
    if df.empty:
        return pd.Series(dtype=float)
    return df.set_index("date")["close"].pct_change(fill_method=None)


def _info(db, symbols: list[str]) -> dict[str, dict]:
    """Name, sector, industry and latest PE (when a ratio snapshot exists) for the given symbols."""
    if not symbols:
        return {}
    rows = db.execute("""
        SELECT n.symbol, n.company_name, p.sector, p.industry,
               (SELECT r.pe FROM stock_ratios_snapshot r WHERE r.symbol = n.symbol ORDER BY r.as_of DESC LIMIT 1)
        FROM nse_symbols n
        LEFT JOIN company_profile p ON p.symbol = n.symbol
        WHERE list_contains(?, n.symbol)
    """, [symbols]).fetchall()
    return {r[0]: {"name": r[1], "sector": r[2], "industry": r[3], "pe": r[4]} for r in rows}


def _peer_symbols(db, symbol: str) -> tuple[dict | None, list[str]]:
    """The target's profile and the other symbols in its industry (its sector when it has no industry)."""
    row = db.execute(
        "SELECT sector, industry, city FROM company_profile WHERE symbol = ?", [symbol]
    ).fetchone()
    if not row:
        return None, []
    sector, industry, city = row
    column, value = ("industry", industry) if industry else ("sector", sector)
    if not value:
        return {"sector": sector, "industry": industry, "city": city}, []
    peers = db.execute(
        f"SELECT symbol FROM company_profile WHERE {column} = ? AND symbol <> ?", [value, symbol]
    ).fetchall()
    return {"sector": sector, "industry": industry, "city": city}, [p[0] for p in peers]


def _entry(closes: pd.DataFrame, info: dict, symbol: str, corr: float | None) -> dict:
    meta = info.get(symbol, {})
    return {
        "symbol": symbol,
        "name": meta.get("name"),
        "sector": meta.get("sector"),
        "industry": meta.get("industry"),
        "correlation": None if corr is None else round(float(corr), 3),
        "return_1m": period_return(closes, symbol, TRADING_DAYS_1M),
        "return_3m": period_return(closes, symbol, TRADING_DAYS_3M),
        "pe": meta.get("pe"),
    }


def connections_for(symbol: str, window: int = DEFAULT_WINDOW, top_n: int = 10) -> dict | None:
    """Correlated stocks and industry peers for one symbol; None when we have no prices for it."""
    symbol = symbol.strip().upper()
    window = min(max(window, MIN_WINDOW), MAX_WINDOW)
    db = get_db()
    profile, peers = _peer_symbols(db, symbol)
    closes = _load_closes(db, symbol, peers, max(window, LOOKBACK_DAYS) + 1)
    if closes.empty or symbol not in closes.columns:
        return None

    returns = daily_returns(closes)
    corr = correlation_with(returns, symbol, window)
    positive, negative = rank_correlated(corr, top_n)
    peer_corr = corr.reindex([p for p in peers if p in corr.index]).sort_values(ascending=False).head(MAX_PEERS)

    shown = list(dict.fromkeys([*positive.index, *negative.index, *peer_corr.index, symbol]))
    info = _info(db, shown)
    index_ret = _index_returns(db, closes.index)
    return {
        "symbol": symbol,
        "window": window,
        "as_of": str(closes.index.max()),
        "profile": profile,
        "beta_vs_nifty": beta(returns[symbol].tail(window), index_ret.tail(window)) if not index_ret.empty else None,
        "self": _entry(closes, info, symbol, None),
        "positive": [_entry(closes, info, s, c) for s, c in positive.items()],
        "negative": [_entry(closes, info, s, c) for s, c in negative.items()],
        "peers": [_entry(closes, info, s, c) for s, c in peer_corr.items()],
    }
