"""
Stock routes: OHLCV, fundamentals, delivery, shareholding, corporate actions, insider trades.
"""

from datetime import date, timedelta
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
    """OHLCV for charting — DB first, yfinance fallback (cached to DB on first fetch).
    Also falls back when DB has data but it doesn't reach the requested from_date
    (e.g. only 2 recent bhavcopy rows while user asks for 1Y).
    """
    from datetime import timedelta
    df = _fetch_ohlcv(symbol, from_date, to_date)

    needs_yfinance = df.empty
    if not df.empty and from_date:
        earliest = pd.to_datetime(df["date"].iloc[0]).date()
        # Gap > 14 days means DB is missing significant history for this request
        if (earliest - from_date).days > 14:
            needs_yfinance = True

    if needs_yfinance:
        yf_df = _yfinance_ohlcv(symbol, from_date, to_date)
        if not yf_df.empty:
            _cache_ohlcv(symbol, yf_df)
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
    sym = symbol.upper()
    db = get_db()
    df = db.execute(
        """SELECT period, promoter_pct, promoter_pledge_pct, fii_pct, dii_pct, mf_pct, retail_pct
           FROM shareholding WHERE symbol = ? ORDER BY period DESC LIMIT 12""",
        [sym]
    ).df()
    if df.empty:
        raise HTTPException(404, f"No shareholding data for {symbol}")

    # If latest row has no FII data, fetch XBRL in background to enrich it
    latest = df.iloc[0]
    if latest.get("fii_pct") is None or (hasattr(latest["fii_pct"], "__float__") and latest["fii_pct"] != latest["fii_pct"]):
        import threading
        def _bg_xbrl():
            try:
                from backend.data_sync.sync_shareholding_master import fetch_and_store_one
                fetch_and_store_one(sym)
            except Exception:
                pass
        threading.Thread(target=_bg_xbrl, daemon=True).start()

    return df_to_records(df)


