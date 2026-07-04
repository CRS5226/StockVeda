"""
Phase 5: Markov chain / stochastic state modeling.

Discretizes daily returns into states (default: up/flat/down), estimates a transition
probability matrix from historical data, and uses the current state to project forward
probabilities. Two consumers:
  - compute_markov_signal_series(): a CAUSAL/walk-forward per-day signal series, wired
    into the condition-based backtest engine like fno_signals.py's Phase 1 indicators.
  - run_markov_analysis(): a standalone snapshot (current transition matrix, forward
    projection, historical state timeline) for a dedicated analysis view.

Causality is the whole point of a "backtest-safe" signal: day i's markov_p_up/p_down
must only ever be computed from transitions up to and including day i's own realized
state — never from a matrix fit over the whole requested date range, which would leak
future data into past signals and silently corrupt any backtest that uses it.
"""

from dataclasses import dataclass
import numpy as np
import pandas as pd
from backend.core.fno_signals import get_spot_ohlcv


@dataclass
class MarkovParams:
    n_states: int = 3           # 3 = up/flat/down (default — most reliable given ~252-day windows)
    flat_band_pct: float = 0.5   # |daily return| <= this => "flat" (only used when n_states == 3)
    lookback_days: int = 252     # rolling window used to estimate the transition matrix
    horizon_days: int = 5        # how many steps ahead to project forward probabilities


