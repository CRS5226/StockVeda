"""Tests for the NSDL FPI archive sync and the FII/DII feature join."""

from datetime import date

import duckdb
import pandas as pd

from backend.data_sync import sync_fpi
from backend.data_sync.sync_fpi import _month_ends, _parse_archive


def _row(d, kind, route, buy, sell, net):
    return f"<tr><td>{d}</td><td>{kind}</td><td>{route}</td><td>{buy}</td><td>{sell}</td><td>{net}</td><td>1</td><td>Rs.95</td><td></td></tr>"


# Trimmed copy of the real archive table: per-day blocks, then month/year totals.
SAMPLE = "<html><body><table>" + "".join([
    _row("Reporting Date", "Debt/Equity", "Investment Route", "Gross Purchases", "Gross Sales", "Net Investment"),
    _row("03-Aug-2026", "Equity", "Stock Exchange", "20284.98", "19290.02", "994.96"),
    _row("03-Aug-2026", "Equity", "Primary market &amp; others", "356.06", "0.00", "356.06"),
    _row("03-Aug-2026", "Equity", "Sub-total", "20641.04", "19290.02", "1351.02"),
    _row("03-Aug-2026", "Debt-General Limit", "Stock Exchange", "902.93", "1193.93", "(291.00)"),
    _row("04-Aug-2026", "Equity", "Stock Exchange", "11,843.89", "13,258.75", "(1,414.86)"),
    _row("Total for August", "Equity", "Stock Exchange", "32128.87", "32548.77", "(419.90)"),
    _row("Total for 2026", "Equity", "Stock Exchange", "1.00", "2.00", "(1.00)"),
]) + "</table></body></html>"


def test_parse_keeps_daily_equity_exchange_rows_only():
    df = _parse_archive(SAMPLE)
    assert list(df.columns) == ["date", "buy", "sell", "net"]
    assert list(df["date"]) == [date(2026, 8, 3), date(2026, 8, 4)]  # totals and debt dropped
    assert df.loc[0, "net"] == 994.96


def test_parse_reads_bracketed_negatives_with_commas():
    row = _parse_archive(SAMPLE).iloc[1]
    assert (row["buy"], row["sell"], row["net"]) == (11843.89, 13258.75, -1414.86)


def test_month_ends_caps_last_month_and_crosses_year():
    assert _month_ends(date(2025, 11, 20), date(2026, 2, 10)) == [
        date(2025, 11, 30), date(2025, 12, 31), date(2026, 1, 31), date(2026, 2, 10),
    ]


class _Client:
    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


def _run(monkeypatch, months):
    """Run sync_fpi.run over `months` (as_of -> html, or an Exception); return the log_sync call."""
    logged = {}
    monkeypatch.setattr(sync_fpi, "last_synced_date", lambda _: date(2026, 7, 20))
    monkeypatch.setattr(sync_fpi, "_month_ends", lambda *_: list(months))
    monkeypatch.setattr(sync_fpi, "get_client", lambda: _Client())

    def fetch(_, as_of):
        if isinstance(months[as_of], Exception):
            raise months[as_of]
        return months[as_of]

    monkeypatch.setattr(sync_fpi, "_fetch_month", fetch)
    monkeypatch.setattr(sync_fpi, "upsert_df", lambda df, _: len(df))
    monkeypatch.setattr(sync_fpi, "log_sync", lambda *a: logged.update(args=a))
    sync_fpi.run()
    return logged["args"]


def _month(d):
    return SAMPLE.replace("-Aug-2026", d.strftime("-%b-%Y"))


def test_bookmark_stops_before_failed_month(monkeypatch):
    jul, aug, sep = date(2026, 7, 31), date(2026, 8, 31), date(2026, 9, 24)
    source, status, count, bookmark, error = _run(monkeypatch, {
        jul: _month(jul), aug: RuntimeError("HTTP 500"), sep: _month(sep),
    })
    assert bookmark == date(2026, 7, 4)  # August is refetched next run
    assert status == "partial" and "Aug 2026" in error
    assert count == 4  # September's rows are still saved


def test_all_months_failing_is_logged_as_failed(monkeypatch):
    source, status, count, bookmark, error = _run(monkeypatch, {date(2026, 9, 24): RuntimeError("HTTP 404")})
    assert status == "failed" and count == 0
    assert bookmark == date(2026, 7, 20)  # previous bookmark kept


def test_attach_fii_dii_reads_fii_from_nsdl_and_dii_from_nse(monkeypatch):
    from backend.core import ml_backtest as mlb

    db = duckdb.connect()
    days = pd.bdate_range("2026-08-03", periods=6).date
    db.execute("CREATE TABLE fpi_flows (date DATE, buy DOUBLE, sell DOUBLE, net DOUBLE)")
    db.executemany("INSERT INTO fpi_flows VALUES (?, 0, 0, ?)", [(d, i + 1.0) for i, d in enumerate(days)])
    db.execute("CREATE TABLE fii_dii_flows (date DATE, fii_buy DOUBLE, fii_sell DOUBLE, fii_net DOUBLE,"
               " dii_buy DOUBLE, dii_sell DOUBLE, dii_net DOUBLE)")
    db.execute("INSERT INTO fii_dii_flows VALUES (?, 0, 0, 999, 0, 0, 50)", [days[-1]])
    monkeypatch.setattr("backend.db.connection.get_db", lambda: db)

    out = mlb.attach_fii_dii(pd.DataFrame({"date": [str(d) for d in days], "close": 1.0}))
    assert list(out["fii_net"]) == [1, 2, 3, 4, 5, 6]  # NSDL, not NSE's 999
    assert out["fii_net_5d"].iloc[-1] == 2 + 3 + 4 + 5 + 6
    assert out["dii_net_5d"].isna().all()  # one NSE day is not enough for a 5-day sum
    assert len(out) == len(days)


def test_attach_fii_dii_handles_empty_tables(monkeypatch):
    from backend.core import ml_backtest as mlb

    db = duckdb.connect()
    db.execute("CREATE TABLE fpi_flows (date DATE, buy DOUBLE, sell DOUBLE, net DOUBLE)")
    db.execute("CREATE TABLE fii_dii_flows (date DATE, fii_buy DOUBLE, fii_sell DOUBLE, fii_net DOUBLE,"
               " dii_buy DOUBLE, dii_sell DOUBLE, dii_net DOUBLE)")
    monkeypatch.setattr("backend.db.connection.get_db", lambda: db)

    out = mlb.attach_fii_dii(pd.DataFrame({"date": ["2026-08-03"], "close": [1.0]}))
    assert out[["fii_net", "fii_net_5d", "dii_net_5d"]].isna().all().all()
