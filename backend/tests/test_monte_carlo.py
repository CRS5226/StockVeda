import numpy as np
import pandas as pd
import pytest

from backend.core.monte_carlo import estimate_drift_volatility, simulate_gbm_paths


def test_flat_closes_have_no_drift_or_volatility():
    assert estimate_drift_volatility(pd.Series([100.0, 100.0, 100.0])) == (0.0, 0.0)


def test_constant_growth_has_log_drift_but_no_volatility():
    drift, volatility = estimate_drift_volatility(pd.Series([100.0, 200.0, 400.0]))

    assert drift == pytest.approx(np.log(2))
    assert volatility == pytest.approx(0.0)


def test_paths_include_the_last_close_before_the_first_simulated_day():
    paths = simulate_gbm_paths(100.0, 0.001, 0.02, horizon_days=5, n_simulations=3, seed=1)

    assert paths.shape == (3, 6)
    np.testing.assert_array_equal(paths[:, 0], [100.0, 100.0, 100.0])


def test_seed_reproduces_price_paths():
    first = simulate_gbm_paths(100.0, 0.001, 0.02, horizon_days=5, n_simulations=3, seed=12)
    second = simulate_gbm_paths(100.0, 0.001, 0.02, horizon_days=5, n_simulations=3, seed=12)

    np.testing.assert_array_equal(first, second)
