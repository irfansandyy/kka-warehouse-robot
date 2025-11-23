from collections import deque
from typing import Iterable, List, Optional, Sequence, Set, Tuple

from .geometry import neighbors4


def get_free_cells(grid: List[List[int]]) -> List[Tuple[int, int]]:
    height = len(grid)
    width = len(grid[0]) if height else 0
    return [(r, c) for r in range(height) for c in range(width) if grid[r][c] == 0]


def bfs_component(grid: List[List[int]], start: Tuple[int, int]) -> Set[Tuple[int, int]]:
    height = len(grid)
    width = len(grid[0]) if height else 0
    visited: Set[Tuple[int, int]] = set()
    queue = deque([start])
    visited.add(start)
    while queue:
        cell = queue.popleft()
        for nb in neighbors4(cell, height, width):
            if grid[nb[0]][nb[1]] != 0:
                continue
            if nb in visited:
                continue
            visited.add(nb)
            queue.append(nb)
    return visited


def shortest_path(
    grid: List[List[int]],
    start: Tuple[int, int],
    goal: Tuple[int, int],
    blocked: Set[Tuple[int, int]],
    allow: Optional[Set[Tuple[int, int]]] = None,
) -> Optional[List[Tuple[int, int]]]:
    if start == goal:
        return [start]
    height = len(grid)
    width = len(grid[0]) if height else 0
    allow = allow or set()
    queue = deque([(start, [start])])
    visited = {start}
    while queue:
        cell, path = queue.popleft()
        for nb in neighbors4(cell, height, width):
            if grid[nb[0]][nb[1]] == 1:
                continue
            if nb in blocked and nb not in allow:
                continue
            if nb in visited:
                continue
            visited.add(nb)
            new_path = path + [nb]
            if nb == goal:
                return new_path
            queue.append((nb, new_path))
    return None


def ensure_perimeter_clear(grid: List[List[int]]) -> None:
    height = len(grid)
    width = len(grid[0]) if height else 0
    for r in range(height):
        grid[r][0] = 0
        grid[r][width - 1] = 0
    for c in range(width):
        grid[0][c] = 0
        grid[height - 1][c] = 0


def normalize_grid(grid_raw: Sequence[Sequence[int]]) -> List[List[int]]:
    grid = []
    for row in grid_raw:
        grid.append([int(v) for v in row])
    return grid
