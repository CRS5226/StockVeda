"""Sector-level flow chains: raw material -> energy -> manufacturing -> selling.

No free dataset says which company supplies which, so the chains are a small hand-made map
of industries (Yahoo's industry labels, as stored in company_profile). An arrow means
"is typically an input to", at industry level only. It says nothing about any company's
actual suppliers or customers, and nothing about future prices.

To add a chain: add an entry to CHAINS with nodes (industry names in lower case) and edges.
Industry names must match the labels stored in company_profile; after a profile sync,
`industries_without_stocks()` lists any chain industry that no stock has (a typo, or just not seen yet).
"""

import pandas as pd

from backend.core.correlation import TRADING_DAYS_1M, TRADING_DAYS_3M, period_return
from backend.db.connection import get_db

DEFAULT_TOP_N = 5
MAX_TOP_N = 15

CHAINS = [
    {
        "id": "energy",
        "name": "Oil and gas to fuel users",
        "nodes": [
            {"id": "crude", "label": "Crude oil and gas production", "industries": ["oil & gas e&p", "oil & gas integrated"]},
            {"id": "refining", "label": "Refining and marketing", "industries": ["oil & gas refining & marketing"]},
            {"id": "gas", "label": "Gas transport and distribution", "industries": ["oil & gas midstream", "utilities - regulated gas"]},
            {"id": "chemicals", "label": "Chemicals", "industries": ["specialty chemicals", "chemicals"]},
            {"id": "tyres", "label": "Tyres and auto parts", "industries": ["auto parts"]},
            {"id": "transport", "label": "Airlines, shipping and logistics", "industries": ["airlines", "marine shipping", "integrated freight & logistics"]},
        ],
        "edges": [("crude", "refining"), ("crude", "gas"), ("refining", "chemicals"), ("refining", "tyres"), ("refining", "transport")],
    },
    {
        "id": "power",
        "name": "Coal and gas to power and heavy users",
        "nodes": [
            {"id": "coal", "label": "Coal", "industries": ["thermal coal", "coking coal"]},
            {"id": "equipment", "label": "Power equipment", "industries": ["electrical equipment & parts"]},
            {"id": "generation", "label": "Power generation", "industries": [
                "utilities - independent power producers", "utilities - regulated electric", "utilities - renewable", "solar"]},
            {"id": "heavy", "label": "Power-hungry industry", "industries": ["steel", "aluminum", "building materials"]},
        ],
        "edges": [("coal", "generation"), ("equipment", "generation"), ("generation", "heavy")],
    },
    {
        "id": "metals",
        "name": "Metals to machines, vehicles and buildings",
        "nodes": [
            {"id": "mining", "label": "Mining", "industries": ["other industrial metals & mining", "coking coal", "copper"]},
            {"id": "steel", "label": "Steel and aluminium", "industries": ["steel", "aluminum"]},
            {"id": "fabrication", "label": "Metal fabrication", "industries": ["metal fabrication"]},
            {"id": "machinery", "label": "Machinery", "industries": ["specialty industrial machinery", "farm & heavy construction machinery"]},
            {"id": "autos", "label": "Vehicles", "industries": ["auto manufacturers", "auto parts"]},
            {"id": "construction", "label": "Construction", "industries": ["engineering & construction", "building materials"]},
        ],
        "edges": [("mining", "steel"), ("steel", "fabrication"), ("fabrication", "machinery"), ("steel", "autos"), ("steel", "construction")],
    },
    {
        "id": "housing",
        "name": "Cement to homes",
        "nodes": [
            {"id": "materials", "label": "Cement and building materials", "industries": ["building materials"]},
            {"id": "builders", "label": "Builders", "industries": ["engineering & construction"]},
            {"id": "developers", "label": "Real estate developers", "industries": ["real estate - development", "real estate services"]},
            {"id": "durables", "label": "Home goods and appliances", "industries": ["furnishings, fixtures & appliances", "consumer electronics"]},
            {"id": "lenders", "label": "Home lenders", "industries": ["mortgage finance", "credit services", "banks - regional"]},
        ],
        "edges": [("materials", "builders"), ("builders", "developers"), ("developers", "durables"), ("lenders", "developers")],
    },
    {
        "id": "food",
        "name": "Farm to shelf",
        "nodes": [
            {"id": "inputs", "label": "Fertilisers and farm inputs", "industries": ["agricultural inputs"]},
            {"id": "farm", "label": "Farm products", "industries": ["farm products"]},
            {"id": "processing", "label": "Food and drink makers", "industries": ["packaged foods", "confectioners", "beverages - non-alcoholic"]},
            {"id": "retail", "label": "Retail", "industries": ["grocery stores", "department stores", "specialty retail", "apparel retail", "internet retail"]},
        ],
        "edges": [("inputs", "farm"), ("farm", "processing"), ("processing", "retail")],
    },
    {
        "id": "health",
        "name": "Medicines to care",
        "nodes": [
            {"id": "pharma", "label": "Drug makers", "industries": ["drug manufacturers - specialty & generic", "drug manufacturers - general", "biotechnology"]},
            {"id": "devices", "label": "Medical devices", "industries": ["medical instruments & supplies", "medical devices"]},
            {"id": "care", "label": "Hospitals and diagnostics", "industries": ["medical care facilities", "diagnostics & research", "health information services"]},
        ],
        "edges": [("pharma", "care"), ("devices", "care")],
    },
]


def industries_without_stocks(db=None) -> list[str]:
    """Chain industry names that no stored company profile has. Empty when every name matches something."""
    db = db or get_db()
    have = {r[0] for r in db.execute("SELECT DISTINCT lower(industry) FROM company_profile WHERE industry IS NOT NULL").fetchall()}
    wanted = {i for c in CHAINS for n in c["nodes"] for i in n["industries"]}
    return sorted(wanted - have)


