"""Who holds a listed company and what it holds, from the shareholder filings.

A holder name from a filing is matched to a listed company only when the two names are
identical after tidying (case, "Ltd" vs "Limited", punctuation, a "(formerly ...)" tail).
There is no fuzzy matching, so a match is a safe one and a missing match only means
"not recognised as a listed company". Percentages are shown as filed; the graph says
nothing about control or influence.
"""

import re

from backend.db.connection import get_db

MIN_NEIGHBOUR_PCT = 1.0     # holders and holdings below this are left out
MAX_HOLDERS_PER_NODE = 25   # biggest holders shown for one company
MAX_NODES = 60
GROUP_MIN_PCT = 5.0         # a promoter holder this big defines a "group" of companies
MAX_GROUP_COMPANIES = 30

_DROP_WORDS = {"THE", "LIMITED", "LTD", "PRIVATE", "PVT"}
# Spellings seen in real filings for the same listed holder.
_ALIASES = {"LIC OF INDIA": "LIFE INSURANCE CORPORATION OF INDIA"}


def holder_key(name: str | None) -> str:
    """A comparable form of a holder or company name; empty string when nothing is left."""
    text = re.sub(r"\(.*?\)", " ", (name or "").upper())
    text = text.replace("&", " AND ")
    words = [w for w in re.sub(r"[^A-Z0-9]+", " ", text).split() if w not in _DROP_WORDS]
    key = " ".join(words)
    return _ALIASES.get(key, key)


def refresh_holder_matches(db=None) -> int:
    """Rebuild holder_matches: each distinct holder name, its key, and the listed symbol it names.

    A key shared by two listed companies is ambiguous and matches nothing. Returns the matched count.
    """
    db = db or get_db()
    by_key: dict[str, set[str]] = {}
    for symbol, name in db.execute("SELECT symbol, company_name FROM nse_symbols WHERE company_name IS NOT NULL").fetchall():
        key = holder_key(name)
        if key:
            by_key.setdefault(key, set()).add(symbol)

    rows = []
    for (name,) in db.execute("SELECT DISTINCT holder_name FROM shareholders").fetchall():
        key = holder_key(name)
        symbols = by_key.get(key, set())
        rows.append((name, key, next(iter(symbols)) if len(symbols) == 1 else None))

    db.execute("DELETE FROM holder_matches")
    if rows:
        db.executemany("INSERT INTO holder_matches (holder_name, holder_key, symbol) VALUES (?, ?, ?)", rows)
    return sum(1 for r in rows if r[2])


def _latest_filter(alias: str = "s") -> str:
    return f"{alias}.period = (SELECT MAX(period) FROM shareholders x WHERE x.symbol = {alias}.symbol)"


def _holders_of(db, symbol: str) -> list[dict]:
    rows = db.execute(f"""
        SELECT s.holder_name, m.holder_key, m.symbol, s.pct, s.holder_group, s.category, s.period
        FROM shareholders s
        LEFT JOIN holder_matches m ON m.holder_name = s.holder_name
        WHERE s.symbol = ? AND {_latest_filter()} AND s.pct >= ?
        ORDER BY s.pct DESC
        LIMIT ?
    """, [symbol, MIN_NEIGHBOUR_PCT, MAX_HOLDERS_PER_NODE]).fetchall()
    return [{"name": r[0], "key": r[1], "symbol": r[2], "pct": r[3], "group": r[4], "category": r[5], "period": r[6]} for r in rows]


def _holdings_of(db, symbol: str) -> list[dict]:
    """Listed companies in whose latest filing this company appears as a holder."""
    rows = db.execute(f"""
        SELECT s.symbol, s.pct, s.period
        FROM shareholders s
        JOIN holder_matches m ON m.holder_name = s.holder_name
        WHERE m.symbol = ? AND s.symbol <> ? AND {_latest_filter()} AND s.pct >= ?
        ORDER BY s.pct DESC
    """, [symbol, symbol, MIN_NEIGHBOUR_PCT]).fetchall()
    return [{"symbol": r[0], "pct": r[1], "period": r[2]} for r in rows]


def _names(db, symbols: list[str]) -> dict[str, str]:
    if not symbols:
        return {}
    rows = db.execute("SELECT symbol, company_name FROM nse_symbols WHERE list_contains(?, symbol)", [symbols]).fetchall()
    return dict(rows)


