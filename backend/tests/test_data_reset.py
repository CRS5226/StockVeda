"""Reset Data deletes every candle and bhavcopy table and the sync bookmarks, and nothing else."""

from pathlib import Path

import duckdb

from backend.core.data_reset import CANDLE_TABLES, reset_market_data
from backend.db import connection

SCHEMA = (Path(connection.__file__).parent / "schema.sql").read_text()


def test_reset_clears_candles_and_bookmarks_but_keeps_everything_else():
    db = duckdb.connect()
    db.execute(SCHEMA)
    db.execute("INSERT INTO stock_ohlcv VALUES ('2026-01-01', 'TCS', 1, 2, 1, 2, 10)")
    db.execute("INSERT INTO stock_delivery VALUES ('2026-01-01', 'TCS', 5, 50)")
    db.execute("INSERT INTO stock_intraday_ohlcv VALUES ('2026-01-01 09:15:00', 'TCS', '5m', 1, 2, 1, 2, 10)")
    db.execute("INSERT INTO index_ohlcv VALUES ('2026-01-01', 'NIFTY 50', 1, 2, 1, 2)")
    db.execute("INSERT INTO sync_log (source, last_date_fetched) VALUES ('nse_bhavcopy_equity', '2026-01-01'), ('india_vix', '2026-01-01')")
    db.execute("INSERT INTO watchlists (id, name) VALUES (1, 'mine')")
    db.execute("INSERT INTO chart_drawings (id, symbol, kind, time1, price1, time2, price2) VALUES (1, 'TCS', 'rect', '2026-01-01', 1, '2026-01-02', 2)")

    removed = reset_market_data(db)

    assert removed["stock_ohlcv"] == 1 and removed["index_ohlcv"] == 1 and removed["stock_intraday_ohlcv"] == 1
    for table in CANDLE_TABLES:
        assert db.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0] == 0
    # the bookmark of a cleared source is gone (so the next sync starts over); other sources keep theirs
    assert [r[0] for r in db.execute("SELECT source FROM sync_log").fetchall()] == ["india_vix"]
    assert db.execute("SELECT COUNT(*) FROM watchlists").fetchone()[0] == 1
    assert db.execute("SELECT COUNT(*) FROM chart_drawings").fetchone()[0] == 1
