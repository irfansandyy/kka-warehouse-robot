import random
from typing import List, Optional, Sequence, Set, Tuple

from kka_backend.config import (
    FORKLIFT_PATH_MAX,
    FORKLIFT_PATH_MIN,
    MAX_GENERATE_ATTEMPTS,
)
from kka_backend.utils.geometry import neighbors4
from kka_backend.utils.grid import (
    bfs_component,
    ensure_perimeter_clear,
    get_free_cells,
    shortest_path,
)
from kka_backend.utils.numeric import clamp
from kka_backend.utils.ranges import choose_from_range


def generate_warehouse(
    seed: Optional[int],
    width: int,
    height: int,
    density_bounds: Tuple[float, float],
) -> Tuple[List[List[int]], float]:
    rng = random.Random(seed)
    best_grid: Optional[List[List[int]]] = None
    best_density: float = 0.0
    for _ in range(MAX_GENERATE_ATTEMPTS):
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


def build_forklift_loop(
    grid: List[List[int]],
    start: Tuple[int, int],
    rng: random.Random,
    min_len: int,
    max_len: int,
    blocked: Set[Tuple[int, int]],
) -> Optional[List[Tuple[int, int]]]:
    height = len(grid)
    width = len(grid[0]) if height else 0
    target_len = rng.randint(min_len, max_len)
    path = [start]
    blocked_local = set(blocked)
    blocked_local.add(start)
    current = start
    for _ in range(target_len - 1):
        choices = [
            nb
            for nb in neighbors4(current, height, width)
            if grid[nb[0]][nb[1]] == 0 and nb not in blocked_local
        ]
        rng.shuffle(choices)
        if not choices:
            break
        nxt = choices.pop()
        path.append(nxt)
        blocked_local.add(nxt)
        current = nxt
    if len(path) < 2:
        return None
    blocked_for_return = set(blocked)
    blocked_for_return.update(path[1:-1])
    closing = shortest_path(grid, current, start, blocked_for_return, allow=set(path))
    if not closing:
        return None
    full = path[:-1] + closing
    if len(set(full)) < 2:
        return None
    return full


def build_forklift_random_walk(
    grid: List[List[int]],
    start: Tuple[int, int],
    rng: random.Random,
    min_len: int,
    max_len: int,
    blocked: Optional[Set[Tuple[int, int]]] = None,
) -> List[Tuple[int, int]]:
    height = len(grid)
    width = len(grid[0]) if height else 0
    target_len = max(2, rng.randint(min_len, max_len))
    path = [start]
    current = start
    prev: Optional[Tuple[int, int]] = None
    restricted = set(blocked or set())
    for _ in range(target_len - 1):
        candidates = []
        for dr, dc in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nr = current[0] + dr
            nc = current[1] + dc
            nxt = (nr, nc)
            if not (0 <= nr < height and 0 <= nc < width):
                continue
            if grid[nr][nc] == 1 or nxt in restricted:
                continue
            candidates.append(nxt)
        if prev is not None and len(candidates) > 1:
            filtered = [cell for cell in candidates if cell != prev]
            if filtered:
                candidates = filtered
        if not candidates:
            break
        nxt = rng.choice(candidates)
        path.append(nxt)
        prev = current
        current = nxt
    return path


def ensure_forklift_loop(
    grid: List[List[int]],
    path: List[Tuple[int, int]],
) -> Tuple[List[Tuple[int, int]], bool]:
    if len(path) < 2:
        return path, False
    start = path[0]
    end = path[-1]
    closing = shortest_path(grid, end, start, blocked=set())
    if closing and len(closing) > 1:
        looped = path + closing[1:]
        return looped, True
    return path, False


def generate_moving_obstacles(
    grid: List[List[int]],
    count: int,
    rng: random.Random,
    robots: Sequence[Tuple[int, int]],
    tasks: Sequence[Tuple[int, int]],
) -> List[dict]:
    height = len(grid)
    width = len(grid[0]) if height else 0
    base_blocked: Set[Tuple[int, int]] = set(robots)
    base_blocked.update(tasks)
    for cell in list(base_blocked):
        for nb in neighbors4(cell, height, width):
            base_blocked.add(nb)
    free_cells = [cell for cell in get_free_cells(grid) if cell not in base_blocked]
    rng.shuffle(free_cells)
    obstacles = []
    occupied = set(base_blocked)
    for idx in range(count):
        while free_cells and free_cells[-1] in occupied:
            free_cells.pop()
        if not free_cells:
            break
        start = free_cells.pop()
        blocked_for_walk = set(occupied)
        blocked_for_walk.discard(start)
        walk = build_forklift_random_walk(
            grid,
            start,
            rng,
            FORKLIFT_PATH_MIN,
            FORKLIFT_PATH_MAX,
            blocked=blocked_for_walk,
        )
        if not walk or len(walk) < 2:
            continue
        walk, is_loop = ensure_forklift_loop(grid, walk)
        occupied.update(walk)
        obstacles.append(
            {
                "id": idx,
                "path": walk,
                "loop": is_loop,
                "period": len(walk),
            }
        )
    return obstacles
