"""
Stock routes: OHLCV, fundamentals, delivery, shareholding, corporate actions, insider trades.
"""

from datetime import date
from typing import Optional
from fastapi import APIRouter, HTTPException, Query
from backend.db.connection import get_db, df_to_records
from backend.core.indicators import add_indicators
import pandas as pd
import yfinance as yf

router = APIRouter(prefix="/stock", tags=["stock"])

_SECTOR_INDEX = {
    "Technology": "NIFTY IT",
    "Financial Services": "NIFTY BANK",
    "Consumer Staples": "NIFTY FMCG",
    "Healthcare": "NIFTY PHARMA",
    "Basic Materials": "NIFTY METAL",
    "Energy": "NIFTY ENERGY",
    "Real Estate": "NIFTY REALTY",
}


def _yfinance_ohlcv(symbol: str, from_date: Optional[date], to_date: Optional[date]) -> pd.DataFrame:
    """Fetch OHLCV from Yahoo Finance as fallback when DB is empty."""
    import yfinance as yf
    from datetime import timedelta
    start = (from_date or date(2020, 1, 1)).isoformat()
    end   = ((to_date or date.today()) + timedelta(days=1)).isoformat()
    t = yf.Ticker(f"{symbol}.NS")
    hist = t.history(start=start, end=end)
    if hist.empty:
        return pd.DataFrame()
    hist = hist.reset_index()
    hist["date"]   = pd.to_datetime(hist["Date"]).dt.date
    hist["symbol"] = symbol.upper()
    hist = hist.rename(columns={"Open": "open", "High": "high", "Low": "low",
                                 "Close": "close", "Volume": "volume"})
    return hist[["date", "symbol", "open", "high", "low", "close", "volume"]].dropna(subset=["close"])


def _cache_ohlcv(symbol: str, df: pd.DataFrame):
    """Persist yfinance data to stock_ohlcv so subsequent requests hit the DB."""
    from backend.data_sync.base import upsert_df
    to_store = df[["date", "symbol", "open", "high", "low", "close", "volume"]].copy()
    to_store["symbol"] = symbol.upper()
    upsert_df(to_store, "stock_ohlcv")


@router.get("/candles/{symbol}")
def get_candles(
    symbol: str,
    from_date: Optional[date] = Query(None),
    to_date:   Optional[date] = Query(None),
    indicators: bool = Query(False),
):
    """OHLCV for charting — DB first, yfinance fallback (cached to DB on first fetch)."""
    df = _fetch_ohlcv(symbol, from_date, to_date)
    if df.empty:
        df = _yfinance_ohlcv(symbol, from_date, to_date)
        if not df.empty:
            _cache_ohlcv(symbol, df)
            df = _fetch_ohlcv(symbol, from_date, to_date)
    if df.empty:
        raise HTTPException(404, f"No candle data for {symbol}")
    if indicators:
        df = add_indicators(df)
    return df_to_records(df)


def _fetch_ohlcv(symbol: str, from_date: Optional[date], to_date: Optional[date]) -> pd.DataFrame:
    db = get_db()
    sql = "SELECT date, open, high, low, close, volume FROM stock_ohlcv WHERE symbol = ?"
    params = [symbol.upper()]
    if from_date:
        sql += " AND date >= ?"
        params.append(from_date)
    if to_date:
        sql += " AND date <= ?"
        params.append(to_date)
    sql += " ORDER BY date"
    return db.execute(sql, params).df()


@router.get("/ohlcv/{symbol}")
def get_ohlcv(
    symbol: str,
    from_date: Optional[date] = Query(None),
    to_date:   Optional[date] = Query(None),
    indicators: bool = Query(False, description="Append technical indicators"),
):
    df = _fetch_ohlcv(symbol, from_date, to_date)
    if df.empty:
        raise HTTPException(404, f"No OHLCV data for {symbol}")
    if indicators:
        df = add_indicators(df)
    return df_to_records(df)


@router.get("/candle-stats")
def get_candle_stats(symbols: str = Query(..., description="Comma-separated symbols")):
    """Return candle count + date range for each requested symbol."""
    syms = [s.strip().upper() for s in symbols.split(",") if s.strip()]
    if not syms:
        return []
    db = get_db()
    rows = db.execute(
        """SELECT symbol, COUNT(*) as candles, MIN(date) as from_date, MAX(date) as to_date
           FROM stock_ohlcv
           WHERE symbol IN ({})
           GROUP BY symbol""".format(",".join("?" * len(syms))),
        syms,
    ).fetchall()
    result = {r[0]: {"symbol": r[0], "candles": r[1], "from_date": str(r[2]), "to_date": str(r[3])} for r in rows}
    return [result.get(s, {"symbol": s, "candles": 0, "from_date": None, "to_date": None}) for s in syms]