@router.get("/bank-financials/{symbol}")
def get_bank_financials(symbol: str, consolidated: bool = True):
    sym = symbol.upper()
    db = get_db()
    try:
        df = db.execute("""
            SELECT period, period_type, is_consolidated,
                   interest_earned/1e7 as interest_earned_cr,
                   interest_expended/1e7 as interest_expended_cr,
                   nii/1e7 as nii_cr, other_income/1e7 as other_income_cr,
                   total_income/1e7 as total_income_cr,
                   operating_expenses/1e7 as operating_expenses_cr,
                   ppop/1e7 as ppop_cr, provisions/1e7 as provisions_cr,
                   pbt/1e7 as pbt_cr, tax/1e7 as tax_cr, pat/1e7 as pat_cr,
                   eps, gnpa/1e7 as gnpa_cr, net_npa/1e7 as net_npa_cr,
                   gnpa_pct, net_npa_pct, crar_pct, cet1_pct, roa
            FROM bank_financials
            WHERE symbol = ? AND period_type = 'Q' AND is_consolidated = ?
            ORDER BY period DESC LIMIT 12
        """, [sym, consolidated]).df()
    except Exception:
        raise HTTPException(404, f"No bank financials for {symbol}")

    if df.empty:
        # Try lazy sync then retry
        try:
            from backend.data_sync.sync_bank_financials import sync_symbol
            sync_symbol(sym)
            df = db.execute("""
                SELECT period, period_type, is_consolidated,
                       nii/1e7 as nii_cr, pat/1e7 as pat_cr, eps,
                       gnpa_pct, net_npa_pct, crar_pct, roa
                FROM bank_financials
                WHERE symbol = ? AND period_type = 'Q' AND is_consolidated = ?
                ORDER BY period DESC LIMIT 12
            """, [sym, consolidated]).df()
        except Exception:
            pass

    if df.empty:
        raise HTTPException(404, f"No bank financials for {symbol}")
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

    # Shareholding: covered by sync_shareholding_master (NSE quarterly filings, all stocks)

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

        # Dividend yield — prefer NSE corporate_actions over Yahoo Finance
        # (Yahoo often returns 0 / stale for Indian stocks)
        div_yield_pct = _f("trailingAnnualDividendYield", 100)
        div_per_share = _f("lastDividendValue")
        face_value    = None
        roce_pct      = None
        try:
            db = get_db()
            cutoff = (date.today() - timedelta(days=548)).isoformat()  # 18 months

            # Dividend from NSE corporate actions
            nse_div = db.execute("""
                SELECT value FROM corporate_actions
                WHERE symbol = ? AND action_type = 'DIVIDEND'
                  AND ex_date >= ? AND value IS NOT NULL
                ORDER BY ex_date DESC LIMIT 1
            """, [sym, cutoff]).fetchone()
            if nse_div and nse_div[0]:
                div_per_share = round(float(nse_div[0]), 2)
                cur_price = info.get("currentPrice") or info.get("regularMarketPrice")
                if cur_price and float(cur_price) > 0:
                    div_yield_pct = round(div_per_share / float(cur_price) * 100, 2)

            # Face value from NSE equity master (EQUITY_L.csv)
            fv_row = db.execute(
                "SELECT face_value FROM nse_symbols WHERE symbol = ?", [sym]
            ).fetchone()
            if fv_row and fv_row[0]:
                face_value = float(fv_row[0])

            # ROCE = EBIT (or PBT fallback) / (Equity + Debt) * 100
            # Use annual row first; if EBIT null (banks), sum TTM quarterly PBT
            earnings = None
            equity_ce = debt_ce = None
            annual = db.execute("""
                SELECT COALESCE(ebit, pbt), total_equity, total_debt FROM stock_fundamentals
                WHERE symbol = ? AND period_type = 'A'
                  AND (ebit IS NOT NULL OR pbt IS NOT NULL)
                  AND total_equity IS NOT NULL AND total_debt IS NOT NULL
                ORDER BY period DESC LIMIT 1
            """, [sym]).fetchone()
            if annual and annual[0] and annual[0] > 0:
                earnings, equity_ce, debt_ce = annual
            else:
                # TTM: sum last 4 quarterly PBT/EBIT
                ttm = db.execute("""
                    SELECT SUM(COALESCE(ebit, pbt)), MAX(total_equity), MAX(total_debt)
                    FROM (
                        SELECT ebit, pbt, total_equity, total_debt
                        FROM stock_fundamentals
                        WHERE symbol = ? AND period_type = 'Q'
                          AND (ebit IS NOT NULL OR pbt IS NOT NULL)
                          AND total_equity IS NOT NULL
                        ORDER BY period DESC LIMIT 4
                    )
                """, [sym]).fetchone()
                if ttm and ttm[0] and ttm[0] > 0:
                    earnings, equity_ce, debt_ce = ttm
            if earnings and equity_ce:
                ce = equity_ce + (debt_ce or 0)
                if ce > 0:
                    roce_pct = round(earnings / ce * 100, 2)
        except Exception:
            pass  # fall back to Yahoo values

        # PEG Ratio = P/E ÷ EPS growth rate
        peg_ratio = None
        pe_val = _f("trailingPE")
        eg_val = _f("earningsGrowth", 100)
        if pe_val and eg_val and eg_val > 0:
            peg_ratio = round(pe_val / eg_val, 2)

        # Dividend growth streak — consecutive years of YoY increase (exclude current year)
        div_streak = None
        try:
            from datetime import date as _date
            cur_yr = _date.today().year
            div_rows = db.execute("""
                SELECT year(ex_date) as yr, SUM(value) as total
                FROM corporate_actions
                WHERE symbol = ? AND action_type = 'DIVIDEND' AND value > 0
                  AND year(ex_date) < ?
                GROUP BY yr ORDER BY yr
            """, [sym, cur_yr]).fetchall()
            if len(div_rows) >= 2:
                streak = 0
                for i in range(len(div_rows) - 1, 0, -1):
                    if div_rows[i][1] > div_rows[i - 1][1]:
                        streak += 1
                    else:
                        break
                div_streak = streak
        except Exception:
            pass

        # Debt/Equity, P/S, FCF, Sales CAGR 3Y, Profit CAGR 3Y
        debt_to_equity = None
        # Sanity-check Yahoo's pre-computed ratios — dual-listed stocks (INFY, WIPRO, HCL)
        # have USD financials but INR market cap, producing absurd values (P/S 209, EV/EBITDA 951)
        _ps_raw = _f("priceToSalesTrailing12Months")
        price_to_sales = _ps_raw if (_ps_raw and 0 < _ps_raw < 80) else None
        fcf_cr         = None
        sales_cagr_3y  = None
        profit_cagr_3y = None
        try:
            db = get_db()
            # D/E from fundamentals (consistent units within a stock)
            de_row = db.execute("""
                SELECT total_debt, total_equity FROM stock_fundamentals
                WHERE symbol = ? AND period_type = 'A'
                  AND total_debt IS NOT NULL AND total_equity IS NOT NULL AND total_equity > 0
                ORDER BY period DESC LIMIT 1
            """, [sym]).fetchone()
            if de_row:
                debt_to_equity = round(de_row[0] / de_row[1], 2)

            # FCF — prefer Yahoo's freeCashflow; fall back to CFO − Capex from fundamentals
            # Sanity: FCF yield must be between 0.1% and 50% of market cap
            # (filters dual-listed stocks where Yahoo gives USD FCF but INR market cap)
            mc_val = info.get("marketCap") or 0
            yf_fcf = info.get("freeCashflow")
            if yf_fcf and yf_fcf != 0:
                fcf_candidate = round(float(yf_fcf) / 1e7, 2)
                mc_cr = mc_val / 1e7
                if mc_cr > 0 and 0.001 < abs(fcf_candidate) / mc_cr < 0.5:
                    fcf_cr = fcf_candidate
            if fcf_cr is None:
                cf_row = db.execute("""
                    SELECT cfo, capex FROM stock_fundamentals
                    WHERE symbol = ? AND period_type = 'A'
                      AND cfo IS NOT NULL AND capex IS NOT NULL
                    ORDER BY period DESC LIMIT 1
                """, [sym]).fetchone()
                if cf_row:
                    candidate = round((cf_row[0] - abs(cf_row[1])) / 1e7, 2)
                    mc_cr = mc_val / 1e7
                    if mc_cr > 0 and 0.001 < abs(candidate) / mc_cr < 0.5:
                        fcf_cr = candidate

            # 3-year CAGR (revenue + PAT, in consistent units so ratio is unit-free)
            cagr_rows = db.execute("""
                SELECT period, revenue, pat FROM stock_fundamentals
                WHERE symbol = ? AND period_type = 'A' AND revenue IS NOT NULL AND pat IS NOT NULL
                ORDER BY period DESC LIMIT 4
            """, [sym]).fetchall()
            if len(cagr_rows) >= 4:
                newest, oldest = cagr_rows[0], cagr_rows[3]
                rev_new, rev_old = newest[1], oldest[1]
                pat_new, pat_old = newest[2], oldest[2]
                if rev_old and rev_old > 0 and rev_new and rev_new > 0:
                    sales_cagr_3y = round(((rev_new / rev_old) ** (1/3) - 1) * 100, 1)
                if pat_old and pat_old > 0 and pat_new and pat_new > 0:
                    profit_cagr_3y = round(((pat_new / pat_old) ** (1/3) - 1) * 100, 1)
        except Exception:
            pass

        # EPS beat/miss — last 4 quarters actual vs estimate
        eps_history = None
        try:
            import math
            eh = t.earnings_history
            if eh is not None and not eh.empty:
                eps_history = []
                for idx, row in eh.iterrows():
                    actual   = row.get("epsActual")
                    estimate = row.get("epsEstimate")
                    surprise = row.get("surprisePercent")
                    if actual is None or (isinstance(actual, float) and math.isnan(actual)):
                        continue
                    eps_history.append({
                        "quarter":      str(idx)[:10],
                        "eps_actual":   round(float(actual), 2),
                        "eps_estimate": round(float(estimate), 2) if estimate and not math.isnan(float(estimate)) else None,
                        "surprise_pct": round(float(surprise) * 100, 2) if surprise and not math.isnan(float(surprise)) else None,
                    })
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
            "div_yield_pct":           div_yield_pct,
            "div_per_share":           div_per_share,
            "payout_ratio_pct":        _f("payoutRatio", 100),
            "face_value":              face_value,
            "roce_pct":                roce_pct,
            "peg_ratio":               peg_ratio,
            "div_streak":              div_streak,
            "eps_history":             eps_history,
            "ev_to_ebitda":            _f("enterpriseToEbitda") if (_f("enterpriseToEbitda") and 0 < _f("enterpriseToEbitda") < 200) else None,
            "debt_to_equity":          debt_to_equity,
            "price_to_sales":          price_to_sales,
            "fcf_cr":                  fcf_cr,
            "sales_cagr_3y":           sales_cagr_3y,
            "profit_cagr_3y":          profit_cagr_3y,
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


