"""Tests for holder-name matching, the ownership graph and the promoter group. In-memory tables, no network."""

from datetime import date

import duckdb
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.core import ownership_graph as og
from backend.routes import connections

P = date(2026, 9, 30)


@pytest.mark.parametrize("a,b", [
    ("Tata Investment Corporation Ltd", "Tata Investment Corporation Limited"),
    ("The Tata Power Company Limited", "Tata Power Company Ltd."),
    ("Tata Motors Passenger Vehicles Limited (formerly known as Tata Motors Limited)", "TATA MOTORS PASSENGER VEHICLES LTD"),
    ("Procter & Gamble", "Procter and Gamble"),
    ("LIC of India", "Life Insurance Corporation Of India"),
])
def test_holder_key_treats_spelling_variants_as_equal(a, b):
    assert og.holder_key(a) == og.holder_key(b)


def test_holder_key_keeps_different_companies_apart_and_handles_empty():
    assert og.holder_key("Tata Steel Limited") != og.holder_key("Tata Steel Long Products Limited")
    assert og.holder_key(None) == "" and og.holder_key("  ") == ""


@pytest.fixture
def con(monkeypatch):
    c = duckdb.connect(":memory:")
    c.execute("CREATE TABLE shareholders (symbol VARCHAR, period DATE, holder_name VARCHAR, holder_group VARCHAR, category VARCHAR, shares BIGINT, pct DOUBLE)")
    c.execute("CREATE TABLE holder_matches (holder_name VARCHAR PRIMARY KEY, holder_key VARCHAR, symbol VARCHAR)")
    c.execute("CREATE TABLE nse_symbols (symbol VARCHAR PRIMARY KEY, company_name VARCHAR, series VARCHAR, isin VARCHAR, face_value DOUBLE)")
    c.executemany("INSERT INTO nse_symbols VALUES (?, ?, 'EQ', NULL, 1)", [
        ("TCS", "Tata Consultancy Services Limited"), ("TATASTEEL", "Tata Steel Limited"),
        ("TITAN", "Titan Company Limited"), ("AMBIG1", "Twin Name Limited"), ("AMBIG2", "Twin Name Ltd")])
    rows = [
        # TCS: promoter Tata Sons (unlisted) 72%, Tata Steel (listed) 1.5%, a fund 5%
        ("TCS", P, "Tata Sons Private Limited", "promoter", "Bodies Corporate", 1, 72.0),
        ("TCS", P, "Tata Steel Ltd", "public", "Bodies Corporate", 1, 1.5),
        ("TCS", P, "Some Fund", "public", "Mutual Funds", 1, 5.0),
        ("TCS", P, "Tiny Holder", "public", "Others", 1, 0.2),
        ("TCS", date(2026, 6, 30), "Old Quarter Holder", "public", "Others", 1, 9.0),
        # TATASTEEL: Tata Sons 31%
        ("TATASTEEL", P, "Tata Sons Private Limited", "promoter", "Bodies Corporate", 1, 31.0),
        # TITAN: Tata Sons 25%, Tata Steel? no
        ("TITAN", P, "TATA SONS PVT LTD", "promoter", "Bodies Corporate", 1, 25.0),
        ("TITAN", P, "Twin Name Limited", "public", "Others", 1, 3.0),
    ]
    c.executemany("INSERT INTO shareholders VALUES (?, ?, ?, ?, ?, 1, ?)", [(r[0], r[1], r[2], r[3], r[4], r[6]) for r in rows])
    for mod in (og,):
        monkeypatch.setattr(mod, "get_db", lambda c=c: c)
    return c


def test_refresh_matches_exact_only_and_skips_ambiguous(con):
    matched = og.refresh_holder_matches(con)
    got = dict(con.execute("SELECT holder_name, symbol FROM holder_matches").fetchall())
    assert got["Tata Steel Ltd"] == "TATASTEEL"          # Ltd vs Limited
    assert got["Tata Sons Private Limited"] is None       # not a listed company
    assert got["Twin Name Limited"] is None               # two listed companies share the key
    assert matched == 1


def test_graph_has_holders_and_holdings_with_edges_from_holder_to_held(con):
    g = og.ownership_graph("tcs")
    ids = {n["id"] for n in g["nodes"]}
    assert {"TCS", "TATASTEEL", "holder:TATA SONS"} <= ids
    edges = {(e["source"], e["target"]): e["pct"] for e in g["edges"]}
    assert edges[("holder:TATA SONS", "TCS")] == 72.0
    assert edges[("TATASTEEL", "TCS")] == 1.5            # Tata Steel holds TCS
    assert not any("Tiny" in (n.get("label") or "") for n in g["nodes"])     # below the 1% cut
    assert not any("Old Quarter" in (n.get("label") or "") for n in g["nodes"])  # older filing ignored
    assert g["as_of"] == "2026-09-30"


def test_graph_shows_what_a_company_holds(con):
    g = og.ownership_graph("TATASTEEL")
    edges = {(e["source"], e["target"]): e["pct"] for e in g["edges"]}
    assert edges[("TATASTEEL", "TCS")] == 1.5            # as a holder in TCS's filing


def test_depth_two_adds_neighbours_of_listed_neighbours(con):
    one = {n["id"] for n in og.ownership_graph("TCS", depth=1)["nodes"]}
    two = {n["id"] for n in og.ownership_graph("TCS", depth=2)["nodes"]}
    assert "holder:TATA SONS" in two and one <= two
    assert og.ownership_graph("TCS", depth=9)["depth"] == 2  # clamped


def test_promoter_group_lists_other_companies_with_the_same_holder(con):
    g = og.ownership_graph("TCS")["group"]
    assert len(g) == 1 and g[0]["holder"] == "Tata Sons Private Limited"
    assert [c["symbol"] for c in g[0]["companies"]] == ["TATASTEEL", "TITAN"]  # biggest first; spelling variants match
    assert g[0]["companies"][0]["name"] == "Tata Steel Limited"


def test_unknown_symbol_is_none_and_route(con):
    assert og.ownership_graph("ZZZ") is None
    app = FastAPI()
    app.include_router(connections.router)
    client = TestClient(app)
    ok = client.get("/stock/TCS/ownership-graph?depth=2")
    assert ok.status_code == 200 and ok.json()["edges"]
    assert client.get("/stock/ZZZ/ownership-graph").status_code == 404
