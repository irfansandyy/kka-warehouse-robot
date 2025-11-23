import random
from typing import List, Optional, Sequence, Set, Tuple

from config import FORKLIFT_PATH_MAX, FORKLIFT_PATH_MIN
from pathfinding import shortest_path
from utils import neighbors4

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
    from grid import get_free_cells
    
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

def obstacle_timeline_index(length: int, step: int, loop: bool) -> int:
    if length <= 0:
        return 0
    if loop:
        return step % length
    return min(step, length - 1)

def build_dynamic_obstacle_timeline(moving: List[dict], horizon: int, start_time: int = 0):
    from utils import parse_cell
    
    timeline = {}
    for t in range(horizon + 1):
        timeline[start_time + t] = set()
    for ob in moving:
        path = ob.get("path", [])
        if not path:
            continue
        period = len(path)
        looping = bool(ob.get("loop", True))
        for idx in range(horizon + 1):
            cell = parse_cell(path[obstacle_timeline_index(period, start_time + idx, looping)])
            timeline[start_time + idx].add(cell)
    return timeline
