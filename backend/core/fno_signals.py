"""
Daily F&O signal series (Phase 1): PCR(OI), max pain, OI concentration, basis,
cost-of-carry, rollover % — computed from fno_ohlcv / fno_futures_ohlcv, per date.

These are joined onto a symbol's price series by date so the existing
condition-based backtest engine (backend/core/backtest_engine.py) can treat
them exactly like any other indicator column (crosses_above/below, thresholds).
"""

import pandas as pd
from backend.db.connection import get_db

INDEX_SYMBOLS = {"NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "SENSEX", "NIFTYBANK"}

FNO_SIGNAL_COLUMNS = [
    "pcr_oi", "max_pain", "max_pain_dist_pct", "atm_oi", "oi_concentration",
    "basis", "cost_of_carry", "rollover_pct",
]


def _option_signals(sym: str, instr: str, from_date: str, to_date: str, spot: pd.DataFrame) -> pd.DataFrame:
    db = get_db()

    front_expiry = db.execute("""
        SELECT date, MIN(expiry) AS front_expiry
        FROM fno_ohlcv
        WHERE symbol = ? AND instrument = ? AND date BETWEEN ? AND ? AND expiry >= date
        GROUP BY date
    """, [sym, instr, from_date, to_date]).df()

    if front_expiry.empty:
        return pd.DataFrame(columns=["date", "pcr_oi", "max_pain", "max_pain_dist_pct", "atm_oi", "oi_concentration"])

    chain = db.execute("""
        SELECT date, expiry, strike, option_type, open_interest
        FROM fno_ohlcv
        WHERE symbol = ? AND instrument = ? AND date BETWEEN ? AND ?
    """, [sym, instr, from_date, to_date]).df()

    chain = chain.merge(front_expiry, on="date")
    chain = chain[chain["expiry"] == chain["front_expiry"]]
    chain["open_interest"] = chain["open_interest"].fillna(0)

    spot_map = dict(zip(spot["date"], spot["close"])) if not spot.empty else {}

    rows = []
    for d, group in chain.groupby("date"):
        ce = group[group.option_type == "CE"].groupby("strike")["open_interest"].sum()
        pe = group[group.option_type == "PE"].groupby("strike")["open_interest"].sum()
        strikes = sorted(set(ce.index) | set(pe.index))
        if not strikes:
            continue

        ce_total, pe_total = ce.sum(), pe.sum()
        pcr = round(pe_total / ce_total, 4) if ce_total > 0 else None

        min_loss, max_pain = float("inf"), strikes[0]
        for s in strikes:
            loss = sum(max(0, k - s) * ce.get(k, 0) for k in strikes) + sum(max(0, s - k) * pe.get(k, 0) for k in strikes)
            if loss < min_loss:
                min_loss, max_pain = loss, s

        strike_totals = ce.add(pe, fill_value=0)
        total_oi = ce_total + pe_total
        oi_concentration = round(strike_totals.max() / total_oi * 100, 2) if total_oi > 0 else None

        day_spot = spot_map.get(d)
        max_pain_dist_pct = round((day_spot - max_pain) / day_spot * 100, 2) if day_spot else None
        atm_oi = None
        if day_spot and strikes:
            atm_strike = min(strikes, key=lambda k: abs(k - day_spot))
            atm_oi = float(strike_totals.get(atm_strike, 0))

        rows.append({
            "date": d, "pcr_oi": pcr, "max_pain": float(max_pain),
            "max_pain_dist_pct": max_pain_dist_pct, "atm_oi": atm_oi,
            "oi_concentration": oi_concentration,
        })

    return pd.DataFrame(rows)


def _futures_signals(sym: str, instr: str, from_date: str, to_date: str, spot: pd.DataFrame) -> pd.DataFrame:
    db = get_db()

    front_expiry = db.execute("""
        SELECT date, MIN(expiry) AS front_expiry
        FROM fno_futures_ohlcv
        WHERE symbol = ? AND instrument = ? AND date BETWEEN ? AND ? AND expiry >= date
        GROUP BY date
    """, [sym, instr, from_date, to_date]).df()

    if front_expiry.empty:
        return pd.DataFrame(columns=["date", "basis", "cost_of_carry", "rollover_pct"])

    all_rows = db.execute("""
        SELECT date, expiry, close, open_interest
        FROM fno_futures_ohlcv
        WHERE symbol = ? AND instrument = ? AND date BETWEEN ? AND ?
    """, [sym, instr, from_date, to_date]).df()

    total_oi = all_rows.groupby("date")["open_interest"].sum().rename("total_oi").reset_index()

    merged = all_rows.merge(front_expiry, on="date")
    front = merged[merged["expiry"] == merged["front_expiry"]].copy()
    front = front.rename(columns={"close": "fut_close", "open_interest": "front_oi"})
    front = front.merge(total_oi, on="date")
    front["rollover_pct"] = (front["front_oi"] / front["total_oi"].replace(0, float("nan")) * 100).round(1)

    spot_map = dict(zip(spot["date"], spot["close"])) if not spot.empty else {}
    front["spot"] = front["date"].map(spot_map)
    front["expiry_dt"] = pd.to_datetime(front["expiry"])
    front["date_dt"] = pd.to_datetime(front["date"])
    front["dte"] = (front["expiry_dt"] - front["date_dt"]).dt.days

    def _basis_coc(r):
        if r["spot"] is None or pd.isna(r["spot"]):
            return pd.Series({"basis": None, "cost_of_carry": None})
        basis = round(r["fut_close"] - r["spot"], 2)
        coc = None
        if r["dte"] and r["dte"] > 0:
            coc = round((basis / r["spot"]) * (365 / r["dte"]) * 100, 2)
        return pd.Series({"basis": basis, "cost_of_carry": coc})

    front = pd.concat([front, front.apply(_basis_coc, axis=1)], axis=1)
    return front[["date", "basis", "cost_of_carry", "rollover_pct"]]


def attach_fno_signals(price_df: pd.DataFrame, symbol: str, from_date: str, to_date: str) -> pd.DataFrame:
    """
    Left-joins daily F&O signals onto price_df (must have 'date' and 'close').
    If the symbol has no synced F&O data, the new columns are added as all-NaN
    so downstream indicator lookups never KeyError — conditions on them just
    never fire, which is the correct behaviour for an unfetched symbol.
    """
    sym = symbol.strip().upper()
    opt_instr = "OPTIDX" if sym in INDEX_SYMBOLS else "OPTSTK"
    fut_instr = "FUTIDX" if sym in INDEX_SYMBOLS else "FUTSTK"

    spot = price_df[["date", "close"]].copy()
    spot["date"] = spot["date"].astype(str)

    df = price_df.copy()
    df["date"] = df["date"].astype(str)

    try:
        opt_sig = _option_signals(sym, opt_instr, from_date, to_date, spot)
    except Exception:
        opt_sig = pd.DataFrame(columns=["date"])
    try:
        fut_sig = _futures_signals(sym, fut_instr, from_date, to_date, spot)
    except Exception:
        fut_sig = pd.DataFrame(columns=["date"])

    if not opt_sig.empty:
        opt_sig["date"] = opt_sig["date"].astype(str)
        df = df.merge(opt_sig, on="date", how="left")
    if not fut_sig.empty:
        fut_sig["date"] = fut_sig["date"].astype(str)
        df = df.merge(fut_sig, on="date", how="left")

    for col in FNO_SIGNAL_COLUMNS:
        if col not in df.columns:
            df[col] = float("nan")
        else:
            # Merge can leave these as object dtype when a whole column was absent from one side —
            # coerce to float so downstream .astype(float) in the condition engine never TypeErrors.
            df[col] = pd.to_numeric(df[col], errors="coerce")

    return df
