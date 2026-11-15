"""Tests for the shareholder XBRL parser, the sync and the route. A small synthetic filing, no network."""

from datetime import date

import duckdb
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.core import shareholders as sh
from backend.data_sync import sync_shareholders as sync
from backend.routes import connections

NS = sh.XBRL_NS


def _holder(ctx, name, shares, pct, promoter=False, category_field=None):
    extra = '<in-bse-shp:TypeOfPromoterShareholding contextRef="D_%s">******</in-bse-shp:TypeOfPromoterShareholding>' % ctx if promoter else ""
    cat = '<in-bse-shp:CategoryOfOtherIndianShareholders contextRef="D_%s">%s</in-bse-shp:CategoryOfOtherIndianShareholders>' % (ctx, category_field) if category_field else ""
    pct_tag = f'<in-bse-shp:ShareholdingAsAPercentageOfTotalNumberOfShares contextRef="{ctx}">{pct}</in-bse-shp:ShareholdingAsAPercentageOfTotalNumberOfShares>' if pct is not None else ""
    return (f'<in-bse-shp:NameOfTheShareholder contextRef="D_{ctx}">{name}</in-bse-shp:NameOfTheShareholder>{cat}{extra}'
            f'<in-bse-shp:NumberOfShares contextRef="{ctx}">{shares}</in-bse-shp:NumberOfShares>{pct_tag}')


SAMPLE = (f'<xbrli:xbrl xmlns:xbrli="http://www.xbrl.org/2003/instance" xmlns:in-bse-shp="{NS}">'
          + _holder("IndividualsOrHUF_Context1", "Founder One", 1000, 0.25, promoter=True)
          + _holder("OthersIndianShareholders_Context2", "Holding Co Pvt Ltd", 600, 0.15, promoter=True, category_field="Bodies Corporate")
          + _holder("MutualFundsOrUTI_Context3", "Big Mutual Fund", 200, 0.05)
          + _holder("CustodianOrDRHolder_Context4", "DR Bank", 50, None)
          + '<in-bse-shp:NumberOfShares contextRef="OtherContext">9</in-bse-shp:NumberOfShares>'
          + "</xbrli:xbrl>")


def test_parse_shareholders_groups_categories_and_percent():
    rows = {r["holder_name"]: r for r in sh.parse_shareholders(SAMPLE)}
    assert set(rows) == {"Founder One", "Holding Co Pvt Ltd", "Big Mutual Fund", "DR Bank"}
    assert rows["Founder One"] == {"holder_name": "Founder One", "holder_group": "promoter",
                                   "category": "Individuals Or HUF", "shares": 1000, "pct": 25.0}
    assert rows["Holding Co Pvt Ltd"]["category"] == "Bodies Corporate"  # the filing's own label wins
    assert rows["Big Mutual Fund"]["holder_group"] == "public"
    assert rows["DR Bank"]["pct"] is None and rows["DR Bank"]["shares"] == 50


def test_parse_shareholders_bad_xml_is_empty():
    assert sh.parse_shareholders("<not xml") == []
    assert sh.parse_shareholders("<a/>") == []


def test_parse_period_and_filings_from_master_keep_latest_with_xbrl():
    assert sync.parse_period("30-SEP-2026") == date(2026, 9, 30)
    assert sync.parse_period("garbage") is None
    records = [
        {"symbol": "abc", "date": "30-SEP-2026", "xbrl": "http://x/abc.xml"},
        {"symbol": "NOXBRL", "date": "30-SEP-2026", "xbrl": None},
        {"symbol": "BADDATE", "date": "?", "xbrl": "http://x/b.xml"},
    ]
    assert sync.filings_from_master(records) == [{"symbol": "ABC", "period": date(2026, 9, 30), "url": "http://x/abc.xml"}]


@pytest.fixture
def con(monkeypatch):
    c = duckdb.connect(":memory:")
    c.execute("CREATE TABLE shareholders (symbol VARCHAR, period DATE, holder_name VARCHAR, holder_group VARCHAR, category VARCHAR, shares BIGINT, pct DOUBLE)")
    c.execute("CREATE TABLE stock_ohlcv (date DATE, symbol VARCHAR, close DOUBLE, volume BIGINT)")
    c.execute("CREATE TABLE sync_log (source VARCHAR PRIMARY KEY, last_synced_at TIMESTAMP, last_date_fetched DATE, status VARCHAR, records_added INTEGER, error_message VARCHAR)")
    for mod in (sync, sh):
        monkeypatch.setattr(mod, "get_db", lambda c=c: c)
    monkeypatch.setattr("backend.data_sync.base.get_db", lambda: c)
    return c