@router.get("/search")
def search_symbols(q: str = Query(..., min_length=1)):
    db = get_db()
    # Primary: nse_symbols table (always populated via seed_symbols)
    rows = db.execute(
        "SELECT symbol, company_name FROM nse_symbols WHERE symbol ILIKE ? ORDER BY symbol LIMIT 20",
        [f"{q.upper()}%"]
    ).fetchall()
    if rows:
        return [{"symbol": r[0], "name": r[1]} for r in rows]
    # Fallback: stock_ohlcv if symbols table not yet seeded
    rows = db.execute(
        "SELECT DISTINCT symbol FROM stock_ohlcv WHERE symbol ILIKE ? ORDER BY symbol LIMIT 20",
        [f"{q.upper()}%"]
    ).fetchall()
    return [{"symbol": r[0], "name": ""} for r in rows]


@router.get("/info/{symbol}")
def get_stock_info(symbol: str):
    db = get_db()
    row = db.execute(
        "SELECT symbol, company_name, series, isin FROM nse_symbols WHERE symbol = ?",
        [symbol.upper()]
    ).fetchone()
    if not row:
        return {"symbol": symbol.upper(), "company_name": None, "series": None, "isin": None}
    return {"symbol": row[0], "company_name": row[1], "series": row[2], "isin": row[3]}


@router.get("/fundamentals/{symbol}")
def get_fundamentals(
    symbol: str,
    period_type: str = Query("Q", pattern="^(Q|A)$"),
    is_consolidated: bool = Query(True),
    limit: int = Query(20, le=40),
):
    db = get_db()
    rows = db.execute(
        """SELECT period, period_type, is_consolidated, revenue, gross_profit, ebitda, ebit,
                  pbt, pat, eps_basic, eps_diluted, total_assets, total_equity, total_debt,
                  cash, cfo, cfi, cff, capex
           FROM stock_fundamentals
           WHERE symbol = ? AND period_type = ? AND is_consolidated = ?
           ORDER BY period DESC LIMIT ?""",
        [symbol.upper(), period_type, is_consolidated, limit]
    ).df()
    if rows.empty:
        raise HTTPException(404, f"No fundamentals for {symbol}")
    return df_to_records(rows)


@router.get("/delivery/{symbol}")
def get_delivery(
    symbol: str,
    from_date: Optional[date] = Query(None),
    to_date:   Optional[date] = Query(None),
):
    db = get_db()
    sql = "SELECT date, delivery_qty, delivery_pct FROM stock_delivery WHERE symbol = ?"
    params = [symbol.upper()]
    if from_date:
        sql += " AND date >= ?"; params.append(from_date)
    if to_date:
        sql += " AND date <= ?"; params.append(to_date)
    sql += " ORDER BY date"
    df = db.execute(sql, params).df()
    if df.empty:
        raise HTTPException(404, f"No delivery data for {symbol}")
    return df_to_records(df)


@router.get("/shareholding/{symbol}")
def get_shareholding(symbol: str):
    db = get_db()
    df = db.execute(
        """SELECT period, promoter_pct, promoter_pledge_pct, fii_pct, dii_pct, mf_pct, retail_pct
           FROM shareholding WHERE symbol = ? ORDER BY period DESC LIMIT 12""",
        [symbol.upper()]
    ).df()
    if df.empty:
        raise HTTPException(404, f"No shareholding data for {symbol}")
    return df_to_records(df)


@router.get("/corporate-actions/{symbol}")
def get_corporate_actions(symbol: str):
    db = get_db()
    df = db.execute(
        """SELECT ex_date, action_type, value, ratio, record_date
           FROM corporate_actions WHERE symbol = ? ORDER BY ex_date DESC LIMIT 50""",
        [symbol.upper()]
    ).df()
    return df_to_records(df)


@router.get("/insider-trades/{symbol}")
def get_insider_trades(
    symbol: str,
    from_date: Optional[date] = Query(None),
    to_date:   Optional[date] = Query(None),
):
    db = get_db()
    sql = """SELECT person_name, person_category, trade_date, transaction_type, quantity, price, filing_date
             FROM insider_trades WHERE symbol = ?"""
    params = [symbol.upper()]
    if from_date:
        sql += " AND trade_date >= ?"; params.append(from_date)
    if to_date:
        sql += " AND trade_date <= ?"; params.append(to_date)
    sql += " ORDER BY trade_date DESC LIMIT 100"
    df = db.execute(sql, params).df()
    return df_to_records(df)


