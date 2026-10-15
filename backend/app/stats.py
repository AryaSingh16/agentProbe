"""
AgentProbe Statistical Utilities:
Deterministic Wilson 95% Confidence Intervals and sample size formatting.
"""
import math
from typing import List, Optional, Tuple


def wilson_score_interval(
    successes: int,
    total: int,
    confidence: float = 0.95,
) -> Tuple[Optional[float], Optional[float]]:
    """
    Computes deterministic Wilson score confidence interval for a binomial proportion.
    Returns (lower_bound, upper_bound) rounded to 4 decimals, or (None, None) if total == 0.
    """
    if total <= 0:
        return None, None

    # Z-value for 95% two-sided confidence
    # 0.95 -> 1.959963984540054
    z = 1.959963984540054
    p_hat = min(1.0, max(0.0, successes / total))

    denominator = 1.0 + (z**2) / total
    center = (p_hat + (z**2) / (2.0 * total)) / denominator
    margin = (z / denominator) * math.sqrt(
        (p_hat * (1.0 - p_hat) / total) + ((z**2) / (4.0 * (total**2)))
    )

    lower = max(0.0, center - margin)
    upper = min(1.0, center + margin)

    return round(lower, 4), round(upper, 4)


def format_rate_with_n(
    successes: int,
    total: int,
) -> str:
    """
    Formats a proportion with sample size, e.g. '1/9 (11.1%)' or 'N/A (n=0)'.
    """
    if total <= 0:
        return "N/A (n=0)"
    pct = (successes / total) * 100.0
    return f"{successes}/{total} ({pct:.1f}%)"
