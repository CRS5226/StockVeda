"""
Screener universe resolution and smart per-symbol incremental OHLCV + indicator sync.
"""
from __future__ import annotations

import uuid
from datetime import date, timedelta
from typing import Optional

import pandas as pd

from backend.db.connection import get_db

# ── Nifty constituent lists ────────────────────────────────────────────────

NIFTY_50: list[str] = [
    "ADANIENT", "ADANIPORTS", "APOLLOHOSP", "ASIANPAINT", "AXISBANK",
    "BAJAJ-AUTO", "BAJAJFINSV", "BAJFINANCE", "BHARTIARTL", "BPCL",
    "BRITANNIA", "CIPLA", "COALINDIA", "DIVISLAB", "DRREDDY", "EICHERMOT",
    "GRASIM", "HCLTECH", "HDFCBANK", "HDFCLIFE", "HEROMOTOCO", "HINDALCO",
    "HINDUNILVR", "ICICIBANK", "INDUSINDBK", "INFY", "ITC", "JSWSTEEL",
    "KOTAKBANK", "LT", "M&M", "MARUTI", "NESTLEIND", "NTPC", "ONGC",
    "POWERGRID", "RELIANCE", "SBILIFE", "SBIN", "SHRIRAMFIN", "SUNPHARMA",
    "TATACONSUM", "TATAMOTORS", "TATASTEEL", "TCS", "TECHM", "TITAN",
    "TRENT", "ULTRACEMCO", "WIPRO",
]

NIFTY_NEXT_50: list[str] = [
    "ABB", "ADANIGREEN", "ADANIPOWER", "AMBUJACEM", "BAJAJHLDNG",
    "BANKBARODA", "BEL", "BOSCHLTD", "CANBK", "CHOLAFIN", "COLPAL",
    "DLF", "DMART", "GAIL", "GODREJCP", "GODREJPROP", "HAL", "HAVELLS",
    "HDFCAMC", "ICICIPRULI", "ICICIGI", "INDHOTEL", "IOC", "IRCTC",
    "IRFC", "JINDALSTEL", "LICI", "LTIM", "LTTS", "LUPIN", "MAXHEALTH",
    "MCDOWELL-N", "MUTHOOTFIN", "NBCC", "NHPC", "PIDILITIND", "PNB",
    "RECLTD", "SRF", "TATAPOWER", "TORNTPHARM", "UBL", "UNIONBANK",
    "UPL", "VBL", "VEDL", "ZOMATO", "ZYDUSLIFE",
]

NIFTY_100: list[str] = NIFTY_50 + NIFTY_NEXT_50

PRESETS: dict[str, dict] = {
    "nifty50":  {"label": "Nifty 50",  "symbols": NIFTY_50},
    "nifty100": {"label": "Nifty 100", "symbols": NIFTY_100},
}


def resolve_preset(preset_id: str) -> Optional[list[str]]:
    p = PRESETS.get(preset_id)
    return list(p["symbols"]) if p else None


def top_n_by_volume(n: int = 200) -> list[str]:
    """Return top-N NSE EQ symbols by average volume over the last 30 days."""
    db = get_db()
    cutoff = (date.today() - timedelta(days=30)).isoformat()
    rows = db.execute("""
        SELECT symbol, AVG(volume) AS avg_vol
        FROM stock_ohlcv WHERE date >= ?
        GROUP BY symbol ORDER BY avg_vol DESC LIMIT ?
    """, [cutoff, n]).fetchall()
    return [r[0] for r in rows]


def get_watchlist_symbols(watchlist_id: int) -> Optional[list[str]]:
    db = get_db()
    row = db.execute(
        "SELECT symbols FROM watchlists WHERE id = ?", [watchlist_id]
    ).fetchone()
    return list(row[0]) if row else None


# ── In-memory sync job registry ────────────────────────────────────────────

_SYNC_JOBS: dict[str, dict] = {}


def new_job_id() -> str:
    return uuid.uuid4().hex[:12]


def get_job(job_id: str) -> Optional[dict]:
    return _SYNC_JOBS.get(job_id)


# ── Smart incremental sync ─────────────────────────────────────────────────

def _rsi(series: pd.Series, period: int) -> float:
    delta = series.diff()
    gain = delta.clip(lower=0).rolling(period).mean()
    loss = (-delta.clip(upper=0)).rolling(period).mean()
    rs = gain / loss.replace(0, float("nan"))
    return (100 - 100 / (1 + rs)).iloc[-1]