@router.post("/prefetch/{symbol}")
def prefetch_symbol(symbol: str):
    """
    Synchronously fetch all available yfinance data for one symbol (~5-10s).
    Skips any section that already has data in the DB.
    Called automatically by the frontend on stock detail page load.
    """
    sym = symbol.upper()
    db = get_db()
    fetched: list[str] = []

    t = yf.Ticker(f"{sym}.NS")

    # --- Fundamentals ---
    fund_count = db.execute(
        "SELECT COUNT(*) FROM stock_fundamentals WHERE symbol = ?", [sym]
    ).fetchone()[0]
    if fund_count == 0:
        try:
            from backend.data_sync.sync_fundamentals import _parse_financials
            from backend.data_sync.base import upsert_df
            rows = _parse_financials(t, sym, "Q") + _parse_financials(t, sym, "A")
            if rows:
                df = pd.DataFrame(rows).dropna(subset=["revenue", "pat"], how="all")
                if not df.empty:
                    upsert_df(df, "stock_fundamentals")
                    fetched.append(f"fundamentals:{len(df)}")
        except Exception as e:
            print(f"[prefetch:{sym}] fundamentals: {e}")

    # --- Shareholding (yfinance major_holders: insider % ≈ promoter %) ---
    share_count = db.execute(
        "SELECT COUNT(*) FROM shareholding WHERE symbol = ?", [sym]
    ).fetchone()[0]
    if share_count == 0:
        try:
            from backend.data_sync.base import upsert_df
            mh = t.major_holders
            # mh index = breakdown key (e.g. "insidersPercentHeld"), column "Value" = fraction
            if mh is not None and not mh.empty and "Value" in mh.columns:
                def _pct(key: str) -> float | None:
                    if key in mh.index:
                        try:
                            return round(float(mh.loc[key, "Value"]) * 100, 2)
                        except (TypeError, ValueError):
                            pass
                    return None
                promoter_pct = _pct("insidersPercentHeld")
                fii_pct = _pct("institutionsPercentHeld")
                if promoter_pct is not None:
                    df = pd.DataFrame([{
                        "symbol": sym, "period": date.today(),
                        "promoter_pct": promoter_pct,
                        "promoter_pledge_pct": None,
                        "fii_pct": fii_pct,
                        "dii_pct": None, "mf_pct": None, "retail_pct": None,
                        "government_pct": None, "total_shareholders": None,
                    }])
                    upsert_df(df, "shareholding")
                    fetched.append("shareholding:1")
        except Exception as e:
            print(f"[prefetch:{sym}] shareholding: {e}")

    # --- F&O Options Chain (yfinance — NSE bhavcopy not accessible from cloud IPs) ---
    fno_count = db.execute(
        "SELECT COUNT(*) FROM fno_ohlcv WHERE symbol = ? AND date = ?", [sym, date.today()]
    ).fetchone()[0]
    if fno_count == 0:
        try:
            from backend.data_sync.base import upsert_df as _upsert
            expiries = t.options  # tuple of expiry date strings
            if expiries:
                rows = []
                for expiry_str in expiries[:4]:
                    try:
                        chain = t.option_chain(expiry_str)
                        expiry_date = date.fromisoformat(expiry_str)
                        for side, opt_type in [(chain.calls, "CE"), (chain.puts, "PE")]:
                            for _, c in side.iterrows():
                                lp = c.get("lastPrice")
                                oi = c.get("openInterest")
                                vol = c.get("volume")
                                rows.append({
                                    "date": date.today(), "symbol": sym,
                                    "instrument": "OPTSTK",
                                    "expiry": expiry_date,
                                    "strike": float(c["strike"]),
                                    "option_type": opt_type,
                                    "open": None, "high": None, "low": None,
                                    "close": float(lp) if pd.notna(lp) else None,
                                    "settle_price": float(lp) if pd.notna(lp) else None,
                                    "contracts": int(vol) if pd.notna(vol) else None,
                                    "open_interest": int(oi) if pd.notna(oi) else None,
                                    "oi_change": None,
                                })
                    except Exception:
                        continue
                if rows:
                    cols = ["date", "symbol", "instrument", "expiry", "strike", "option_type",
                            "open", "high", "low", "close", "settle_price", "contracts",
                            "open_interest", "oi_change"]
                    _upsert(pd.DataFrame(rows)[cols], "fno_ohlcv")
                    fetched.append(f"fno:{len(rows)}")
        except Exception as e:
            print(f"[prefetch:{sym}] fno: {e}")

    # --- Corporate actions (dividends + splits) ---
    ca_count = db.execute(
        "SELECT COUNT(*) FROM corporate_actions WHERE symbol = ?", [sym]
    ).fetchone()[0]
    if ca_count == 0:
        try:
            from backend.data_sync.base import upsert_df
            actions = t.actions
            if actions is not None and not actions.empty:
                rows = []
                for idx, row in actions.iterrows():
                    ex = idx.date() if hasattr(idx, "date") else idx
                    if row.get("Dividends", 0) > 0:
                        rows.append({"symbol": sym, "ex_date": ex,
                                     "action_type": "DIVIDEND", "value": float(row["Dividends"]),
                                     "ratio": None, "record_date": None})
                    if row.get("Stock Splits", 0) > 0:
                        rows.append({"symbol": sym, "ex_date": ex,
                                     "action_type": "SPLIT", "value": None,
                                     "ratio": str(row["Stock Splits"]), "record_date": None})
                if rows:
                    upsert_df(pd.DataFrame(rows), "corporate_actions")
                    fetched.append(f"corp_actions:{len(rows)}")
        except Exception as e:
            print(f"[prefetch:{sym}] corp_actions: {e}")

    return {"status": "ok", "symbol": sym, "fetched": fetched}