def classify_states(returns: pd.Series, params: MarkovParams) -> pd.Series:
    """
    Maps daily pct-change returns (already *100, e.g. 1.5 for +1.5%) to integer state
    labels 0..n_states-1. State n_states-1 is always "most bullish", state 0 is always
    "most bearish" — callers rely on this ordering (see markov_p_up/markov_p_down below).

    n_states == 3: up/flat/down via a fixed flat_band_pct threshold — needs no fitting
    from the data, so it's trivially causal.

    n_states > 3: fixed-width bins symmetric around 0 (NOT quantile-based) — quantile
    bucketing would fit bin edges from the whole series' distribution, leaking future
    data into early classifications. Fixed-width bins avoid that at the cost of being
    less adaptive to each symbol's actual volatility.
    """
    if params.n_states == 3:
        states = pd.Series(1, index=returns.index, dtype="Int64")  # default: flat
        states[returns > params.flat_band_pct] = 2                  # up
        states[returns < -params.flat_band_pct] = 0                 # down
        return states.astype(int)

    edge = params.flat_band_pct * (params.n_states // 2)
    edges = np.linspace(-edge, edge, params.n_states - 1)
    return pd.Series(np.digitize(returns.values, edges), index=returns.index)


def _transition_counts(states: np.ndarray, n_states: int) -> np.ndarray:
    counts = np.zeros((n_states, n_states))
    if len(states) < 2:
        return counts
    np.add.at(counts, (states[:-1], states[1:]), 1)
    return counts


def estimate_transition_matrix(states: pd.Series, n_states: int) -> pd.DataFrame:
    """Row-normalized transition counts -> probabilities. Rows with no observations
    yet get a uniform 1/n_states distribution rather than NaN/zero."""
    counts = _transition_counts(states.values.astype(int), n_states)
    row_sums = counts.sum(axis=1, keepdims=True)
    probs = np.divide(counts, row_sums, out=np.full_like(counts, 1.0 / n_states), where=row_sums > 0)
    return pd.DataFrame(probs, index=range(n_states), columns=range(n_states))


def project_forward(transition_matrix: pd.DataFrame, current_state: int, horizon_days: int) -> pd.DataFrame:
    """Applies T^step to a one-hot vector at current_state, for step = 1..horizon_days."""
    n = transition_matrix.shape[0]
    vec = np.zeros(n)
    vec[current_state] = 1.0
    T = transition_matrix.values
    rows = []
    for step in range(1, horizon_days + 1):
        vec = vec @ T
        row = {"step": step}
        row.update({f"state_{s}": round(float(vec[s]), 4) for s in range(n)})
        rows.append(row)
    return pd.DataFrame(rows)


def _prep_states(sym: str, from_date: str, to_date: str, params: MarkovParams) -> tuple[pd.DataFrame, pd.Series] | None:
    """Fetches price history WITH an extra lookback buffer before from_date (so the
    requested range's early days still get a real transition-matrix estimate instead
    of a degenerate/empty one), classifies daily states. Returns (df, states) both
    indexed 0..len-1, or None if there's not enough history to do anything useful."""
    buffer_days = params.lookback_days * 2 + 30  # *2 to cover weekends/holidays -> trading days
    extended_from = (pd.Timestamp(from_date) - pd.Timedelta(days=buffer_days)).date().isoformat()
    df = get_spot_ohlcv(sym, extended_from, to_date)
    if df.empty or len(df) < 10:
        return None
    df = df.sort_values("date").reset_index(drop=True)
    df["date"] = df["date"].astype(str)
    returns = df["close"].pct_change() * 100
    states = classify_states(returns, params)
    states.iloc[0] = 1 if params.n_states == 3 else params.n_states // 2  # first day has no return -> neutral
    return df, states.astype(int)


def compute_markov_signal_series(sym: str, from_date: str, to_date: str, params: MarkovParams) -> pd.DataFrame:
    """
    Walk-forward per-day signal series for the condition-based backtest engine.
    Each day's markov_p_up/markov_p_down/markov_confidence uses a transition matrix
    estimated ONLY from transitions up to and including that day — never later ones.
    """
    prepped = _prep_states(sym, from_date, to_date, params)
    if prepped is None:
        return pd.DataFrame(columns=["date", "markov_state", "markov_p_up", "markov_p_down", "markov_confidence"])
    df, states = prepped
    state_vals = states.values
    n = params.n_states
    up_state, down_state = n - 1, 0

    rows = []
    for i in range(1, len(state_vals)):
        window_start = max(1, i - params.lookback_days + 1)
        window = state_vals[window_start - 1:i + 1]  # transitions up to and including day i
        matrix = estimate_transition_matrix(pd.Series(window), n)
        current_state = int(state_vals[i])
        row_probs = matrix.iloc[current_state]
        rows.append({
            "date": df["date"].iloc[i],
            "markov_state": current_state,
            "markov_p_up": round(float(row_probs[up_state]), 4),
            "markov_p_down": round(float(row_probs[down_state]), 4),
            "markov_confidence": round(float(row_probs.max()), 4),
        })

    result = pd.DataFrame(rows)
    if result.empty:
        return result
    return result[(result["date"] >= from_date) & (result["date"] <= to_date)].reset_index(drop=True)


MARKOV_SIGNAL_COLUMNS = ["markov_state", "markov_p_up", "markov_p_down", "markov_confidence"]


def attach_markov_signals(price_df: pd.DataFrame, symbol: str, from_date: str, to_date: str,
                           params: MarkovParams | None = None) -> pd.DataFrame:
    """
    Left-joins the walk-forward Markov signal series onto price_df (must have a 'date'
    column). Mirrors fno_signals.attach_fno_signals: if the symbol has too little price
    history, the new columns are added as all-NaN so downstream indicator lookups never
    KeyError — conditions on them just never fire.
    """
    params = params or MarkovParams()
    df = price_df.copy()
    df["date"] = df["date"].astype(str)

    try:
        signals = compute_markov_signal_series(symbol, from_date, to_date, params)
    except Exception:
        signals = pd.DataFrame(columns=["date"])

    if not signals.empty:
        signals["date"] = signals["date"].astype(str)
        df = df.merge(signals, on="date", how="left")

    for col in MARKOV_SIGNAL_COLUMNS:
        if col not in df.columns:
            df[col] = float("nan")
        else:
            df[col] = pd.to_numeric(df[col], errors="coerce")

    return df


def run_markov_analysis(sym: str, from_date: str, to_date: str, params: MarkovParams) -> dict:
    """Standalone snapshot: current transition matrix (as of to_date), current state,
    forward-projected probabilities, and the historical state timeline for charting."""
    prepped = _prep_states(sym, from_date, to_date, params)
    if prepped is None:
        return {"error": f"Insufficient price history for {sym.upper()} to run Markov analysis (need at least 10 trading days)."}
    df, states = prepped

    window = states.values[-params.lookback_days:] if len(states) > params.lookback_days else states.values
    matrix = estimate_transition_matrix(pd.Series(window), params.n_states)
    current_state = int(states.values[-1])
    projection = project_forward(matrix, current_state, params.horizon_days)

    mask = (df["date"] >= from_date) & (df["date"] <= to_date)
    history = [{"date": d, "state": int(s)} for d, s in zip(df["date"][mask], states[mask])]

    return {
        "symbol": sym.strip().upper(),
        "n_states": params.n_states,
        "current_state": current_state,
        "transition_matrix": matrix.values.tolist(),
        "projection": projection.to_dict("records"),
        "history": history,
        "lookback_days_used": int(len(window)),
    }