def _atr(h: pd.Series, lo: pd.Series, c: pd.Series, period: int) -> float:
    tr = pd.concat([h - lo, (h - c.shift()).abs(), (lo - c.shift()).abs()], axis=1).max(axis=1)
    return tr.rolling(period).mean().iloc[-1]


def _compute_indicators(raw: pd.DataFrame) -> pd.Series:
    """Compute comprehensive indicator values for a symbol's OHLCV DataFrame (sorted asc)."""
    c  = raw["close"]
    h  = raw["high"]
    lo = raw["low"]
    v  = raw["volume"].astype(float)
    n  = len(c)

    # ── Moving Averages ─────────────────────────────────────────────────────
    sma_5   = c.rolling(5).mean().iloc[-1]
    sma_10  = c.rolling(10).mean().iloc[-1]
    sma_20  = c.rolling(20).mean().iloc[-1]
    sma_50  = c.rolling(50).mean().iloc[-1]
    sma_100 = c.rolling(100).mean().iloc[-1]
    sma_200 = c.rolling(200).mean().iloc[-1]

    ema_9   = c.ewm(span=9,   adjust=False).mean().iloc[-1]
    ema_12  = c.ewm(span=12,  adjust=False).mean()
    ema_26  = c.ewm(span=26,  adjust=False).mean()
    ema_20  = c.ewm(span=20,  adjust=False).mean().iloc[-1]
    ema_26v = ema_26.iloc[-1]
    ema_50  = c.ewm(span=50,  adjust=False).mean().iloc[-1]
    ema_100 = c.ewm(span=100, adjust=False).mean().iloc[-1]
    ema_200 = c.ewm(span=200, adjust=False).mean().iloc[-1]

    # WMA 20
    weights = pd.Series(range(1, 21))
    wma_20 = (c.rolling(20).apply(lambda x: (x * weights).sum() / weights.sum(), raw=True)).iloc[-1]

    # VWMA 20
    vwma_20 = (c * v).rolling(20).sum().iloc[-1] / v.rolling(20).sum().replace(0, float("nan")).iloc[-1]

    vol_sma_20 = v.rolling(20).mean().iloc[-1]
    vol_ratio  = (v.iloc[-1] / vol_sma_20) if vol_sma_20 > 0 else float("nan")

    # ── Momentum ─────────────────────────────────────────────────────────────
    rsi_9  = _rsi(c, 9)
    rsi_14 = _rsi(c, 14)
    rsi_21 = _rsi(c, 21)

    macd_line_s  = ema_12 - ema_26
    macd_line    = macd_line_s.iloc[-1]
    macd_sig     = macd_line_s.ewm(span=9, adjust=False).mean()
    macd_signal  = macd_sig.iloc[-1]
    macd_hist    = macd_line - macd_signal
    ppo_val      = (macd_line / ema_26.iloc[-1] * 100) if ema_26.iloc[-1] != 0 else float("nan")

    # TRIX 15 — triple-smoothed EMA percent change
    e1 = c.ewm(span=15, adjust=False).mean()
    e2 = e1.ewm(span=15, adjust=False).mean()
    e3 = e2.ewm(span=15, adjust=False).mean()
    trix_15 = e3.pct_change().iloc[-1] * 100

    # Stochastic %K / %D (14,3)
    low14  = lo.rolling(14).min()
    high14 = h.rolling(14).max()
    stoch_k_s = 100 * (c - low14) / (high14 - low14).replace(0, float("nan"))
    stoch_k   = stoch_k_s.iloc[-1]
    stoch_d   = stoch_k_s.rolling(3).mean().iloc[-1]

    # Williams %R (14)
    willr = -100 * (high14.iloc[-1] - c.iloc[-1]) / (high14.iloc[-1] - low14.iloc[-1]) if (high14.iloc[-1] - low14.iloc[-1]) != 0 else float("nan")

    # CCI (20)
    tp = (h + lo + c) / 3
    cci_20 = ((tp - tp.rolling(20).mean()) / (0.015 * tp.rolling(20).std())).iloc[-1]

    # ROC
    roc_10 = c.pct_change(10).iloc[-1] * 100
    roc_20 = c.pct_change(20).iloc[-1] * 100

    # MFI (14)
    tp_full = (h + lo + c) / 3
    mf      = tp_full * v
    pos_mf  = mf.where(tp_full > tp_full.shift(1), 0).rolling(14).sum()
    neg_mf  = mf.where(tp_full < tp_full.shift(1), 0).rolling(14).sum()
    mfi_14  = (100 - 100 / (1 + pos_mf / neg_mf.replace(0, float("nan")))).iloc[-1]

    # ── Volatility ────────────────────────────────────────────────────────────
    atr_7   = _atr(h, lo, c, 7)
    atr_14  = _atr(h, lo, c, 14)
    atr_21  = _atr(h, lo, c, 21)

    std20    = c.rolling(20).std()
    bb_mid   = c.rolling(20).mean()
    bb_upper = (bb_mid + 2 * std20).iloc[-1]
    bb_lower = (bb_mid - 2 * std20).iloc[-1]
    bb_mid_v = bb_mid.iloc[-1]
    std_20   = std20.iloc[-1]
    bb_width = ((bb_upper - bb_lower) / bb_mid_v * 100) if bb_mid_v != 0 else float("nan")
    bb_pct   = ((c.iloc[-1] - bb_lower) / (bb_upper - bb_lower)) if (bb_upper - bb_lower) != 0 else float("nan")

    # ── Trend (ADX) ───────────────────────────────────────────────────────────
    tr_s   = pd.concat([h - lo, (h - c.shift()).abs(), (lo - c.shift()).abs()], axis=1).max(axis=1)
    atr14s = tr_s.rolling(14).mean()
    up_move   = h - h.shift(1)
    down_move = lo.shift(1) - lo
    pos_dm = up_move.where((up_move > down_move) & (up_move > 0), 0)
    neg_dm = down_move.where((down_move > up_move) & (down_move > 0), 0)
    atr14_rep = atr14s.replace(0, float("nan"))
    pdi = 100 * pos_dm.rolling(14).mean() / atr14_rep
    ndi = 100 * neg_dm.rolling(14).mean() / atr14_rep
    dx  = (100 * (pdi - ndi).abs() / (pdi + ndi).replace(0, float("nan")))
    adx_14  = dx.rolling(14).mean().iloc[-1]
    adx_pos = pdi.iloc[-1]
    adx_neg = ndi.iloc[-1]

    # ── CMF (20) ─────────────────────────────────────────────────────────────
    hl_range = (h - lo).replace(0, float("nan"))
    mf_vol   = ((c - lo) - (h - c)) / hl_range * v
    cmf_20   = mf_vol.rolling(20).sum().iloc[-1] / v.rolling(20).sum().replace(0, float("nan")).iloc[-1]

    # ── 52-Week levels ────────────────────────────────────────────────────────
    window_252 = min(252, n)
    high_52w = h.iloc[-window_252:].max()
    low_52w  = lo.iloc[-window_252:].min()
    pct_from_52w_high = ((c.iloc[-1] / high_52w) - 1) * 100 if high_52w > 0 else float("nan")
    pct_from_52w_low  = ((c.iloc[-1] / low_52w) - 1) * 100  if low_52w  > 0 else float("nan")

    # ── Price change % ────────────────────────────────────────────────────────
    change_1d  = c.pct_change(1).iloc[-1]  * 100
    change_5d  = c.pct_change(min(5,  n-1)).iloc[-1] * 100
    change_20d = c.pct_change(min(20, n-1)).iloc[-1] * 100

    return pd.Series({
        # Moving averages
        "sma_5": sma_5, "sma_10": sma_10, "sma_20": sma_20,
        "sma_50": sma_50, "sma_100": sma_100, "sma_200": sma_200,
        "ema_9": ema_9, "ema_12": ema_12.iloc[-1], "ema_20": ema_20,
        "ema_26": ema_26v, "ema_50": ema_50, "ema_100": ema_100, "ema_200": ema_200,
        "wma_20": wma_20, "vwma_20": vwma_20,
        "volume_sma_20": vol_sma_20, "volume_ratio": vol_ratio,
        # Momentum
        "rsi_9": rsi_9, "rsi_14": rsi_14, "rsi_21": rsi_21,
        "macd": macd_line, "macd_signal": macd_signal, "macd_hist": macd_hist,
        "ppo": ppo_val, "trix_15": trix_15,
        "stoch_k": stoch_k, "stoch_d": stoch_d,
        "willr": willr, "cci_20": cci_20,
        "roc_10": roc_10, "roc_20": roc_20,
        "mfi_14": mfi_14,
        # Volatility
        "atr_7": atr_7, "atr_14": atr_14, "atr_21": atr_21,
        "bb_upper": bb_upper, "bb_lower": bb_lower,
        "bb_width": bb_width, "bb_pct": bb_pct, "std_20": std_20,
        # Trend
        "adx_14": adx_14, "adx_pos": adx_pos, "adx_neg": adx_neg,
        # Volume
        "cmf_20": cmf_20,
        # Price levels
        "high_52w": high_52w, "low_52w": low_52w,
        "pct_from_52w_high": pct_from_52w_high, "pct_from_52w_low": pct_from_52w_low,
        # Price change
        "change_1d": change_1d, "change_5d": change_5d, "change_20d": change_20d,
    })