def _neighbours(edges: list[tuple[str, str]], start: str, forward: bool) -> set[str]:
    """Nodes reachable from `start` following edges forward (downstream) or backward (upstream)."""
    found, frontier = set(), [start]
    while frontier:
        current = frontier.pop()
        for a, b in edges:
            source, target = (a, b) if forward else (b, a)
            if source == current and target not in found:
                found.add(target)
                frontier.append(target)
    return found


def _clean(value):
    """A plain value for JSON: None instead of NaN or NA."""
    return None if pd.isna(value) else value


def _node_order(chain: dict) -> list[str]:
    """Node ids from raw material to end use (edges only run forward, so a simple layered order works)."""
    ids = [n["id"] for n in chain["nodes"]]
    depth = {i: 0 for i in ids}
    for _ in ids:
        for a, b in chain["edges"]:
            depth[b] = max(depth[b], depth[a] + 1)
    return sorted(ids, key=lambda i: (depth[i], ids.index(i)))


def chains_for_industry(industry: str | None) -> list[dict]:
    """Chains that have a node for this industry."""
    key = (industry or "").strip().lower()
    return [c for c in CHAINS if any(key in n["industries"] for n in c["nodes"])] if key else []


def _stocks_by_industry(db, industries: list[str]) -> pd.DataFrame:
    """symbol, industry, name, traded value (last 30 days) for all stocks in the given industries."""
    return db.execute("""
        WITH traded AS (
            SELECT symbol, SUM(close * volume) AS value FROM stock_ohlcv
            WHERE date >= (SELECT MAX(date) FROM stock_ohlcv) - INTERVAL 30 DAY
            GROUP BY symbol
        )
        SELECT p.symbol, lower(p.industry) AS industry, n.company_name AS name, COALESCE(t.value, 0) AS value
        FROM company_profile p
        LEFT JOIN nse_symbols n ON n.symbol = p.symbol
        LEFT JOIN traded t ON t.symbol = p.symbol
        WHERE list_contains(?, lower(p.industry))
    """, [industries]).df()


def _closes(db, symbols: list[str]) -> pd.DataFrame:
    """Recent closes for the given symbols. A calendar window is used, not "the last N dates",
    because the newest dates can exist for only some symbols and would shorten everyone else's history."""
    if not symbols:
        return pd.DataFrame()
    df = db.execute("""
        SELECT date, symbol, close FROM stock_ohlcv
        WHERE date >= (SELECT MAX(date) FROM stock_ohlcv) - INTERVAL 110 DAY AND list_contains(?, symbol)
    """, [symbols]).df()
    return df.pivot(index="date", columns="symbol", values="close").sort_index() if not df.empty else pd.DataFrame()


def flow_for(symbol: str, top_n: int = DEFAULT_TOP_N) -> dict | None:
    """Every chain the stock's industry sits in, with the most traded stocks at each step.

    None when the symbol has no profile. `chains` is empty when no chain covers its industry.
    """
    symbol = symbol.strip().upper()
    top_n = min(max(top_n, 1), MAX_TOP_N)
    db = get_db()
    row = db.execute("SELECT sector, industry FROM company_profile WHERE symbol = ?", [symbol]).fetchone()
    if row is None:
        return None
    sector, industry = row
    matched = chains_for_industry(industry)
    result = {"symbol": symbol, "sector": sector, "industry": industry, "chains": [],
              "note": "Industry-level map, not company supply contracts. Stocks are the most traded in each step."}
    if not matched:
        return result

    industries = sorted({i for c in matched for n in c["nodes"] for i in n["industries"]})
    stocks = _stocks_by_industry(db, industries)
    ranked = {ind: g.sort_values("value", ascending=False) for ind, g in stocks.groupby("industry")}

    picked: dict[tuple[str, str], list[str]] = {}
    for chain in matched:
        for node in chain["nodes"]:
            frame = pd.concat([ranked[i] for i in node["industries"] if i in ranked]) if any(i in ranked for i in node["industries"]) else stocks.iloc[0:0]
            frame = frame.sort_values("value", ascending=False)
            top = list(frame["symbol"].head(top_n))
            if symbol in set(frame["symbol"]) and symbol not in top:
                top = top[:-1] + [symbol]   # the stock you asked about is always shown in its own step
            picked[(chain["id"], node["id"])] = top
    closes = _closes(db, sorted({s for v in picked.values() for s in v}))
    meta = stocks.drop_duplicates("symbol").set_index("symbol")

    for chain in matched:
        current = next(n["id"] for n in chain["nodes"] if (industry or "").lower() in n["industries"])
        upstream, downstream = _neighbours(chain["edges"], current, False), _neighbours(chain["edges"], current, True)
        by_id = {n["id"]: n for n in chain["nodes"]}
        nodes = []
        for node_id in _node_order(chain):
            node = by_id[node_id]
            role = "current" if node_id == current else "upstream" if node_id in upstream else "downstream" if node_id in downstream else "other"
            nodes.append({
                "id": node_id, "label": node["label"], "role": role,
                "stocks": [{
                    "symbol": s, "name": _clean(meta.loc[s, "name"]) if s in meta.index else None,
                    "industry": _clean(meta.loc[s, "industry"]) if s in meta.index else None,
                    "return_1m": period_return(closes, s, TRADING_DAYS_1M) if not closes.empty else None,
                    "return_3m": period_return(closes, s, TRADING_DAYS_3M) if not closes.empty else None,
                } for s in picked[(chain["id"], node_id)]],
            })
        result["chains"].append({"id": chain["id"], "name": chain["name"], "nodes": nodes,
                                 "edges": [{"from": a, "to": b} for a, b in chain["edges"]]})
    return result