# ── Graph: correlation + common-holders ─────────────────────────────────────

@router.get("/top-correlated/{symbol}")
def get_top_correlated(symbol: str, days: int = 90, top: int = 15):
    sym = symbol.upper()
    db  = get_db()
    min_rows = int(days * 0.55)  # ~55% of calendar days = ~80% of trading days
    start_date  = (pd.Timestamp.now() - pd.Timedelta(days=days)).date()
    # Fetch 7 extra days before the window so LAG() has a prior value on the first window date
    pre_date    = (pd.Timestamp.now() - pd.Timedelta(days=days + 7)).date()
    rows = db.execute("""
        WITH target_raw AS (
            SELECT date, close / LAG(close) OVER (ORDER BY date) - 1 AS ret
            FROM stock_ohlcv WHERE symbol = ? AND date >= ?
        ),
        target_ret AS (SELECT date, ret FROM target_raw WHERE date >= ? AND ret IS NOT NULL),
        universe AS (
            SELECT symbol FROM stock_ohlcv
            WHERE date >= ? AND symbol != ?
            GROUP BY symbol HAVING COUNT(*) >= ?
            ORDER BY COUNT(*) DESC LIMIT 500
        ),
        cand_raw AS (
            SELECT o.date, o.symbol,
                   o.close / LAG(o.close) OVER (PARTITION BY o.symbol ORDER BY o.date) - 1 AS ret
            FROM stock_ohlcv o JOIN universe u ON u.symbol = o.symbol
            WHERE o.date >= ?
        ),
        cand_ret AS (SELECT date, symbol, ret FROM cand_raw WHERE date >= ? AND ret IS NOT NULL)
        SELECT c.symbol, n.company_name,
               ROUND(corr(t.ret, c.ret), 4) AS correlation,
               COUNT(*) AS days_overlap
        FROM target_ret t JOIN cand_ret c USING (date)
        LEFT JOIN nse_symbols n ON n.symbol = c.symbol
        GROUP BY c.symbol, n.company_name
        HAVING days_overlap >= ? AND corr(t.ret, c.ret) IS NOT NULL
        ORDER BY ABS(corr(t.ret, c.ret)) DESC
        LIMIT ?
    """, [sym, pre_date, start_date, start_date, sym, min_rows, pre_date, start_date, min_rows, top]).fetchall()
    return [{"symbol": r[0], "company_name": r[1], "correlation": r[2], "days_overlap": r[3]}
            for r in rows]


