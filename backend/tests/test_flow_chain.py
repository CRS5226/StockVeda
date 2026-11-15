"""Tests for the flow chain map and the lookup around one stock. In-memory tables, no network."""

import duckdb
import numpy as np
import pandas as pd
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.core import flow_chain as fc
from backend.routes import connections


def test_every_chain_is_well_formed():
    ids = [c["id"] for c in fc.CHAINS]
    assert len(ids) == len(set(ids)) >= 5
    for chain in fc.CHAINS:
        node_ids = [n["id"] for n in chain["nodes"]]
        assert len(node_ids) == len(set(node_ids)), chain["id"]
        for a, b in chain["edges"]:
            assert a in node_ids and b in node_ids and a != b, (chain["id"], a, b)
        # No industry sits in two steps of one chain, or the "current step" would be ambiguous.
        industries = [i for n in chain["nodes"] for i in n["industries"]]
        assert len(industries) == len(set(industries)), chain["id"]
        assert all(i == i.lower().strip() and i for i in industries)
        assert all(n["industries"] for n in chain["nodes"])
        # Edges run forward, so the order function must place every source before its target.
        order = fc._node_order(chain)
        assert all(order.index(a) < order.index(b) for a, b in chain["edges"])


def test_neighbours_and_chains_for_industry():
    energy = next(c for c in fc.CHAINS if c["id"] == "energy")
    assert fc._neighbours(energy["edges"], "refining", forward=False) == {"crude"}
    assert fc._neighbours(energy["edges"], "refining", forward=True) == {"chemicals", "tyres", "transport"}
    assert {c["id"] for c in fc.chains_for_industry("Steel")} >= {"power", "metals"}   # a stock can sit in several chains
    assert fc.chains_for_industry("Banks - Regional") and fc.chains_for_industry("Software - Application") == []
    assert fc.chains_for_industry(None) == []


@pytest.fixture
def con(monkeypatch):
    c = duckdb.connect(":memory:")
    c.execute("CREATE TABLE company_profile (symbol VARCHAR, city VARCHAR, state VARCHAR, pincode VARCHAR, sector VARCHAR, industry VARCHAR, website VARCHAR, employees BIGINT, lat DOUBLE, lon DOUBLE, updated_at TIMESTAMP)")
    c.execute("CREATE TABLE nse_symbols (symbol VARCHAR, company_name VARCHAR, series VARCHAR, isin VARCHAR, face_value DOUBLE)")
    c.execute("CREATE TABLE stock_ohlcv (date DATE, symbol VARCHAR, open DOUBLE, high DOUBLE, low DOUBLE, close DOUBLE, volume BIGINT)")
    profiles = [("RIL", "Energy", "Oil & Gas Refining & Marketing"), ("OIL1", "Energy", "Oil & Gas E&P"),
                ("CHEM1", "Basic Materials", "Specialty Chemicals"), ("CHEM2", "Basic Materials", "Specialty Chemicals"),
                ("AIR1", "Industrials", "Airlines"), ("SOFT", "Technology", "Software - Application"),
                ("NONAME", "Energy", "Oil & Gas Refining & Marketing")]
    c.executemany("INSERT INTO company_profile (symbol, sector, industry) VALUES (?, ?, ?)", profiles)
    c.executemany("INSERT INTO nse_symbols VALUES (?, ?, 'EQ', NULL, 1)", [(s, f"{s} Limited") for s, _, _ in profiles if s != "NONAME"])
    dates = pd.bdate_range(end="2026-11-13", periods=70)
    rows = []
    for sym, price, vol in [("RIL", 100, 1000), ("OIL1", 50, 500), ("CHEM1", 10, 5000), ("CHEM2", 10, 100), ("AIR1", 20, 100), ("SOFT", 5, 1), ("NONAME", 1, 1)]:
        for i, d in enumerate(dates):
            close = float(price * (1 + 0.001 * i))
            rows.append((d.date(), sym, close, close, close, close, vol))
    c.executemany("INSERT INTO stock_ohlcv VALUES (?, ?, ?, ?, ?, ?, ?)", rows)
    monkeypatch.setattr(fc, "get_db", lambda: c)
    return c


def _chain(res, chain_id):
    return next(c for c in res["chains"] if c["id"] == chain_id)


def test_flow_for_marks_roles_and_orders_steps_raw_material_first(con):
    res = fc.flow_for("ril")
    energy = _chain(res, "energy")
    roles = {n["id"]: n["role"] for n in energy["nodes"]}
    assert roles["refining"] == "current" and roles["crude"] == "upstream"
    assert roles["chemicals"] == roles["tyres"] == roles["transport"] == "downstream" and roles["gas"] == "other"
    order = [n["id"] for n in energy["nodes"]]
    assert order.index("crude") < order.index("refining") < order.index("chemicals")
    assert "not company supply contracts" in res["note"]


def test_stocks_are_the_most_traded_per_step_with_returns(con):
    energy = _chain(fc.flow_for("RIL", top_n=1), "energy")
    node = {n["id"]: n for n in energy["nodes"]}
    assert [s["symbol"] for s in node["chemicals"]["stocks"]] == ["CHEM1"]        # 50000 vs 1000 traded
    assert [s["symbol"] for s in node["refining"]["stocks"]] == ["RIL"]
    ril = node["refining"]["stocks"][0]
    assert ril["name"] == "RIL Limited" and ril["return_1m"] is not None and ril["return_3m"] is not None


def test_the_asked_stock_is_always_in_its_own_step_and_missing_names_are_none(con):
    node = {n["id"]: n for n in _chain(fc.flow_for("NONAME", top_n=1), "energy")["nodes"]}
    assert [s["symbol"] for s in node["refining"]["stocks"]] == ["NONAME"]       # RIL trades more, but you asked about NONAME
    assert node["refining"]["stocks"][0]["name"] is None
    assert node["gas"]["stocks"] == []


def test_industries_without_stocks_lists_only_unmatched_names(con):
    missing = fc.industries_without_stocks(con)
    assert "oil & gas refining & marketing" not in missing and "airlines" not in missing
    assert "grocery stores" in missing                      # no such stock in the fixture
    assert missing == sorted(missing)


def test_stock_in_no_chain_and_unknown_symbol(con):
    res = fc.flow_for("SOFT")
    assert res["chains"] == [] and res["industry"] == "Software - Application"
    assert fc.flow_for("ZZZ") is None


def test_route_200_404_and_json_safe(con):
    app = FastAPI()
    app.include_router(connections.router)
    client = TestClient(app)
    ok = client.get("/stock/RIL/connections/flow?top=2")
    assert ok.status_code == 200 and ok.json()["chains"][0]["nodes"]
    assert client.get("/stock/ZZZ/connections/flow").status_code == 404
    assert client.get("/stock/NONAME/connections/flow").status_code == 200   # a missing name must not break JSON
