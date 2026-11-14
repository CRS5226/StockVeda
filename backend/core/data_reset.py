"""Reset Data: wipe every stored candle and bhavcopy table so the next sync starts from scratch."""

# Tables filled by the bhavcopy and index syncs and by the intraday fetches.
CANDLE_TABLES = (
    "stock_ohlcv",            # daily stock candles (NSE equity bhavcopy, Yahoo backfills)
    "stock_delivery",         # delivery data from the same bhavcopy files
    "stock_intraday_ohlcv",   # 1m / 5m / 15m ... candles
    "index_ohlcv",            # index daily candles
    "stock_technical_cache",  # indicators computed from the candles
)

# Sync bookmarks of the jobs above. Left in place, an incremental sync would resume after the deleted history.
SYNC_SOURCES = ("nse_bhavcopy_equity", "nse_index_close_all", "nse_index_close_sectoral")


def reset_market_data(db) -> dict[str, int]:
    """Delete all rows of the candle tables and the bookmarks of their syncs. Returns rows removed per table.

    Watchlists, saved screeners, plotted trades, drawings and the other data sources are not touched.
    """
    removed: dict[str, int] = {}
    for table in CANDLE_TABLES:
        removed[table] = db.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
        db.execute(f"DELETE FROM {table}")
    marks = ",".join("?" for _ in SYNC_SOURCES)
    db.execute(f"DELETE FROM sync_log WHERE source IN ({marks})", list(SYNC_SOURCES))
    return removed
