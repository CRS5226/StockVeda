"""Rule evidence route: how each indicator rule would have done on each stock's own history, after costs.

A record of the past with fixed standard parameters, shown next to the rule scoreboard. It is not a forecast.
"""

import statistics

from fastapi import APIRouter, HTTPException, Query

from backend.core.candles import load_daily
from backend.core.portfolio_health import positions
from backend.core.rule_backtest import DEFAULT_COST_PCT, RULES, run_rule
from backend.db.connection import get_db
from backend.routes.portfolio_total import compute_total

router = APIRouter(prefix="/portfolios/{pid}/evidence", tags=["portfolio"])


def _summary(key: str, results: list[dict]) -> dict:
    counts = {v: sum(1 for r in results if r["verdict"] == v) for v in ("held_up", "mixed", "did_not", "few_trades")}
    return {
        "key": key, "tested": len(results), **counts,
        "median_later_pct": statistics.median(r["later_pct"] for r in results) if results else None,
        "beat_buy_hold_later": sum(1 for r in results if r["later_pct"] > r["later_buy_hold_pct"]),
    }


@router.get("")
def get_evidence(pid: int, cost_pct: float = Query(DEFAULT_COST_PCT, ge=0, le=5)):
    db = get_db()
    if not db.execute("SELECT 1 FROM portfolios WHERE id = ?", [pid]).fetchall():
        raise HTTPException(404, "No such portfolio.")
    total, stocks = compute_total(db, pid)
    rows = positions(stocks["holdings"])
    candles = load_daily(db, [r["symbol"] for r in rows])
    out, by_rule = [], {key: [] for key, _, _ in RULES}
    for r in sorted(rows, key=lambda r: -r["value"]):
        df = candles.get(r["symbol"])
        results = {key: (run_rule(df, key, cost_pct) if df is not None else None) for key, _, _ in RULES}
        if all(v is None for v in results.values()):
            continue                                              # not enough candles stored to test anything
        for key, res in results.items():
            if res is not None:
                by_rule[key].append(res)
        out.append({"symbol": r["symbol"], "kind": r["kind"], "weight_pct": r["value"] / total["value"] * 100 if total["value"] else 0.0, "results": results})
    return {
        "cost_pct": cost_pct,
        "rules": [{"key": k, "label": label, "how": how} for k, label, how in RULES],
        "rows": out,
        "summary": [_summary(key, by_rule[key]) for key, _, _ in RULES],
        "stocks_total": len(rows),
    }