@router.get("/ratios/{symbol}")
def get_ratios(symbol: str):
    """Key valuation & return ratios from yfinance info (live, ~1-2s)."""
    sym = symbol.upper()
    try:
        t = yf.Ticker(f"{sym}.NS")
        info = t.info
        def _f(key, scale=1):
            v = info.get(key)
            return round(float(v) * scale, 2) if v is not None else None

        # Analyst recommendation history (last 4 periods)
        try:
            recs_df = t.recommendations_summary
            recs = recs_df.head(4).to_dict(orient="records") if recs_df is not None and not recs_df.empty else []
        except Exception:
            recs = []

        # Next earnings date from calendar
        next_earnings = None
        try:
            cal = t.calendar
            if isinstance(cal, dict):
                ed = cal.get("Earnings Date", [None])
                if ed and ed[0] is not None:
                    dt = ed[0]
                    next_earnings = dt.strftime("%Y-%m-%d") if hasattr(dt, "strftime") else str(dt)
        except Exception:
            pass

        return {
            "symbol":                  sym,
            "market_cap_cr":           _f("marketCap", 1 / 1e7),
            "pe_ratio":                _f("trailingPE"),
            "forward_pe":              _f("forwardPE"),
            "pb_ratio":                _f("priceToBook"),
            "book_value":              _f("bookValue"),
            "roe_pct":                 _f("returnOnEquity", 100),
            "roa_pct":                 _f("returnOnAssets", 100),
            "profit_margin_pct":       _f("profitMargins", 100),
            "operating_margin_pct":    _f("operatingMargins", 100),
            "eps_trailing":            _f("trailingEps"),
            "eps_forward":             _f("forwardEps"),
            "div_yield_pct":           _f("trailingAnnualDividendYield", 100),
            "div_per_share":           _f("lastDividendValue"),
            "payout_ratio_pct":        _f("payoutRatio", 100),
            "face_value":              _f("faceValue"),
            "beta":                    _f("beta"),
            "52w_high":                _f("fiftyTwoWeekHigh"),
            "52w_low":                 _f("fiftyTwoWeekLow"),
            "avg_volume":              info.get("averageVolume"),
            "shares_outstanding":      info.get("sharesOutstanding"),
            "revenue_growth_pct":      _f("revenueGrowth", 100),
            "earnings_growth_pct":     _f("earningsGrowth", 100),
            "target_high":             _f("targetHighPrice"),
            "target_low":              _f("targetLowPrice"),
            "target_mean":             _f("targetMeanPrice"),
            "recommendation":          info.get("recommendationKey"),
            "employees":               info.get("fullTimeEmployees"),
            "website":                 info.get("website"),
            "description":             info.get("longBusinessSummary"),
            "sector":                  info.get("sector"),
            "industry":                info.get("industry"),
            "next_earnings":           next_earnings,
            "recommendations_summary": recs,
        }
    except Exception as e:
        return {"symbol": sym, "error": str(e)}