@router.get("/correlation-matrix")
def get_correlation_matrix(symbols: str, days: int = 252):
    syms = [s.strip().upper() for s in symbols.split(",")][:12]
    if not syms:
        return {"symbols": [], "matrix": []}
    db  = get_db()
    placeholders = ",".join("?" * len(syms))
    start_date = (pd.Timestamp.now() - pd.Timedelta(days=days)).date()
    pre_date   = (pd.Timestamp.now() - pd.Timedelta(days=days + 7)).date()
    raw = db.execute(f"""
        SELECT symbol, date,
               close / LAG(close) OVER (PARTITION BY symbol ORDER BY date) - 1 AS ret
        FROM stock_ohlcv
        WHERE symbol IN ({placeholders}) AND date >= ?
    """, syms + [pre_date]).df()
    df = raw[raw["date"] >= pd.Timestamp(start_date)]
    if df.empty:
        return {"symbols": syms, "matrix": [[None]*len(syms)]*len(syms)}
    wide    = df.dropna(subset=["ret"]).pivot_table(index="date", columns="symbol", values="ret")
    present = [s for s in syms if s in wide.columns]
    corr    = wide[present].corr(method="pearson").round(4)
    def _safe(v):
        import math
        return None if (v is None or (isinstance(v, float) and math.isnan(v))) else float(v)
    matrix  = [[_safe(corr.loc[r, c]) if (r in corr.index and c in corr.columns) else None
                for c in present] for r in present]
    return {"symbols": present, "matrix": matrix}


@router.get("/common-holders")
def get_common_holders(symbols: str):
    syms = [s.strip().upper() for s in symbols.split(",")][:12]
    if len(syms) < 2:
        return []
    db = get_db()
    rows = db.execute("""
        SELECT symbol, fii_pct, mf_pct
        FROM shareholding
        WHERE symbol IN ({})
          AND period = (SELECT MAX(period) FROM shareholding s2 WHERE s2.symbol = shareholding.symbol)
    """.format(",".join("?" * len(syms))), syms).fetchall()
    data = {r[0]: {"fii": r[1] or 0.0, "mf": r[2] or 0.0} for r in rows}
    pairs = []
    for i, s1 in enumerate(syms):
        for s2 in syms[i + 1:]:
            if s1 in data and s2 in data:
                fii_ov = round(min(data[s1]["fii"], data[s2]["fii"]), 2)
                mf_ov  = round(min(data[s1]["mf"],  data[s2]["mf"]),  2)
                pairs.append({
                    "symbol1": s1, "symbol2": s2,
                    "overlap_score": round(0.5 * fii_ov + 0.5 * mf_ov, 2),
                    "fii_overlap": fii_ov, "mf_overlap": mf_ov,
                })
    pairs.sort(key=lambda x: -x["overlap_score"])
    return pairs
