"""
Phase 4: options spread backtester (bull call spread, bear put spread, iron condor).

Same one-trade-per-expiry-cycle shape as options_backtest.py (straddle/strangle), but
generalized to N legs instead of a fixed CE+PE pair. Each leg has a direction (+1 long,
-1 short); the portfolio's mark-to-market value is V(t) = sum(direction_i * price_i(t)).
P&L from entry to any later day is simply V(t) - V(entry) — this works uniformly for
both net-debit spreads (bull call, bear put) and net-credit spreads (iron condor)
without needing a separate is_short branch: V(entry) comes out positive for a debit
(you paid to enter) and negative for a credit (you received money), and the formula's
sign naturally does the right thing either way.
"""

from dataclasses import dataclass
from typing import Literal
import pandas as pd
from backend.db.connection import get_db
from backend.core.fno_signals import INDEX_SYMBOLS, get_spot_ohlcv
from backend.core.options_price_source import get_price_series

SPREAD_STRATEGIES = ("bull_call_spread", "bear_put_spread", "iron_condor")

# strategy -> {leg_name: (option_type, direction)}. direction: +1 = long (buy), -1 = short (sell).
LEG_SPECS: dict[str, dict[str, tuple[str, int]]] = {
    "bull_call_spread": {"long_call": ("CE", 1), "short_call": ("CE", -1)},
    "bear_put_spread": {"long_put": ("PE", 1), "short_put": ("PE", -1)},
    "iron_condor": {
        "short_call": ("CE", -1), "long_call": ("CE", 1),
        "short_put": ("PE", -1), "long_put": ("PE", 1),
    },
}


@dataclass
class SpreadParams:
    strategy: Literal["bull_call_spread", "bear_put_spread", "iron_condor"] = "bull_call_spread"
    long_offset_pct: float = 0.0        # ATM/OTM distance for the long (protective/directional) leg
    short_offset_pct: float = 3.0       # OTM distance for the short leg
    condor_call_short_pct: float = 3.0  # iron condor only
    condor_call_long_pct: float = 6.0
    condor_put_short_pct: float = 3.0
    condor_put_long_pct: float = 6.0
    entry_dte: int = 20                 # spreads are typically entered further from expiry than straddles
    target_pct: float = 50.0            # % of max profit captured
    sl_pct: float = 100.0               # % of max loss incurred
    force_exit_dte: int = 1
    capital_per_trade: float = 50_000.0
    data_source: Literal["cash", "futures"] = "cash"  # underlying reference price for ATM/offset selection + P&L


def _pick_spread_strikes(strikes: list[float], spot: float, params: SpreadParams) -> dict[str, float] | None:
    if not strikes:
        return None

    def closest(target: float) -> float:
        return min(strikes, key=lambda k: abs(k - target))

    if params.strategy == "bull_call_spread":
        long_strike = closest(spot * (1 + params.long_offset_pct / 100))
        candidates = [s for s in strikes if s > long_strike]
        if not candidates:
            return None
        short_strike = min(candidates, key=lambda k: abs(k - spot * (1 + params.short_offset_pct / 100)))
        return {"long_call": long_strike, "short_call": short_strike}

    if params.strategy == "bear_put_spread":
        long_strike = closest(spot * (1 - params.long_offset_pct / 100))
        candidates = [s for s in strikes if s < long_strike]
        if not candidates:
            return None
        short_strike = min(candidates, key=lambda k: abs(k - spot * (1 - params.short_offset_pct / 100)))
        return {"long_put": long_strike, "short_put": short_strike}

    if params.strategy == "iron_condor":
        short_call = closest(spot * (1 + params.condor_call_short_pct / 100))
        call_candidates = [s for s in strikes if s > short_call]
        if not call_candidates:
            return None
        long_call = min(call_candidates, key=lambda k: abs(k - spot * (1 + params.condor_call_long_pct / 100)))

        short_put = closest(spot * (1 - params.condor_put_short_pct / 100))
        put_candidates = [s for s in strikes if s < short_put]
        if not put_candidates:
            return None
        long_put = min(put_candidates, key=lambda k: abs(k - spot * (1 - params.condor_put_long_pct / 100)))

        return {"short_call": short_call, "long_call": long_call, "short_put": short_put, "long_put": long_put}

    return None


