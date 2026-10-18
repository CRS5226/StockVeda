"""
Chart timeframes (1m … 1M) built from the stored bars.

Only 1m/5m/15m/30m/60m intraday bars and daily bars are stored. 4h is built from the
60m bars (NSE session buckets), 1W / 1M from the daily bars. Each timeframe also knows
roughly how many bars a trading day holds, which converts a date range to a candle
count and sizes the "missing data" estimate shown before a fetch.
"""

from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Optional

import numpy as np
import pandas as pd

from backend.data_sync.sync_intraday import MAX_LOOKBACK_DAYS

# NSE cash session is 09:15–15:30. The second 4h bucket starts at 13:15.
_SESSION_SPLIT_MIN = 13 * 60 + 15


@dataclass(frozen=True)
class Timeframe:
    label: str
    source: str            # "intraday" (stock_intraday_ohlcv) or "daily" (stock_ohlcv)
    base_interval: str     # stored interval to read/fetch ("daily" for the daily table)
    bars_per_day: float    # trading-day density, used for estimates only
    resample: Optional[str] = None  # None, "4h", "W" or "M"
    # Calendar slack (weekdays) before the stored data counts as not reaching the request.
    gap_tolerance_days: int = 3

    @property
    def max_lookback_days(self) -> Optional[int]:
        return MAX_LOOKBACK_DAYS.get(self.base_interval) if self.source == "intraday" else None


TIMEFRAMES: dict[str, Timeframe] = {
    "1m":  Timeframe("1m",  "intraday", "1m",  375),
    "5m":  Timeframe("5m",  "intraday", "5m",  75),
    "15m": Timeframe("15m", "intraday", "15m", 25),
    "30m": Timeframe("30m", "intraday", "30m", 13),
    "1h":  Timeframe("1h",  "intraday", "60m", 7),
    "4h":  Timeframe("4h",  "intraday", "60m", 2, resample="4h"),
    "1D":  Timeframe("1D",  "daily",    "1d",  1),
    "1W":  Timeframe("1W",  "daily",    "1d",  0.2, resample="W", gap_tolerance_days=5),
    "1M":  Timeframe("1M",  "daily",    "1d",  1 / 21, resample="M", gap_tolerance_days=23),
}

_OHLCV_AGG = {"open": "first", "high": "max", "low": "min", "close": "last", "volume": "sum"}


def resample_ohlcv(df: pd.DataFrame, rule: Optional[str]) -> pd.DataFrame:
    """Aggregate `date`-indexed bars into 4h / weekly / monthly bars. Each output bar is
    stamped with the timestamp of its first source bar, so it lines up with the real data
    (weeks and months that start on a holiday are not stamped on a non-trading day)."""
    if rule is None or df.empty:
        return df
    df = df.sort_values("date").reset_index(drop=True)
    d = pd.to_datetime(df["date"])
    if rule == "4h":
        minutes = d.dt.hour * 60 + d.dt.minute
        key = [d.dt.normalize(), (minutes >= _SESSION_SPLIT_MIN).astype(int)]
    elif rule == "W":
        key = [d.dt.to_period("W")]
    elif rule == "M":
        key = [d.dt.to_period("M")]
    else:
        raise ValueError(f"Unknown resample rule: {rule}")
    out = df.assign(date=d).groupby(key, sort=True).agg({"date": "first", **_OHLCV_AGG})
    return out.reset_index(drop=True)


def _load_source(db, symbol: str, tf: Timeframe) -> pd.DataFrame:
    if tf.source == "intraday":
        df = db.execute(
            """SELECT datetime AS date, open, high, low, close, volume FROM stock_intraday_ohlcv
               WHERE symbol = ? AND interval = ? ORDER BY datetime""",
            [symbol, tf.base_interval],
        ).df()
    else:
        df = db.execute(
            "SELECT date, open, high, low, close, volume FROM stock_ohlcv WHERE symbol = ? ORDER BY date",
            [symbol],
        ).df()
    if not df.empty:
        df["date"] = pd.to_datetime(df["date"])
    return df


def _weekdays_between(start: date, end: date) -> int:
    if end <= start:
        return 0
    return int(np.busday_count(start, end))


def _missing_estimate(tf: Timeframe, earliest: Optional[datetime], latest: Optional[datetime],
                      from_date: date, to_date: date) -> dict:
    """Bars the request needs beyond what is stored, estimated from weekday counts. The
    far end is clamped to what the data source can supply, so the number is always fetchable."""
    today = date.today()
    to_date = min(to_date, today)
    if tf.max_lookback_days:
        from_date = max(from_date, today - timedelta(days=tf.max_lookback_days))
    if from_date > to_date:
        return {"before": 0, "after": 0, "total": 0}

    if earliest is None:
        total = round(_weekdays_between(from_date, to_date + timedelta(days=1)) * tf.bars_per_day)
        return {"before": total, "after": 0, "total": total}

    before = after = 0
    gap_before = _weekdays_between(from_date, earliest.date())
    if gap_before > tf.gap_tolerance_days:
        before = round(gap_before * tf.bars_per_day)
    gap_after = _weekdays_between(latest.date(), to_date)
    if gap_after > tf.gap_tolerance_days:
        after = round(gap_after * tf.bars_per_day)
    return {"before": before, "after": after, "total": before + after}


def load_candles(db, symbol: str, tf_name: str, from_date: Optional[date], to_date: Optional[date],
                 limit: Optional[int]) -> dict:
    tf = TIMEFRAMES[tf_name]
    full = resample_ohlcv(_load_source(db, symbol, tf), tf.resample)

    earliest = full["date"].iloc[0].to_pydatetime() if not full.empty else None
    latest = full["date"].iloc[-1].to_pydatetime() if not full.empty else None

    bars = full
    if from_date:
        bars = bars[bars["date"] >= pd.Timestamp(from_date)]
    if to_date:
        bars = bars[bars["date"] < pd.Timestamp(to_date) + pd.Timedelta(days=1)]
    if limit:
        bars = bars.tail(limit)

    # With only a candle count the range start is wherever that many bars begin.
    want_from = from_date or (bars["date"].iloc[0].date() if not bars.empty else date.today())
    want_to = to_date or date.today()
    clamped_from = None
    if tf.max_lookback_days and from_date and from_date < date.today() - timedelta(days=tf.max_lookback_days):
        clamped_from = date.today() - timedelta(days=tf.max_lookback_days)

    intraday = tf.source == "intraday"
    fmt = "%Y-%m-%d %H:%M:%S" if intraday else "%Y-%m-%d"
    records = [
        {"date": r.date.strftime(fmt), "open": float(r.open), "high": float(r.high),
         "low": float(r.low), "close": float(r.close), "volume": int(r.volume or 0)}
        for r in bars.itertuples(index=False)
    ]
    return {
        "interval": tf_name,
        "bars": records,
        "status": {
            "earliest": earliest.strftime(fmt) if earliest else None,
            "latest": latest.strftime(fmt) if latest else None,
            "total_bars": len(full),
        },
        "missing": _missing_estimate(tf, earliest, latest, want_from, want_to),
        "clamped_from": clamped_from.isoformat() if clamped_from else None,
        "max_lookback_days": tf.max_lookback_days,
        "fetch": {
            "kind": tf.source,
            "interval": tf.base_interval,
            "days": max(1, (date.today() - max(want_from, clamped_from or want_from)).days + 1),
        },
    }
