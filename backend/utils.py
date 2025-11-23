import ast
import math
from typing import Iterable, List, Optional, Tuple

def clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))

def clamp_int(value: int, low: int, high: int) -> int:
    return int(clamp(value, low, high))

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

def choose_from_range(rng, bounds: Tuple[float, float], integer: bool = True) -> int:
    if integer:
        lo = int(math.floor(bounds[0]))
        hi = int(math.floor(bounds[1]))
        if lo > hi:
            lo, hi = hi, lo
        return rng.randint(lo, hi)
    return rng.uniform(bounds[0], bounds[1])

def parse_cell(cell) -> Tuple[int, int]:
    if isinstance(cell, (list, tuple)) and len(cell) == 2:
        return int(cell[0]), int(cell[1])
    if isinstance(cell, str):
        try:
            parsed = ast.literal_eval(cell)
            if isinstance(parsed, (list, tuple)) and len(parsed) == 2:
                return int(parsed[0]), int(parsed[1])
        except Exception:
            stripped = cell.strip().strip("()[]")
            parts = [p.strip() for p in stripped.split(",")]
            if len(parts) == 2:
                return int(parts[0]), int(parts[1])
    raise ValueError(f"Invalid cell format: {cell}")

def neighbors4(node: Tuple[int, int], height: int, width: int) -> Iterable[Tuple[int, int]]:
    r, c = node
    for dr, dc in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        nr, nc = r + dr, c + dc
        if 0 <= nr < height and 0 <= nc < width:
            yield (nr, nc)

def manhattan(a: Tuple[int, int], b: Tuple[int, int]) -> int:
    return abs(a[0] - b[0]) + abs(a[1] - b[1])

def euclidean(a: Tuple[int, int], b: Tuple[int, int]) -> float:
    return math.hypot(a[0] - b[0], a[1] - b[1])

def estimate_walkable_cells(width: int, height: int, density_range: Tuple[float, float]) -> int:
    avg_density = clamp((density_range[0] + density_range[1]) / 2.0, 0.02, 0.45)
    return max(1, int(width * height * (1.0 - avg_density)))

def normalize_grid(grid_raw) -> List[List[int]]:
    grid = []
    for row in grid_raw:
        grid.append([int(v) for v in row])
    return grid

def normalize_positions(seq) -> List[Tuple[int, int]]:
    out = []
    for item in seq:
        out.append(parse_cell(item))
    return out
