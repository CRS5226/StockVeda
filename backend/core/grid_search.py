"""
Grid-search over rule-based strategy hyperparameters.

Treats indicator *thresholds* (e.g. RSI crosses_above 30 → sweep 25/30/35/40) and
indicator *periods* (e.g. RSI period 10/14/21, ATR period 10/20/30) as dimensions,
expands the full cartesian product into concrete strategies, and evaluates every
combo on a chronological TRAIN split. The top-N by train PnL are then re-run on a
held-out TEST split so overfit combos (big train→test gap) are visible.

Reuses the engine's prepare_frame / simulate so feature + trade semantics are
identical to a normal V2 backtest.
"""

from __future__ import annotations

import itertools
import math
from dataclasses import dataclass, field

import pandas as pd

from backend.core.backtest_engine import (
    BacktestParamsV2,
    ConditionRow,
    prepare_frame,
    simulate,
)

# ── Caps (bound runtime + payload) ──────────────────────────────────────────
MAX_COMBOS = 500
MAX_DIMS = 4
MAX_VALUES_PER_DIM = 10
MAX_SYMBOLS = 50
MAX_TOP_N = 50

# Base indicator columns whose period can be swept. The family (before "_") must
# be in indicators.PARAMETRIC_FAMILIES.
SWEEPABLE_PERIOD_COLUMNS = [
    "rsi_14", "sma_20", "sma_50", "sma_200", "ema_20", "ema_50", "atr_14", "adx_14",
]


@dataclass
class SweepDim:
    kind: str                 # "threshold" | "indicator_period"
    condition_index: int = 0  # threshold: index into entry_conditions (its .right is swept)
    column: str = ""          # indicator_period: base column referenced by conditions, e.g. "rsi_14"
    values: list[float] = field(default_factory=list)


@dataclass
class Combo:
    combo_id: str
    conditions: list[ConditionRow]
    params: dict            # display map, e.g. {"rsi_14 crosses_above": 30, "rsi period": 21}
    extra_indicators: list[str]


def _fmt_num(v: float) -> str:
    """Render a sweep value the way the engine expects a threshold string."""
    return str(int(v)) if float(v).is_integer() else str(v)


def expand_combos(entry_conditions: list[ConditionRow], dims: list[SweepDim]) -> list[Combo]:
    """Cartesian-expand the sweep dimensions into concrete Combos. Raises ValueError
    (→ 400) on invalid config or if the combo count exceeds MAX_COMBOS."""
    if not dims:
        raise ValueError("At least one sweep dimension is required")
    if len(dims) > MAX_DIMS:
        raise ValueError(f"Too many sweep dimensions (max {MAX_DIMS})")

    for d in dims:
        if not d.values:
            raise ValueError("Each sweep dimension needs at least one value")
        if len(d.values) > MAX_VALUES_PER_DIM:
            raise ValueError(f"Too many values in a dimension (max {MAX_VALUES_PER_DIM})")
        if d.kind == "threshold":
            if not (0 <= d.condition_index < len(entry_conditions)):
                raise ValueError(f"threshold condition_index {d.condition_index} out of range")
            try:
                float(entry_conditions[d.condition_index].right)
            except (TypeError, ValueError):
                raise ValueError(
                    f"Condition {d.condition_index} right side "
                    f"({entry_conditions[d.condition_index].right!r}) is not a numeric threshold"
                )
        elif d.kind == "indicator_period":
            fam = d.column.rpartition("_")[0]
            if not fam:
                raise ValueError(f"Invalid period column {d.column!r}")
            referenced = any(
                c.left == d.column or c.right == d.column for c in entry_conditions
            )
            if not referenced:
                raise ValueError(
                    f"Period column {d.column!r} is not used by any entry condition"
                )
        else:
            raise ValueError(f"Unknown sweep kind {d.kind!r}")

    n_combos = math.prod(len(d.values) for d in dims)
    if n_combos > MAX_COMBOS:
        raise ValueError(
            f"{n_combos} combinations exceeds the limit of {MAX_COMBOS}. "
            "Reduce values or dimensions."
        )

    combos: list[Combo] = []
    for i, value_tuple in enumerate(itertools.product(*[d.values for d in dims])):
        conds = [ConditionRow(c.left, c.operator, c.right) for c in entry_conditions]
        label: dict = {}
        extra: set[str] = set()

        for d, v in zip(dims, value_tuple):
            if d.kind == "threshold":
                c = conds[d.condition_index]
                c.right = _fmt_num(v)
                label[f"{c.left} {c.operator}"] = v
            else:  # indicator_period
                fam = d.column.rpartition("_")[0]
                newcol = f"{fam}_{int(v)}"
                for c in conds:
                    if c.left == d.column:
                        c.left = newcol
                    if c.right == d.column:
                        c.right = newcol
                extra.add(newcol)
                label[f"{fam} period"] = int(v)

        combos.append(Combo(f"c{i:03d}", conds, label, sorted(extra)))

    return combos


def _pool_stats(trades: list[dict]) -> dict:
    """Aggregate a pooled trade list. Win = net-positive PnL (economic definition,
    matching the matrix aggregation the UI already shows)."""
    total = len(trades)
    winners = [t for t in trades if t["pnl"] > 0]
    return {
        "total_trades": total,
        "win_rate_pct": round(len(winners) / total * 100, 1) if total else 0.0,
        "total_pnl": round(sum(t["pnl"] for t in trades), 2),
        "avg_pnl_pct": round(sum(t["pnl_pct"] for t in trades) / total, 2) if total else 0.0,
    }


def evaluate_combo(frames: dict[str, pd.DataFrame], combo: Combo, base_params: BacktestParamsV2) -> dict:
    """Run one combo across a set of already-prepared frames; return pooled stats."""
    params = BacktestParamsV2(
        entry_conditions=combo.conditions,
        exit_conditions=base_params.exit_conditions,
        target_pct=base_params.target_pct,
        sl_pct=base_params.sl_pct,
        max_bars=base_params.max_bars,
        capital_per_trade=base_params.capital_per_trade,
        timeframe=base_params.timeframe,
    )
    trades: list[dict] = []
    for frame in frames.values():
        if frame is None or len(frame) < 2:
            continue
        try:
            trades.extend(simulate(frame, params)["trades"])
        except Exception:
            continue
    return _pool_stats(trades)


def split_frame(frame: pd.DataFrame, train_ratio: float) -> tuple[pd.DataFrame, pd.DataFrame, str | None]:
    """Chronological split of a prepared frame. Indicators were computed on the full
    frame (backward-looking only), so the test slice carries valid warmed values and
    there is no lookahead. Trades never span the boundary because each slice is
    simulated independently. Returns (train, test, boundary_date)."""
    k = int(len(frame) * train_ratio)
    train = frame.iloc[:k].reset_index(drop=True)
    test = frame.iloc[k:].reset_index(drop=True)
    boundary = str(test.iloc[0]["date"]) if len(test) else None
    return train, test, boundary
