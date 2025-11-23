from typing import List, Sequence, Tuple

from kka_backend.config import MAX_ROBOTS
from kka_backend.services.map_generation import ensure_forklift_loop
from kka_backend.utils.cells import normalize_positions, parse_cell
from kka_backend.utils.grid import ensure_perimeter_clear, normalize_grid


def apply_wall_changes(grid, adds, removes):
    height = len(grid)
    width = len(grid[0]) if height else 0
    new_grid = [row[:] for row in grid]
    for cell in removes:
        r, c = parse_cell(cell)
        if 0 <= r < height and 0 <= c < width:
            new_grid[r][c] = 0
    for cell in adds:
        r, c = parse_cell(cell)
        if 0 <= r < height and 0 <= c < width:
            new_grid[r][c] = 1
    ensure_perimeter_clear(new_grid)
    return new_grid


def validate_positions(cells: Sequence[Tuple[int, int]], grid: List[List[int]]) -> List[Tuple[int, int]]:
    height = len(grid)
    width = len(grid[0]) if height else 0
    out = []
    for cell in cells:
        r, c = cell
        if 0 <= r < height and 0 <= c < width and grid[r][c] == 0:
            out.append(cell)
    return out


def apply_manual_edits(payload: dict):
    grid = normalize_grid(payload.get("grid", []))
    robots = normalize_positions(payload.get("robots", []))
    tasks = normalize_positions(payload.get("tasks", []))
    moving = payload.get("moving", [])
    edits = payload.get("edits", {})
    adds_walls = edits.get("walls", {}).get("add", [])
    remove_walls = edits.get("walls", {}).get("remove", [])
    grid = apply_wall_changes(grid, adds_walls, remove_walls)
    add_tasks = normalize_positions(edits.get("tasks", {}).get("add", []))
    remove_tasks = {tuple(parse_cell(cell)) for cell in edits.get("tasks", {}).get("remove", [])}
    add_robots = normalize_positions(edits.get("robots", {}).get("add", []))
    remove_robots = {tuple(parse_cell(cell)) for cell in edits.get("robots", {}).get("remove", [])}
    new_tasks = [t for t in tasks if t not in remove_tasks]
    for task in add_tasks:
        if grid[task[0]][task[1]] == 0 and task not in new_tasks:
            new_tasks.append(task)
    new_robots = [r for r in robots if r not in remove_robots]
    for robot in add_robots:
        if grid[robot[0]][robot[1]] == 0 and robot not in new_robots:
            new_robots.append(robot)
    new_robots = new_robots[:MAX_ROBOTS]
    forklift_edits = edits.get("forklifts", {})
    move_existing = []
    for ob in moving:
        if isinstance(ob, dict):
            move_existing.append(ob)
    remove_indices = set(forklift_edits.get("remove", []))
    updated_moving = [
        ob for idx, ob in enumerate(move_existing) if idx not in remove_indices
    ]
    add_forklifts = forklift_edits.get("add", [])
    for ob in add_forklifts:
        path_raw = ob.get("path", [])
        try:
            path = [parse_cell(p) for p in path_raw]
        except Exception:
            path = []
        if len(path) < 2:
            continue
        valid = True
        for cell in path:
            r, c = cell
            if not (0 <= r < len(grid) and 0 <= c < len(grid[0])):
                valid = False
                break
            if grid[r][c] == 1:
                valid = False
                break
        if not valid:
            continue
        path, is_loop = ensure_forklift_loop(grid, path)
        updated_moving.append(
            {
                "path": [list(cell) for cell in path],
                "loop": is_loop or bool(ob.get("loop", True)),
                "period": len(path),
            }
        )
    report = {
        "robots": len(new_robots),
        "tasks": len(new_tasks),
        "forklifts": len(updated_moving),
    }
    return grid, [list(r) for r in new_robots], [list(t) for t in new_tasks], updated_moving, report