def smart_sync(symbols: list[str], candle_days: int, job_id: str) -> None:
    """
    Per-symbol incremental sync:
      1. Check MAX(date) already in stock_ohlcv for each symbol.
      2. Fetch only the missing date range from yfinance (.NS suffix).
      3. Upsert into stock_ohlcv.
      4. Recompute technical indicators and upsert latest row into stock_technical_cache.
    Progress is stored in _SYNC_JOBS[job_id] for polling.
    """
    import yfinance as yf

    db = get_db()
    today = date.today()
    # Buffer: extra days before the requested window for indicator warm-up (SMA200 needs 200+ rows)
    warmup_days = max(220, candle_days + 30)
    required_from = today - timedelta(days=warmup_days)

    _SYNC_JOBS[job_id] = {
        "done": 0, "total": len(symbols),
        "status": "running", "current": "",
    }

    for sym in symbols:
        _SYNC_JOBS[job_id]["current"] = sym
        try:
            row = db.execute(
                "SELECT MAX(date), MIN(date) FROM stock_ohlcv WHERE symbol = ?", [sym]
            ).fetchone()
            max_date_raw = row[0] if row and row[0] else None
            min_date_raw = row[1] if row and row[1] else None

            if max_date_raw is None:
                # No data at all — fetch full requested range
                fetch_from: Optional[date] = required_from
                fetch_to = today
            else:
                max_date = (
                    max_date_raw if isinstance(max_date_raw, date)
                    else date.fromisoformat(str(max_date_raw))
                )
                min_date = (
                    min_date_raw if isinstance(min_date_raw, date)
                    else date.fromisoformat(str(min_date_raw))
                )
                if max_date >= today and min_date <= required_from:
                    fetch_from = None  # already covers full requested range
                    fetch_to = today
                elif min_date > required_from:
                    # Need to backfill: existing data starts too late
                    fetch_from = required_from
                    fetch_to = today  # also picks up any forward gap
                else:
                    # Just fetch recent missing data forward
                    fetch_from = max_date + timedelta(days=1)
                    fetch_to = today

            if fetch_from is not None and fetch_from <= today:
                hist = yf.Ticker(f"{sym}.NS").history(
                    start=fetch_from.isoformat(),
                    end=(fetch_to + timedelta(days=1)).isoformat(),
                    auto_adjust=True,
                )
                if not hist.empty:
                    hist = hist.reset_index()
                    df_ohlcv = pd.DataFrame({
                        "date":   pd.to_datetime(hist["Date"]).dt.date,
                        "symbol": sym,
                        "open":   hist["Open"].astype(float),
                        "high":   hist["High"].astype(float),
                        "low":    hist["Low"].astype(float),
                        "close":  hist["Close"].astype(float),
                        "volume": hist["Volume"].astype("int64"),
                    }).dropna(subset=["close"])
                    if not df_ohlcv.empty:
                        db.register("_ohlcv_tmp", df_ohlcv)
                        db.execute("INSERT OR REPLACE INTO stock_ohlcv SELECT * FROM _ohlcv_tmp")
                        db.unregister("_ohlcv_tmp")

            # Recompute indicators from all available rows for this symbol
            raw = db.execute("""
                SELECT date, open, high, low, close, volume
                FROM stock_ohlcv WHERE symbol = ?
                ORDER BY date ASC
            """, [sym]).df()

            if len(raw) >= 5:
                latest_date = raw["date"].iloc[-1]
                indic = _compute_indicators(raw)
                cache_row = pd.DataFrame([{
                    "symbol":      sym,
                    "date":        latest_date,
                    **indic.to_dict(),
                }])
                db.register("_tech_tmp", cache_row)
                cols = ", ".join(cache_row.columns)
                db.execute(f"INSERT OR REPLACE INTO stock_technical_cache ({cols}) SELECT {cols} FROM _tech_tmp")
                db.unregister("_tech_tmp")

        except Exception:
            pass  # one symbol failing must not abort the whole job

        _SYNC_JOBS[job_id]["done"] += 1

    _SYNC_JOBS[job_id]["status"] = "complete"
    _SYNC_JOBS[job_id]["current"] = ""
