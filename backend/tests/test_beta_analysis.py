import pandas as pd

from backend.core.beta_analysis import compute_beta


def test_returns_twice_the_index_have_beta_two():
    index = pd.Series([0.01, -0.02, 0.015, 0.005, -0.01])

    assert compute_beta(index * 2, index) == {
        "beta": 2.0,
        "alpha": 0.0,
        "r_squared": 1.0,
        "n_obs": 5,
    }


def test_one_observation_does_not_define_a_regression():
    result = compute_beta(pd.Series([0.02]), pd.Series([0.01]))

    assert result == {"beta": None, "alpha": None, "r_squared": None, "n_obs": 1}


def test_flat_index_does_not_define_a_beta():
    result = compute_beta(pd.Series([0.01, -0.02, 0.03]), pd.Series([0.0, 0.0, 0.0]))

    assert result == {"beta": None, "alpha": None, "r_squared": None, "n_obs": 3}