@router.get("/fno/{symbol}")
def get_fno_ohlcv(
    symbol: str,
    instrument: Optional[str] = Query(None, description="FUTSTK, OPTSTK etc."),
    from_date:  Optional[date] = Query(None),
    to_date:    Optional[date] = Query(None),
    limit: int = Query(500, le=5000),
):
    db = get_db()
    sql = "SELECT * FROM fno_ohlcv WHERE symbol = ?"
    params = [symbol.upper()]
    if instrument:
        sql += " AND instrument = ?"; params.append(instrument.upper())
    if from_date:
        sql += " AND date >= ?"; params.append(from_date)
    if to_date:
        sql += " AND date <= ?"; params.append(to_date)
    sql += f" ORDER BY date DESC, expiry LIMIT {limit}"
    df = db.execute(sql, params).df()
    return df_to_records(df)


@router.get("/sector-compare/{symbol}")
def get_sector_compare(
    symbol: str,
    days: int = Query(252, ge=21, le=1260),
):
    """Normalized % return for stock vs its sector index — uses existing index_ohlcv data."""
    from datetime import timedelta
    sym = symbol.upper()
    db  = get_db()

    # Determine sector → index name
    try:
        sector = yf.Ticker(f"{sym}.NS").info.get("sector", "")
    except Exception:
        sector = ""
    index_name = _SECTOR_INDEX.get(sector, "NIFTY 50")

    from_date = date.today() - timedelta(days=days)

    # Fetch stock OHLCV from DB
    stock_df = db.execute(
        "SELECT date, close FROM stock_ohlcv WHERE symbol = ? AND date >= ? ORDER BY date",
        [sym, from_date]
    ).df()

    # Fall back to yfinance if DB has no data
    if stock_df.empty:
        try:
            hist = yf.Ticker(f"{sym}.NS").history(start=from_date.isoformat())
            if not hist.empty:
                hist = hist.reset_index()
                stock_df = pd.DataFrame({
                    "date":  pd.to_datetime(hist["Date"]).dt.date,
                    "close": hist["Close"].values,
                })
        except Exception:
            pass

    sector_df = db.execute(
        "SELECT date, close FROM index_ohlcv WHERE index_name = ? AND date >= ? ORDER BY date",
        [index_name, from_date]
    ).df()

    if stock_df.empty or sector_df.empty:
        raise HTTPException(404, f"Insufficient data for {sym}")

    def _normalize(df: pd.DataFrame):
        df = df.dropna(subset=["close"]).copy()
        df["date"] = df["date"].astype(str)
        first = df["close"].iloc[0]
        if first == 0:
            raise HTTPException(500, "Zero base price")
        df["pct"] = round(((df["close"] / first) - 1) * 100, 2)
        return df[["date", "pct"]].to_dict(orient="records")

    return {
        "stock":       _normalize(stock_df),
        "sector":      _normalize(sector_df),
        "sector_name": index_name,
    }


@router.get("/news/{symbol}")
def get_stock_news(symbol: str):
    """Recent news from Google News RSS — always live, no DB caching."""
    import httpx
    from lxml import etree

    sym = symbol.upper()
    url = (
        f"https://news.google.com/rss/search"
        f"?q={sym}+NSE+stock&hl=en-IN&gl=IN&ceid=IN:en"
    )
    try:
        with httpx.Client(timeout=8, follow_redirects=True) as client:
            resp = client.get(url, headers={"User-Agent": "Mozilla/5.0"})
        if not resp.is_success:
            return []
        root = etree.fromstring(resp.content)
        result = []
        for item in root.findall(".//item")[:10]:
            def _t(tag: str) -> str:
                el = item.find(tag)
                return (el.text or "").strip() if el is not None else ""
            link = _t("link") or _t("guid")
            result.append({
                "title":        _t("title"),
                "link":         link,
                "source":       _t("source"),
                "published_at": _t("pubDate"),
            })
        return result
    except Exception:
        return []


@router.get("/holders/{symbol}")
def get_institutional_holders(symbol: str):
    """Top 10 institutional holders from yfinance — always live."""
    sym = symbol.upper()
    try:
        df = yf.Ticker(f"{sym}.NS").institutional_holders
        if df is None or df.empty:
            return []
        df = df.head(10).copy()
        # Convert any datetime columns to ISO strings
        for col in df.columns:
            if pd.api.types.is_datetime64_any_dtype(df[col]):
                df[col] = df[col].dt.strftime("%Y-%m-%d")
        return df.where(pd.notna(df), None).to_dict(orient="records")
    except Exception:
        return []
