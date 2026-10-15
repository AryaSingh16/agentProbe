"""
Tests for deterministic Wilson score confidence intervals and sample size formatting.
"""
from app.stats import format_rate_with_n, wilson_score_interval


def test_wilson_score_interval_basic():
    # 1 out of 9 (e.g. 11.1%)
    lower, upper = wilson_score_interval(1, 9)
    assert lower is not None and upper is not None
    assert 0.0 < lower < 0.111 < upper < 1.0
    # For 1/9, Wilson lower is approx 0.0199, upper approx 0.4350
    assert round(lower, 2) == 0.02
    assert 0.43 <= upper <= 0.45


def test_wilson_score_interval_zero_total():
    lower, upper = wilson_score_interval(0, 0)
    assert lower is None
    assert upper is None


def test_wilson_score_interval_boundaries():
    # 0 out of 10
    lower_zero, upper_zero = wilson_score_interval(0, 10)
    assert lower_zero == 0.0
    assert 0.0 < upper_zero < 0.4

    # 10 out of 10
    lower_full, upper_full = wilson_score_interval(10, 10)
    assert upper_full == 1.0
    assert 0.6 < lower_full < 1.0


def test_format_rate_with_n():
    assert format_rate_with_n(1, 9) == "1/9 (11.1%)"
    assert format_rate_with_n(0, 0) == "N/A (n=0)"
    assert format_rate_with_n(10, 10) == "10/10 (100.0%)"
