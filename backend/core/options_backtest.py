"""
Phase 3: straddle/strangle backtester.

Different shape from the single-instrument condition engine (backtest_engine.py) —
this tracks a COMBINED CE+PE premium for one expiry cycle, entering near expiry
and exiting on a premium-decay target, an adverse move (SL), or forced exit near
expiry. One trade per expiry cycle in the requested range, not a bar-by-bar
crossover signal.
"""

from dataclasses import dataclass
from typing import Literal
import pandas as pd
from backend.db.connection import get_db
from backend.core.fno_signals import INDEX_SYMBOLS, _get_spot_series

STRATEGIES = ("short_straddle", "long_straddle", "short_strangle", "long_strangle")


@dataclass
class StraddleParams:
    strategy: Literal["short_straddle", "long_straddle", "short_strangle", "long_strangle"] = "short_straddle"
    strangle_width_pct: float = 2.0   # OTM distance from spot, strangle only
    entry_dte: int = 7                # enter once DTE drops to this many days
    target_pct: float = 30.0          # % move in combined premium that closes the trade in profit
    sl_pct: float = 50.0              # % adverse move in combined premium that stops the trade out
    force_exit_dte: int = 0           # force-close at/near expiry regardless of P&L
    capital_per_trade: float = 50_000.0  # notional per trade, for ₹ P&L reporting only


def _pick_strikes(strikes: list[float], spot: float, params: StraddleParams) -> tuple[float, float] | None:
    if params.strategy in ("short_straddle", "long_straddle"):
        atm = min(strikes, key=lambda k: abs(k - spot))
        return atm, atm

    call_target = spot * (1 + params.strangle_width_pct / 100)
    put_target = spot * (1 - params.strangle_width_pct / 100)
    calls_above = [s for s in strikes if s >= call_target]
    puts_below = [s for s in strikes if s <= put_target]
    if not calls_above or not puts_below:
        return None
    call_strike = min(calls_above, key=lambda k: abs(k - call_target))
    put_strike = min(puts_below, key=lambda k: abs(k - put_target))
    return call_strike, put_strike


def run_straddle_backtest(symbol: str, from_date: str, to_date: str, params: StraddleParams) -> dict:
    db = get_db()
    sym = symbol.strip().upper()
    instr = "OPTIDX" if sym in INDEX_SYMBOLS else "OPTSTK"
    is_short = params.strategy.startswith("short")

    # Expiries with any trading day inside the range — the expiry itself can fall
    # after to_date (we still have the lead-up chain to trade the cycle).
    expiries = db.execute("""
        SELECT DISTINCT expiry FROM fno_ohlcv
        WHERE symbol = ? AND instrument = ? AND date BETWEEN ? AND ?
        ORDER BY expiry
    """, [sym, instr, from_date, to_date]).fetchall()
    expiries = [str(r[0]) for r in expiries]

    if not expiries:
        return {"trades": [], "stats": _empty_stats()}

    spot_df = _get_spot_series(sym, from_date, to_date)
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
        strikes = sorted(entry_chain["strike"].unique())
        picked = _pick_strikes(strikes, day_spot, params)
        if picked is None:
            continue
        call_strike, put_strike = picked

        def _premium(day_chain: pd.DataFrame) -> float | None:
            ce = day_chain[(day_chain.option_type == "CE") & (day_chain.strike == call_strike)]["close"]
            pe = day_chain[(day_chain.option_type == "PE") & (day_chain.strike == put_strike)]["close"]
            if ce.empty or pe.empty:
                return None
            return float(ce.iloc[0]) + float(pe.iloc[0])

        entry_premium = _premium(entry_chain)
        if not entry_premium or entry_premium <= 0:
            continue

        remaining = [d for d in dates if d >= entry_date]
        exit_date, exit_premium, exit_reason = None, None, None

        for d in remaining:
            cur_premium = _premium(chain[chain["date"] == d])
            if cur_premium is None:
                continue
            pnl_pct = ((entry_premium - cur_premium) / entry_premium * 100) if is_short \
                else ((cur_premium - entry_premium) / entry_premium * 100)
            dte_now = (expiry_ts - pd.Timestamp(d)).days

            if pnl_pct >= params.target_pct:
                exit_date, exit_premium, exit_reason = d, cur_premium, "target"
                break
            if pnl_pct <= -params.sl_pct:
                exit_date, exit_premium, exit_reason = d, cur_premium, "sl"
                break
            if dte_now <= params.force_exit_dte:
                exit_date, exit_premium, exit_reason = d, cur_premium, "expiry"
                break

        if exit_date is None:
            # Ran out of fetched data before any exit condition fired — close at the last known price.
            for d in reversed(remaining):
                cur_premium = _premium(chain[chain["date"] == d])
                if cur_premium is not None:
                    exit_date, exit_premium, exit_reason = d, cur_premium, "data_end"
                    break
        if exit_date is None:
            continue

        pnl_pct = ((entry_premium - exit_premium) / entry_premium * 100) if is_short \
            else ((exit_premium - entry_premium) / entry_premium * 100)
        pnl_amount = round(params.capital_per_trade * pnl_pct / 100, 2)

        trades.append({
            "expiry": expiry, "entry_date": entry_date, "exit_date": exit_date,
            "call_strike": call_strike, "put_strike": put_strike,
            "entry_premium": round(entry_premium, 2), "exit_premium": round(exit_premium, 2),
            "pnl_pct": round(pnl_pct, 2), "pnl_amount": pnl_amount, "exit_reason": exit_reason,
        })

    return {"trades": trades, "stats": _compute_stats(trades)}


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