Q3, Q2 = date(2026, 9, 30), date(2026, 6, 30)


def test_filings_to_fetch_skips_stored_and_empty_and_orders_by_traded_value(con):
    for sym, value in [("BIG", 900.0), ("SMALL", 10.0), ("DONE", 500.0), ("EMPTY", 800.0), ("NEWQ", 100.0)]:
        con.execute("INSERT INTO stock_ohlcv VALUES ('2026-11-13', ?, ?, 1)", [sym, value])
    con.execute("INSERT INTO shareholders VALUES ('DONE', ?, 'X', 'public', 'c', 1, 1.0)", [Q3])
    con.execute("INSERT INTO shareholders VALUES ('NEWQ', ?, 'X', 'public', 'c', 1, 1.0)", [Q2])  # older quarter stored
    con.execute("INSERT INTO sync_log VALUES ('shareholders:EMPTY', now(), ?, 'empty', 0, NULL)", [Q3])
    filings = [{"symbol": s, "period": Q3, "url": f"http://x/{s}"} for s in ("BIG", "SMALL", "DONE", "EMPTY", "NEWQ")]
    assert [f["symbol"] for f in sync.filings_to_fetch(filings, 10)] == ["BIG", "NEWQ", "SMALL"]
    assert [f["symbol"] for f in sync.filings_to_fetch(filings, 1)] == ["BIG"]


def test_store_filing_replaces_only_that_period(con):
    sync.store_filing("ABC", Q3, sh.parse_shareholders(SAMPLE))
    sync.store_filing("ABC", Q2, sh.parse_shareholders(SAMPLE)[:1])
    sync.store_filing("ABC", Q3, sh.parse_shareholders(SAMPLE)[:2])  # re-run of the same quarter
    counts = dict(con.execute("SELECT period, COUNT(*) FROM shareholders GROUP BY period").fetchall())
    assert counts == {Q3: 2, Q2: 1}


def test_run_stores_holders_marks_empty_and_retries_failures(con, monkeypatch):
    for sym in ("OK", "EMPTYF", "BROKEN"):
        con.execute("INSERT INTO stock_ohlcv VALUES ('2026-11-13', ?, 1, 1)", [sym])

    class Master:
        def raise_for_status(self): pass
        def json(self):
            return [{"symbol": s, "date": "30-SEP-2026", "xbrl": f"http://x/{s}.xml"} for s in ("OK", "EMPTYF", "BROKEN")]

    class Resp:
        def __init__(self, text, status=200): self.text, self.status = text, status
        def raise_for_status(self):
            if self.status >= 400:
                raise RuntimeError(f"HTTP {self.status}")

    class Client:
        def __init__(self, *a, **k): pass
        def __enter__(self): return self
        def __exit__(self, *a): return False
        def get(self, url):
            return {"http://x/OK.xml": Resp(SAMPLE), "http://x/EMPTYF.xml": Resp("<a/>")}.get(url, Resp("", 503))

    logged = []
    monkeypatch.setattr(sync, "nse_get", lambda url, params=None: Master())
    monkeypatch.setattr(sync.httpx, "Client", Client)
    monkeypatch.setattr(sync.time, "sleep", lambda s: None)
    monkeypatch.setattr(sync, "log_sync", lambda *a, **k: logged.append(a))
    monkeypatch.setattr(sync, "refresh_holder_matches", lambda: 0)
    assert sync.run() == 4
    assert {r[0] for r in con.execute("SELECT symbol FROM shareholders").fetchall()} == {"OK"}
    assert ("shareholders:EMPTYF", "empty", 0, Q3) in logged
    assert logged[-1][1] == "partial" and "BROKEN" in logged[-1][4]


def test_route_returns_latest_period_biggest_first_and_404(con):
    sync.store_filing("ABC", Q2, sh.parse_shareholders(SAMPLE)[:1])
    sync.store_filing("ABC", Q3, sh.parse_shareholders(SAMPLE))
    app = FastAPI()
    app.include_router(connections.router)
    client = TestClient(app)
    body = client.get("/stock/abc/shareholders").json()
    assert body["period"] == "2026-09-30"
    assert [h["holder_name"] for h in body["holders"]] == ["Founder One", "Holding Co Pvt Ltd", "Big Mutual Fund", "DR Bank"]
    assert client.get("/stock/ZZZ/shareholders").status_code == 404
