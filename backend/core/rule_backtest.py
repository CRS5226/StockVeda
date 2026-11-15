"""How each indicator rule would have done on one stock's own daily history, after costs.

Plain and fixed on purpose: standard parameters, long only, no tuning, so there is nothing to over-fit. A signal at one
close is acted on at the next candle. The result is a record of the past, not a forecast, and it is shown only so the
rule scoreboard can be read with some evidence next to it.
"""

from typing import Optional

import numpy as np
import pandas as pd

from backend.core.signal_rules import ema, macd, rsi

WARMUP = 200               # candles before the first one counted, so every rule has its averages
MIN_AFTER_WARMUP = 120     # and at least this many candles to test on
MIN_TRADES = 5             # fewer trades than this tell very little
SPLIT = 0.6                # the first 60% of the tested candles is "earlier", the last 40% "later"
DEFAULT_COST_PCT = 0.2     # per side: brokerage, STT and other charges, plus a little slippage

RULES = [
    ("ema_cross", "EMA 20 / 50", "In while EMA 20 is above EMA 50"),
    ("sma200", "Price vs 200 average", "In while the close is above its 200-day average"),
    ("macd", "MACD (12, 26, 9)", "In while MACD is above its signal line"),
    ("rsi", "RSI 14 (oversold)", "In when RSI drops under 30, out when it is back over 50"),
    ("bollinger", "Bollinger (lower band)", "In when the close is under the lower band, out at the middle band"),
    ("breakout", "20-candle breakout", "In on a close above the previous 20-day high, out under the previous 10-day low"),
]


def _hold(enter: np.ndarray, leave: np.ndarray) -> np.ndarray:
    """1 while in a trade: from an entry signal until a leave signal."""
    out, state = np.zeros(len(enter)), 0
    for i in range(len(enter)):
        if state == 0 and enter[i]:
            state = 1
        elif state == 1 and leave[i]:
            state = 0
        out[i] = state
    return out


def positions(df: pd.DataFrame, key: str) -> pd.Series:
    """1 when the rule says to be in the stock at that close, else 0."""
    close = df["close"]
    if key == "ema_cross":
        pos = (ema(close, 20) > ema(close, 50)).astype(float)
    elif key == "sma200":
        pos = (close > close.rolling(200).mean()).astype(float)
    elif key == "macd":
        line, sig = macd(close)
        pos = (line > sig).astype(float)
    elif key == "rsi":
        r = rsi(close)
        pos = pd.Series(_hold((r < 30).to_numpy(), (r > 50).to_numpy()), index=close.index)
    elif key == "bollinger":
        mid, sd = close.rolling(20).mean(), close.rolling(20).std()
        pos = pd.Series(_hold((close < mid - 2 * sd).to_numpy(), (close > mid).to_numpy()), index=close.index)
    elif key == "breakout":
        up = close > df["high"].shift().rolling(20).max()
        down = close < df["low"].shift().rolling(10).min()
        pos = pd.Series(_hold(up.to_numpy(), down.to_numpy()), index=close.index)
    else:
        raise ValueError(f"Unknown rule {key}")
    return pos.fillna(0.0)


def _max_drawdown(equity: pd.Series) -> float:
    return float(((equity / equity.cummax()) - 1).min() * 100)


def run_rule(df: pd.DataFrame, key: str, cost_pct: float = DEFAULT_COST_PCT) -> Optional[dict]:
    """Test one rule over the stock's candles (columns date, open, high, low, close, volume, oldest first).

    Returns None when there are too few candles. Percent figures are after costs; `buy_hold_pct` is the same period held throughout.
    """
    df = df.dropna(subset=["close"]).reset_index(drop=True)
    n = len(df)
    if n < WARMUP + MIN_AFTER_WARMUP:
        return None
    cost = cost_pct / 100
    close = df["close"]
    ret = close.pct_change().fillna(0.0)
    pos = positions(df, key)
    pos.iloc[:WARMUP] = 0.0                                  # nothing is held before the test starts, so the first entry pays its costs
    held = pos.shift(1).fillna(0.0)                          # a signal at one close is acted on at the next candle
    turnover = held.diff().abs().fillna(0.0)
    net = (held * ret - turnover * cost).iloc[WARMUP:].reset_index(drop=True)
    gross_in = (held * ret).iloc[WARMUP:].reset_index(drop=True)
    inside = held.iloc[WARMUP:].reset_index(drop=True)
    prices = close.iloc[WARMUP - 1:].reset_index(drop=True)  # the close before the first tested candle, then each tested candle

    equity = (1 + net).cumprod()
    cut = int(len(net) * SPLIT)

    # one trade per run of days spent in the stock, charged for both sides
    trades, run = [], []
    for g, i in zip(gross_in, inside):
        if i > 0:
            run.append(g)
        elif run:
            trades.append((np.prod([1 + x for x in run]) - 1, len(run)))
            run = []
    if run:
        trades.append((np.prod([1 + x for x in run]) - 1, len(run)))
    after_costs = [(1 + g) * (1 - cost) ** 2 - 1 for g, _ in trades]

    total = float(equity.iloc[-1] - 1) * 100
    later = float(np.prod(1 + net.iloc[cut:]) - 1) * 100
    earlier = float(np.prod(1 + net.iloc[:cut]) - 1) * 100
    later_hold = float(prices.iloc[-1] / prices.iloc[cut] - 1) * 100
    enough = len(trades) >= MIN_TRADES
    verdict = "few_trades" if not enough else "held_up" if earlier > 0 and later > 0 else "mixed" if earlier > 0 or later > 0 else "did_not"
    return {
        "trades": len(trades), "win_rate_pct": float(np.mean([t > 0 for t in after_costs]) * 100) if trades else None,
        "avg_trade_pct": float(np.mean(after_costs) * 100) if trades else None,
        "avg_days_in_trade": float(np.mean([d for _, d in trades])) if trades else None,
        "total_pct": total, "buy_hold_pct": float(prices.iloc[-1] / prices.iloc[0] - 1) * 100,
        "earlier_pct": earlier, "later_pct": later, "later_buy_hold_pct": later_hold,
        "max_drawdown_pct": _max_drawdown(equity), "in_market_pct": float(inside.mean() * 100),
        "candles": len(net), "from_date": str(df["date"].iloc[WARMUP]), "to_date": str(df["date"].iloc[-1]), "verdict": verdict,
    }