def _leg_prices(day_chain: pd.DataFrame, strikes: dict[str, float], leg_specs: dict[str, tuple[str, int]]) -> dict[str, float] | None:
    """Returns {leg_name: close_price} for the given day, or None if any leg has no quote."""
    prices: dict[str, float] = {}
    for leg_name, (option_type, _direction) in leg_specs.items():
        strike = strikes[leg_name]
        row = day_chain[(day_chain.option_type == option_type) & (day_chain.strike == strike)]["close"]
        if row.empty:
            return None
        prices[leg_name] = float(row.iloc[0])
    return prices


def _net_value(prices: dict[str, float], leg_specs: dict[str, tuple[str, int]]) -> float:
    """Portfolio mark-to-market value: sum(direction * price). Positive = net debit paid,
    negative = net credit received."""
    return sum(direction * prices[leg_name] for leg_name, (_ot, direction) in leg_specs.items())


def _max_profit_loss(strikes: dict[str, float], entry_value: float, strategy: str) -> tuple[float, float]:
    """Returns (max_profit, max_loss), both positive numbers."""
    if strategy == "bull_call_spread":
        width = strikes["short_call"] - strikes["long_call"]
        max_loss = max(0.0, entry_value)          # net debit paid
        max_profit = max(0.0, width - entry_value)
        return max_profit, max_loss

    if strategy == "bear_put_spread":
        width = strikes["long_put"] - strikes["short_put"]
        max_loss = max(0.0, entry_value)
        max_profit = max(0.0, width - entry_value)
        return max_profit, max_loss

    if strategy == "iron_condor":
        call_width = strikes["long_call"] - strikes["short_call"]
        put_width = strikes["short_put"] - strikes["long_put"]
        wing_width = max(call_width, put_width)   # worst-case side
        net_credit = max(0.0, -entry_value)
        max_profit = net_credit
        max_loss = max(0.0, wing_width - net_credit)
        return max_profit, max_loss

    return 0.0, 0.0