def promoter_group(db, symbol: str) -> list[dict]:
    """Other listed companies where the same big promoter holder also appears.

    "Tata Sons Private Limited" holds TCS and Tata Steel, so both are in each other's group.
    Matching is by tidied holder name, as in the graph.
    """
    rows = db.execute(f"""
        WITH mine AS (
            SELECT m.holder_key, MAX(s.holder_name) AS holder_name, MAX(s.pct) AS pct
            FROM shareholders s JOIN holder_matches m ON m.holder_name = s.holder_name
            WHERE s.symbol = ? AND {_latest_filter()} AND s.holder_group = 'promoter' AND s.pct >= ?
            GROUP BY m.holder_key
        )
        SELECT mine.holder_name, o.symbol, MAX(o.pct)
        FROM mine
        JOIN holder_matches om ON om.holder_key = mine.holder_key
        JOIN shareholders o ON o.holder_name = om.holder_name
        WHERE o.symbol <> ? AND o.holder_group = 'promoter' AND o.pct >= ?
          AND o.period = (SELECT MAX(period) FROM shareholders x WHERE x.symbol = o.symbol)
        GROUP BY mine.holder_name, o.symbol
        ORDER BY mine.holder_name, MAX(o.pct) DESC
    """, [symbol, GROUP_MIN_PCT, symbol, GROUP_MIN_PCT]).fetchall()
    groups: dict[str, list[dict]] = {}
    for holder, sym, pct in rows:
        groups.setdefault(holder, []).append({"symbol": sym, "pct": pct})
    names = _names(db, [c["symbol"] for cs in groups.values() for c in cs])
    return [
        {"holder": holder, "companies": [{**c, "name": names.get(c["symbol"])} for c in cs[:MAX_GROUP_COMPANIES]]}
        for holder, cs in groups.items()
    ]


def ownership_graph(symbol: str, depth: int = 1) -> dict | None:
    """Nodes and edges around one company: its holders, what it holds, and (depth 2) their neighbours too.

    An edge runs from the holder to the company held. None when no filing is stored for the symbol.
    """
    symbol = symbol.strip().upper()
    depth = min(max(depth, 1), 2)
    db = get_db()
    if db.execute("SELECT 1 FROM shareholders WHERE symbol = ? LIMIT 1", [symbol]).fetchone() is None:
        return None
    if db.execute("SELECT 1 FROM holder_matches LIMIT 1").fetchone() is None:
        refresh_holder_matches(db)

    nodes: dict[str, dict] = {symbol: {"id": symbol, "symbol": symbol, "listed": True, "kind": "company"}}
    edges: dict[tuple[str, str], dict] = {}
    period = None

    def add_edge(source: str, target: str, pct: float, as_of) -> None:
        edges.setdefault((source, target), {"source": source, "target": target, "pct": round(pct, 4), "as_of": str(as_of)})

    frontier = [symbol]
    for _ in range(depth):
        next_frontier: list[str] = []
        for sym in frontier:
            for h in _holders_of(db, sym):
                if len(nodes) >= MAX_NODES and (h["symbol"] or "holder:" + h["key"]) not in nodes:
                    continue
                node_id = h["symbol"] or f"holder:{h['key']}"
                if h["symbol"] == sym:
                    continue
                nodes.setdefault(node_id, {"id": node_id, "symbol": h["symbol"], "listed": bool(h["symbol"]),
                                           "kind": "company" if h["symbol"] else "holder",
                                           "label": h["name"], "category": h["category"]})
                add_edge(node_id, sym, h["pct"], h["period"])
                period = max(period, h["period"]) if period else h["period"]
                if h["symbol"]:
                    next_frontier.append(h["symbol"])
            for held in _holdings_of(db, sym):
                if len(nodes) >= MAX_NODES and held["symbol"] not in nodes:
                    continue
                nodes.setdefault(held["symbol"], {"id": held["symbol"], "symbol": held["symbol"], "listed": True, "kind": "company"})
                add_edge(sym, held["symbol"], held["pct"], held["period"])
                next_frontier.append(held["symbol"])
        frontier = [s for s in dict.fromkeys(next_frontier) if s != symbol]

    names = _names(db, [n["symbol"] for n in nodes.values() if n["symbol"]])
    for node in nodes.values():
        if node["symbol"]:
            node["label"] = names.get(node["symbol"]) or node["symbol"]
    return {
        "symbol": symbol,
        "depth": depth,
        "as_of": str(period) if period else None,
        "nodes": list(nodes.values()),
        "edges": list(edges.values()),
        "group": promoter_group(db, symbol),
        "note": "Percentages are as filed in the shareholding pattern. Names are matched exactly after tidying, "
                "so a holder that is not shown as listed may still be a listed company under another spelling.",
    }
