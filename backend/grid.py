import random
from collections import deque
from typing import List, Optional, Set, Tuple

from config import MAX_GENERATE_ATTEMPTS
from utils import clamp, choose_from_range, estimate_walkable_cells, neighbors4

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

def ensure_perimeter_clear(grid: List[List[int]]) -> None:
    height = len(grid)
    width = len(grid[0]) if height else 0
    for r in range(height):
        grid[r][0] = 0
        grid[r][width - 1] = 0
    for c in range(width):
        grid[0][c] = 0
        grid[height - 1][c] = 0

def generate_warehouse(
    seed: Optional[int],
    width: int,
    height: int,
    density_bounds: Tuple[float, float],
) -> Tuple[List[List[int]], float]:
    rng = random.Random(seed)
    best_grid: Optional[List[List[int]]] = None
    best_density: float = 0.0
    target_attempts = MAX_GENERATE_ATTEMPTS
    for attempt in range(target_attempts):
        density = clamp(choose_from_range(rng, density_bounds, integer=False), 0.02, 0.45)
        grid = [[0 for _ in range(width)] for _ in range(height)]
        ensure_perimeter_clear(grid)

        interior_columns = list(range(2, width - 2))
        rng.shuffle(interior_columns)
        shelf_columns = interior_columns[: max(1, int(len(interior_columns) * 0.4))]
        for c in shelf_columns:
            gaps = rng.sample(range(1, height - 1), k=max(1, height // 6))
            for r in range(1, height - 1):
                if r in gaps:
                    continue
                if rng.random() < 0.9:
                    grid[r][c] = 1

        target_walls = int(width * height * density)
        attempts = 0
        while attempts < target_walls:
            r = rng.randrange(1, height - 1)
            c = rng.randrange(1, width - 1)
            if grid[r][c] == 1:
                continue
            grid[r][c] = 1
            attempts += 1

        ensure_perimeter_clear(grid)
        free_cells = get_free_cells(grid)
        if not free_cells:
            continue
        reachable = bfs_component(grid, free_cells[0])
        ratio = len(reachable) / max(1, len(free_cells))
        if ratio >= 0.65:
            actual_density = 1.0 - len(free_cells) / (width * height)
            return grid, actual_density
        if best_grid is None or ratio > 0.5:
            best_grid = grid
            best_density = 1.0 - len(free_cells) / (width * height)
    if best_grid is None:
        best_grid = [[0 for _ in range(width)] for _ in range(height)]
        ensure_perimeter_clear(best_grid)
    return best_grid, best_density

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

def apply_wall_changes(grid, adds, removes):
    height = len(grid)
    width = len(grid[0]) if height else 0
    new_grid = [row[:] for row in grid]
    for cell in removes:
        from utils import parse_cell
        r, c = parse_cell(cell)
        if 0 <= r < height and 0 <= c < width:
            new_grid[r][c] = 0
    for cell in adds:
        from utils import parse_cell
        r, c = parse_cell(cell)
        if 0 <= r < height and 0 <= c < width:
            new_grid[r][c] = 1
    ensure_perimeter_clear(new_grid)
    return new_grid

def validate_positions(cells, grid: List[List[int]]) -> List[Tuple[int, int]]:
    height = len(grid)
    width = len(grid[0]) if height else 0
    out = []
    for cell in cells:
        r, c = cell
        if 0 <= r < height and 0 <= c < width and grid[r][c] == 0:
            out.append(cell)
    return out
