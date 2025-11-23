import ast
from typing import Iterable, List, Sequence, Tuple


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


def normalize_positions(seq: Sequence[Iterable[int]]) -> List[Tuple[int, int]]:
    out = []
    for item in seq:
        out.append(parse_cell(item))
    return out
