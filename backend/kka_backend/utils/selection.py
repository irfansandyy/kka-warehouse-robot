import random
from typing import List, Optional, Set, Tuple


def select_unique_cells(
    rng: random.Random,
    pool: List[Tuple[int, int]],
    count: int,
    forbidden: Optional[Set[Tuple[int, int]]] = None,
) -> List[Tuple[int, int]]:
    if count <= 0:
        return []
    forbidden = forbidden or set()
    eligible = [cell for cell in pool if cell not in forbidden]
    if not eligible:
        return []
    if count >= len(eligible):
        selected = eligible
    else:
        selected = rng.sample(eligible, count)
    for cell in selected:
        if cell in pool:
            pool.remove(cell)
        forbidden.add(cell)
    return selected
