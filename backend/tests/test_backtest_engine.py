
import pandas as pd

from backend.core.backtest_engine import BacktestParamsV2, _run_trades


def _make_frame(closes):
    return pd.DataFrame({
        "date": pd.date_range("2026-01-01", periods=len(closes), freq="D"),
        "close": closes,
    })


def _params(max_bars=1):
    return BacktestParamsV2(
        entry_conditions=[],
        exit_conditions=[],
        target_pct=50.0,
        sl_pct=50.0,
        max_bars=max_bars,
        capital_per_trade=100.0,
    )


def test_profitable_timeout_counts_as_win():
    # Entry at 100, then a profitable exit at 110 when max_bars is reached.
    df = _make_frame([100.0, 100.0, 110.0])
    signals = pd.Series([False, True, False, False][:len(df)])

    trades, stats = _run_trades(df, signals, None, _params(max_bars=1))

    assert len(trades) == 1
    assert trades[0]["exit_reason"] == "timeout"
    assert trades[0]["pnl"] > 0
    assert stats["win_rate_pct"] == 100.0


def test_open_trade_at_end_of_data_has_own_exit_reason():
    # Entry at 100; price stays between stop and target until data ends.
    df = _make_frame([100.0, 100.0, 101.0])
    signals = pd.Series([False, True, False])

    trades, stats = _run_trades(df, signals, None, _params(max_bars=10))

    assert len(trades) == 1
    assert trades[0]["exit_reason"] == "end_of_data"
