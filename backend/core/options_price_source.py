"""
Shared helper: pick the price series used as the "underlying reference" for
options-strategy strike selection and P&L, per data_source toggle.

IMPORTANT: this only changes which price is treated as "the underlying" for
ATM/offset selection and P&L mark-to-market. It does NOT change which strikes
exist in the option chain — NSE lists strikes relative to true spot regardless
of what reference price a backtest uses. Route/UI layers must disclose this.
"""

import pandas as pd

from backend.core.fno_signals import _get_spot_series
from backend.core.futures_continuous import build_continuous_futures


def get_price_series(sym: str, from_date: str, to_date: str, data_source: str = "cash") -> pd.DataFrame:
    """Returns a DataFrame with ['date', 'close'] columns.
    data_source='futures' -> continuous roll-adjusted near-month futures close,
    falling back to cash if no futures data is synced for this symbol/range.
    data_source='cash' (default) -> true spot/cash close via _get_spot_series."""
    if data_source == "futures":
        fut = build_continuous_futures(sym, from_date, to_date)
        if not fut.empty:
            return fut[["date", "close"]]
    return _get_spot_series(sym, from_date, to_date)
