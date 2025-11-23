import os
from typing import Tuple


def _int(name: str, default: int) -> int:
    value = os.getenv(name)
    if value is None:
        return default
    try:
        return int(value)
    except ValueError:
        return default


def _float(name: str, default: float) -> float:
    value = os.getenv(name)
    if value is None:
        return default
    try:
        return float(value)
    except ValueError:
        return default


def _float_range(name: str, default: Tuple[float, float]) -> Tuple[float, float]:
    raw = os.getenv(name)
    if not raw:
        return default
    parts = [p.strip() for p in raw.split(",") if p.strip()]
    if len(parts) != 2:
        return default
    try:
        return float(parts[0]), float(parts[1])
    except ValueError:
        return default


def _int_range(name: str, default: Tuple[int, int]) -> Tuple[int, int]:
    raw = os.getenv(name)
    if not raw:
        return default
    parts = [p.strip() for p in raw.split(",") if p.strip()]
    if len(parts) != 2:
        return default
    try:
        return int(parts[0]), int(parts[1])
    except ValueError:
        return default


MAX_ROBOTS = _int("MAX_ROBOTS", 5)
MAX_WIDTH = _int("MAX_WIDTH", 200)
MAX_HEIGHT = _int("MAX_HEIGHT", 200)
MAX_GENERATE_ATTEMPTS = _int("MAX_GENERATE_ATTEMPTS", 12)
DEFAULT_WALL_RANGE = _float_range("DEFAULT_WALL_RANGE", (0.02, 0.06))
DEFAULT_TASK_RANGE = _int_range("DEFAULT_TASK_RANGE", (12, 24))
DEFAULT_MOVING_RANGE = _int_range("DEFAULT_MOVING_RANGE", (1, 6))
DEFAULT_ROBOT_RANGE = _int_range("DEFAULT_ROBOT_RANGE", (2, 4))
FORKLIFT_PATH_MIN = _int("FORKLIFT_PATH_MIN", 100)
FORKLIFT_PATH_MAX = _int("FORKLIFT_PATH_MAX", 100)

_colors = os.getenv("ROBOT_COLORS")
if _colors:
    ROBOT_COLORS = [part.strip() for part in _colors.split(",") if part.strip()]
else:
    ROBOT_COLORS = ["#0b69ff", "#ff5f55", "#2dbf88", "#e2a72e", "#7b5fff"]
