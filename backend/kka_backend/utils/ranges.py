import math
import random
from typing import Optional, Tuple

from .numeric import clamp


def parse_range(
    payload: Optional[dict],
    default: Tuple[float, float],
    integer: bool = False,
    low: Optional[float] = None,
    high: Optional[float] = None,
) -> Tuple[float, float]:
    if not isinstance(payload, dict):
        lo, hi = default
    else:
        lo = payload.get("min", default[0])
        hi = payload.get("max", default[1])
    if integer:
        lo = int(lo)
        hi = int(hi)
    lo = float(lo)
    hi = float(hi)
    if lo > hi:
        lo, hi = hi, lo
    if low is not None:
        lo = max(lo, low)
        hi = max(hi, low)
    if high is not None:
        lo = min(lo, high)
        hi = min(hi, high)
    return lo, hi


def choose_from_range(rng: random.Random, bounds: Tuple[float, float], integer: bool = True) -> int:
    if integer:
        lo = int(math.floor(bounds[0]))
        hi = int(math.floor(bounds[1]))
        if lo > hi:
            lo, hi = hi, lo
        return rng.randint(lo, hi)
    return rng.uniform(bounds[0], bounds[1])