def run_spread_backtest(symbol: str, from_date: str, to_date: str, params: SpreadParams) -> dict:
    db = get_db()
    sym = symbol.strip().upper()
    instr = "OPTIDX" if sym in INDEX_SYMBOLS else "OPTSTK"
    leg_specs = LEG_SPECS[params.strategy]

    expiries = db.execute("""
        SELECT DISTINCT expiry FROM fno_ohlcv
        WHERE symbol = ? AND instrument = ? AND date BETWEEN ? AND ?
        ORDER BY expiry
    """, [sym, instr, from_date, to_date]).fetchall()
    expiries = [str(r[0]) for r in expiries]

    ohlcv = get_spot_ohlcv(sym, from_date, to_date)
    ohlcv_records = ohlcv.to_dict("records") if not ohlcv.empty else []

    if not expiries:
        return {"trades": [], "stats": _empty_stats(), "ohlcv": ohlcv_records}

    spot_df = get_price_series(sym, from_date, to_date, params.data_source)
    spot_map = dict(zip(spot_df["date"], spot_df["close"])) if not spot_df.empty else {}

    trades = []
    for expiry in expiries:
        chain = db.execute("""
            SELECT date, strike, option_type, close
            FROM fno_ohlcv
            WHERE symbol = ? AND instrument = ? AND expiry = ? AND date BETWEEN ? AND ?
            ORDER BY date
        """, [sym, instr, expiry, from_date, to_date]).df()
        if chain.empty:
            continue
        chain["date"] = chain["date"].astype(str)
        dates = sorted(chain["date"].unique())

        expiry_ts = pd.Timestamp(expiry)
        entry_date = None
        for d in dates:
            dte = (expiry_ts - pd.Timestamp(d)).days
            if dte <= params.entry_dte:
                entry_date = d
                break
        if entry_date is None:
            continue

        day_spot = spot_map.get(entry_date)
        if not day_spot:
            continue

        entry_chain = chain[chain["date"] == entry_date]
        strikes_avail = sorted(entry_chain["strike"].unique())
        strikes = _pick_spread_strikes(strikes_avail, day_spot, params)
        if strikes is None:
            continue

        entry_prices = _leg_prices(entry_chain, strikes, leg_specs)
        if entry_prices is None:
            continue
        entry_value = _net_value(entry_prices, leg_specs)
        max_profit, max_loss = _max_profit_loss(strikes, entry_value, params.strategy)
        if max_profit <= 0:
            continue  # degenerate strike pick (e.g. long/short collapsed to same strike)

        remaining = [d for d in dates if d >= entry_date]
        exit_date, exit_prices, exit_reason = None, None, None
        value_path: list[dict] = []

        for d in remaining:
            day_prices = _leg_prices(chain[chain["date"] == d], strikes, leg_specs)
            if day_prices is None:
                continue
            cur_value = _net_value(day_prices, leg_specs)
            value_path.append({"date": d, "value": round(cur_value, 2)})
            pnl = cur_value - entry_value
            dte_now = (expiry_ts - pd.Timestamp(d)).days

            if pnl >= max_profit * params.target_pct / 100:
                exit_date, exit_prices, exit_reason = d, day_prices, "target"
                break
            if -pnl >= max_loss * params.sl_pct / 100:
                exit_date, exit_prices, exit_reason = d, day_prices, "sl"
                break
            if dte_now <= params.force_exit_dte:
                exit_date, exit_prices, exit_reason = d, day_prices, "expiry"
                break

        if exit_date is None:
            if value_path:
                last_day = value_path[-1]["date"]
                last_prices = _leg_prices(chain[chain["date"] == last_day], strikes, leg_specs)
                if last_prices:
                    exit_date, exit_prices, exit_reason = last_day, last_prices, "data_end"
        if exit_date is None:
            continue

        exit_value = _net_value(exit_prices, leg_specs)
        pnl = exit_value - entry_value
        pnl_pct = round(pnl / max_profit * 100, 2) if max_profit > 0 else 0.0
        pnl_amount = round(params.capital_per_trade * pnl_pct / 100, 2)

        legs = [
            {
                "leg": leg_name, "option_type": ot, "direction": direction, "strike": strikes[leg_name],
                "entry_price": round(entry_prices[leg_name], 2), "exit_price": round(exit_prices[leg_name], 2),
            }
            for leg_name, (ot, direction) in leg_specs.items()
        ]

        trades.append({
            "expiry": expiry, "entry_date": entry_date, "exit_date": exit_date,
            "legs": legs,
            "entry_value": round(entry_value, 2), "exit_value": round(exit_value, 2),
            "max_profit": round(max_profit, 2), "max_loss": round(max_loss, 2),
            "pnl_pct": pnl_pct, "pnl_amount": pnl_amount, "exit_reason": exit_reason,
            "value_path": value_path,
        })

    return {"trades": trades, "stats": _compute_stats(trades), "ohlcv": ohlcv_records}


def _empty_stats() -> dict:
    return {"total_trades": 0, "win_rate_pct": 0.0, "total_pnl": 0.0, "avg_pnl_pct": 0.0}


def _compute_stats(trades: list) -> dict:
    if not trades:
        return _empty_stats()
    winners = [t for t in trades if t["pnl_amount"] > 0]
    return {
        "total_trades": len(trades),
        "win_rate_pct": round(len(winners) / len(trades) * 100, 1),
        "total_pnl": round(sum(t["pnl_amount"] for t in trades), 2),
        "avg_pnl_pct": round(sum(t["pnl_pct"] for t in trades) / len(trades), 2),
    }
