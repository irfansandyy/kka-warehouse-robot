from typing import Tuple


def clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def clamp_int(value: int, low: int, high: int) -> int:
    return int(clamp(value, low, high))


def estimate_walkable_cells(width: int, height: int, density_range: Tuple[float, float]) -> int:
    avg_density = clamp((density_range[0] + density_range[1]) / 2.0, 0.02, 0.45)
    return max(1, int(width * height * (1.0 - avg_density)))
