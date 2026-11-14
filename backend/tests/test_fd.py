"""Hand-checked cases for the fixed deposit maths."""

from datetime import date

import pytest

from backend.core.fd import FdTerms, add_months, fd_status, validate_terms

D = date


def terms(**over):
    base = dict(principal=100_000, annual_rate=8, start=D(2026, 1, 1), maturity=D(2029, 1, 1), compounding="quarterly", payout="cumulative")
    return FdTerms(**{**base, **over})


def test_add_months_keeps_the_day_when_it_can():
    assert add_months(D(2026, 1, 15), 3) == D(2026, 4, 15)
    assert add_months(D(2026, 1, 31), 1) == D(2026, 2, 28)
    assert add_months(D(2024, 1, 31), 1) == D(2024, 2, 29)
    assert add_months(D(2026, 11, 30), 3) == D(2027, 2, 28)


def test_cumulative_quarterly_after_one_year_is_100000_times_1_02_to_the_4():
    s = fd_status(terms(), D(2027, 1, 1))
    assert s["current_value"] == pytest.approx(100_000 * 1.02 ** 4)   # 108,243.22
    assert s["interest_earned"] == pytest.approx(8_243.216, abs=0.01)
    assert s["status"] == "active"


def test_compounding_frequency_matters():
    yearly = fd_status(terms(compounding="yearly"), D(2027, 1, 1))["current_value"]
    monthly = fd_status(terms(compounding="monthly"), D(2027, 1, 1))["current_value"]
    assert yearly == pytest.approx(108_000)
    assert monthly == pytest.approx(100_000 * (1 + 0.08 / 12) ** 12)
    assert monthly > yearly


def test_part_of_a_period_earns_simple_interest_by_days():
    # 1 Jan to 16 Jan: 15 of the 90 days of the first quarter
    s = fd_status(terms(), D(2026, 1, 16))
    assert s["current_value"] == pytest.approx(100_000 * (1 + 0.02 * 15 / 90))


def test_maturity_value_and_nothing_grows_afterwards():
    at_maturity = 100_000 * 1.02 ** 12
    s = fd_status(terms(), D(2029, 1, 1))
    assert s["current_value"] == pytest.approx(at_maturity) and s["status"] == "matured" and s["days_left"] == 0
    later = fd_status(terms(), D(2031, 6, 1))
    assert later["current_value"] == pytest.approx(at_maturity)
    assert later["maturity_value"] == pytest.approx(at_maturity)


def test_not_started_is_worth_its_principal():
    s = fd_status(terms(start=D(2026, 6, 1), maturity=D(2027, 6, 1)), D(2026, 1, 1))
    assert s["status"] == "not_started" and s["current_value"] == 100_000 and s["interest_earned"] == 0
    assert s["days_left"] == 516


def test_monthly_payout_pays_simple_interest_on_the_principal():
    t = terms(principal=120_000, annual_rate=6, payout="monthly", maturity=D(2027, 1, 1))
    s = fd_status(t, D(2026, 6, 1))       # five payouts of 600 have reached the account
    assert s["interest_received"] == pytest.approx(3_000)
    assert s["current_value"] == pytest.approx(123_000)
    assert s["maturity_interest"] == pytest.approx(7_200)       # 12 x 600
    mid = fd_status(t, D(2026, 6, 16))    # plus 15 of June's 30 days earned but not yet paid
    assert mid["interest_received"] == pytest.approx(3_000)
    assert mid["interest_earned"] == pytest.approx(3_000 + 600 * 15 / 30)


def test_quarterly_and_yearly_payouts():
    q = fd_status(terms(payout="quarterly", annual_rate=8), D(2027, 1, 1))
    assert q["interest_received"] == pytest.approx(4 * 2_000)
    y = fd_status(terms(payout="yearly", annual_rate=8), D(2028, 1, 1))
    assert y["interest_received"] == pytest.approx(2 * 8_000)
    assert y["maturity_value"] == pytest.approx(100_000 + 3 * 8_000)


def test_validation():
    assert validate_terms(terms()) is None
    assert validate_terms(terms(principal=0))
    assert validate_terms(terms(annual_rate=-1))
    assert validate_terms(terms(maturity=D(2026, 1, 1)))
    assert validate_terms(terms(compounding="weekly"))
    assert validate_terms(terms(payout="daily"))
