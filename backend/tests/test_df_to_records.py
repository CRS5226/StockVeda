import pandas as pd

from backend.db.connection import df_to_records


def test_nan_becomes_none():
    df = pd.DataFrame({"symbol": ["A", "B"], "price": [1.5, float("nan")]})
    assert df_to_records(df) == [{"symbol": "A", "price": 1.5}, {"symbol": "B", "price": None}]


def test_dates_become_text():
    df = pd.DataFrame({"date": pd.to_datetime(["2026-01-02"]), "close": [10.0]})
    assert df_to_records(df) == [{"date": "2026-01-02", "close": 10.0}]


def test_empty_frame_gives_empty_list():
    assert df_to_records(pd.DataFrame()) == []


def test_integer_values_remain_unchanged():
    df = pd.DataFrame({"id": [1, 2], "quantity": [5, 10]})
    assert df_to_records(df) == [{"id": 1, "quantity": 5}, {"id": 2, "quantity": 10}]


def test_boolean_values_remain_unchanged():
    df = pd.DataFrame({"checked": [True, False]})
    assert df_to_records(df) == [{"checked": True}, {"checked": False}]


def test_none_dataframe_gives_empty_list():
    assert df_to_records(None) == []
