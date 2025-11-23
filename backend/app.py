from flask import Flask, request, jsonify
from flask_cors import CORS
import ast
import math
import random
import heapq
import time
from collections import deque
from typing import Dict, Iterable, List, Optional, Sequence, Set, Tuple

app = Flask(__name__)
CORS(app)

MAX_ROBOTS = 5
MAX_WIDTH = 60
MAX_HEIGHT = 60
MAX_GENERATE_ATTEMPTS = 12
DEFAULT_WALL_RANGE = (0.02, 0.06)
DEFAULT_TASK_RANGE = (12, 24)
DEFAULT_MOVING_RANGE = (1, 4)
DEFAULT_ROBOT_RANGE = (2, 4)
FORKLIFT_PATH_MIN = 4
FORKLIFT_PATH_MAX = 12
ROBOT_COLORS = ["#0b69ff", "#ff5f55", "#2dbf88", "#e2a72e", "#7b5fff"]


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


def choose_from_range(rng: random.Random, bounds: Tuple[float, float], integer: bool = True) -> int:
    if integer:
        lo = int(math.floor(bounds[0]))
        hi = int(math.floor(bounds[1]))
        if lo > hi:
            lo, hi = hi, lo
        return rng.randint(lo, hi)
    return rng.uniform(bounds[0], bounds[1])


def neighbors4(node: Tuple[int, int], height: int, width: int) -> Iterable[Tuple[int, int]]:
    r, c = node
    for dr, dc in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        nr, nc = r + dr, c + dc
        if 0 <= nr < height and 0 <= nc < width:
            yield (nr, nc)


def manhattan(a: Tuple[int, int], b: Tuple[int, int]) -> int:
    return abs(a[0] - b[0]) + abs(a[1] - b[1])


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

        # Place shelving corridors with guaranteed walkways
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

        # Scatter additional obstacles based on density target
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
    closing = shortest_path(
        grid,
        current,
        start,
        blocked_for_return,
        allow=set(path),
    )
    if not closing:
        return None
    full = path[:-1] + closing
    if len(set(full)) < 2:
        return None
    return full


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
        if not free_cells:
            break
        start = free_cells.pop()
        loop = build_forklift_loop(
            grid,
            start,
            rng,
            FORKLIFT_PATH_MIN,
            FORKLIFT_PATH_MAX,
            occupied,
        )
        if not loop:
            continue
        occupied.update(loop)
        obstacles.append(
            {
                "id": idx,
                "path": loop,
                "loop": True,
                "period": len(loop),
            }
        )
    return obstacles


def analyze_reachability(
    robots: Sequence[Tuple[int, int]],
    tasks: Sequence[Tuple[int, int]],
    planner: "PathLibrary",
) -> Tuple[List[Tuple[int, int]], List[Tuple[int, int]], List[Tuple[int, int]], List[Tuple[int, int]]]:
    if not robots:
        return [], [], list(tasks), []
    if not tasks:
        return list(robots), [], [], []

    reachable_tasks: Set[Tuple[int, int]] = set()
    active: List[Tuple[int, int]] = []
    inactive: List[Tuple[int, int]] = []

    for robot in robots:
        robot_has_path = False
        for task in tasks:
            info = planner.ensure(robot, task)
            if info.get("path"):
                robot_has_path = True
                reachable_tasks.add(task)
        if robot_has_path:
            active.append(robot)
        else:
            inactive.append(robot)

    assignable_tasks = [task for task in tasks if task in reachable_tasks]
    unreachable_tasks = [task for task in tasks if task not in reachable_tasks]

    return active, inactive, assignable_tasks, unreachable_tasks


class PathLibrary:
    def __init__(self, grid: List[List[int]], alg: str):
        self.grid = grid
        self.alg = alg
        self.cache: Dict[Tuple[Tuple[int, int], Tuple[int, int]], dict] = {}

    def _solve(self, start: Tuple[int, int], goal: Tuple[int, int]) -> dict:
        planner = astar if self.alg == "astar" else dijkstra
        path, nodes, elapsed = planner(self.grid, start, goal)
        if not path:
            return {
                "path": [],
                "cost": math.inf,
                "nodes": nodes,
                "time": elapsed,
            }
        cost = max(len(path) - 1, 0)
        return {
            "path": path,
            "cost": cost,
            "nodes": nodes,
            "time": elapsed,
        }

    def ensure(self, start: Tuple[int, int], goal: Tuple[int, int]) -> dict:
        key = (start, goal)
        if key not in self.cache:
            self.cache[key] = self._solve(start, goal)
        return self.cache[key]

    def cost(self, start: Tuple[int, int], goal: Tuple[int, int]) -> float:
        return self.ensure(start, goal)["cost"]

    def path(self, start: Tuple[int, int], goal: Tuple[int, int]) -> List[Tuple[int, int]]:
        return self.ensure(start, goal)["path"]


def astar(
    grid: List[List[int]],
    start: Tuple[int, int],
    goal: Tuple[int, int],
    heuristic=manhattan,
    dynamic_obstacles: Optional[Iterable] = None,
):
    t0 = time.perf_counter()
    openh: List[Tuple[float, int, Tuple[int, int]]] = []
    heapq.heappush(openh, (heuristic(start, goal), 0, start))
    came: Dict[Tuple[int, int], Tuple[int, int]] = {}
    gscore = {start: 0}
    closed: Set[Tuple[int, int]] = set()
    nodes = 0

    height = len(grid)
    width = len(grid[0]) if height else 0

    dyn_lookup: Dict[int, Set[Tuple[int, int]]] = {}
    static_dyn: Set[Tuple[int, int]] = set()
    if isinstance(dynamic_obstacles, dict):
        dyn_lookup = {
            int(k): {tuple(cell) for cell in v}
            for k, v in dynamic_obstacles.items()
        }
    elif dynamic_obstacles:
        static_dyn = {tuple(cell) for cell in dynamic_obstacles}

    while openh:
        f, g, cur = heapq.heappop(openh)
        if cur in closed:
            continue
        nodes += 1
        if cur == goal:
            path = [cur]
            while cur in came:
                cur = came[cur]
                path.append(cur)
            path.reverse()
            return path, nodes, time.perf_counter() - t0
        closed.add(cur)
        for nb in neighbors4(cur, height, width):
            if grid[nb[0]][nb[1]] == 1:
                continue
            if static_dyn and nb in static_dyn:
                continue
            next_step = g + 1
            if dyn_lookup:
                blocked = dyn_lookup.get(next_step, set())
                if nb in blocked:
                    continue
            tentative = g + 1
            if tentative < gscore.get(nb, math.inf):
                gscore[nb] = tentative
                came[nb] = cur
                heapq.heappush(
                    openh,
                    (tentative + heuristic(nb, goal), tentative, nb),
                )
    return [], nodes, time.perf_counter() - t0


def dijkstra(grid, start, goal):
    return astar(grid, start, goal, heuristic=lambda a, b: 0)


def greedy_assign(
    grid: List[List[int]],
    robots: Sequence[Tuple[int, int]],
    tasks: Sequence[Tuple[int, int]],
    alg: str,
    planner: PathLibrary,
) -> Dict[Tuple[int, int], List[Tuple[int, int]]]:
    remaining = list(tasks)
    assigned = {r: [] for r in robots}
    robot_pos = {r: r for r in robots}
    while remaining:
        best = None
        best_cost = math.inf
        for r in robots:
            cur = robot_pos[r]
            for t in remaining:
                d = planner.cost(cur, t)
                if d < best_cost:
                    best_cost = d
                    best = (r, t)
        if best is None or best_cost == math.inf:
            break
        r, t = best
        assigned[r].append(t)
        robot_pos[r] = t
        remaining.remove(t)
    return assigned


def ga_assign(
    grid: List[List[int]],
    robots: Sequence[Tuple[int, int]],
    tasks: Sequence[Tuple[int, int]],
    alg: str,
    planner: PathLibrary,
    pop: int = 24,
    gens: int = 40,
    pmut: float = 0.25,
) -> Dict[Tuple[int, int], List[Tuple[int, int]]]:
    if not tasks:
        return {r: [] for r in robots}
    rng = random.Random()
    num_robots = len(robots)

    greedy_seed = greedy_assign(grid, robots, tasks, alg, planner)
    greedy_flat = []
    for r in robots:
        greedy_flat.extend(greedy_seed.get(r, []))
    if not greedy_flat:
        greedy_flat = list(tasks)

    def split_chrom(chrom: Sequence[Tuple[int, int]]) -> List[List[Tuple[int, int]]]:
        n = len(chrom)
        sizes = [n // num_robots] * num_robots
        for i in range(n % num_robots):
            sizes[i] += 1
        out = []
        idx = 0
        for s in sizes:
            out.append(list(chrom[idx : idx + s]))
            idx += s
        return out

    def fitness(chrom: Sequence[Tuple[int, int]]) -> float:
        parts = split_chrom(chrom)
        total = 0.0
        for robot_idx, r in enumerate(robots):
            cur = r
            for t in parts[robot_idx]:
                total += planner.cost(cur, t)
                cur = t
        return total

    population: List[List[Tuple[int, int]]] = []
    base = list(tasks)
    population.append(greedy_flat)
    for _ in range(pop - 1):
        rng.shuffle(base)
        population.append(base[:])

    for _ in range(gens):
        scored = sorted(((fitness(chrom), chrom) for chrom in population), key=lambda x: x[0])
        survivors = [scored[0][1], scored[1][1]]
        while len(survivors) < pop:
            parents = rng.sample(scored[: max(2, pop // 3)], k=2)
            a = parents[0][1]
            b = parents[1][1]
            cut = rng.randint(0, len(tasks) - 1)
            prefix = a[:cut]
            child = prefix + [x for x in b if x not in prefix]
            if rng.random() < pmut and len(child) > 1:
                i, j = rng.sample(range(len(child)), 2)
                child[i], child[j] = child[j], child[i]
            survivors.append(child)
        population = survivors

    best = min(population, key=fitness)
    parts = split_chrom(best)
    result = {}
    for idx, r in enumerate(robots):
        result[r] = parts[idx]
    return result


def local_search_assign(
    grid: List[List[int]],
    robots: Sequence[Tuple[int, int]],
    tasks: Sequence[Tuple[int, int]],
    alg: str,
    planner: PathLibrary,
    iters: int = 1500,
) -> Dict[Tuple[int, int], List[Tuple[int, int]]]:
    assigned = greedy_assign(grid, robots, tasks, alg, planner)
    flat = []
    for r in robots:
        flat.extend(assigned.get(r, []))
    if not flat:
        return assigned

    rng = random.Random()
    best = flat[:]

    def split(chrom: Sequence[Tuple[int, int]]) -> List[List[Tuple[int, int]]]:
        n = len(chrom)
        num_robots = len(robots)
        sizes = [n // num_robots] * num_robots
        for i in range(n % num_robots):
            sizes[i] += 1
        idx = 0
        parts = []
        for s in sizes:
            parts.append(list(chrom[idx : idx + s]))
            idx += s
        return parts

    def score(chrom: Sequence[Tuple[int, int]]) -> float:
        parts = split(chrom)
        total = 0.0
        for robot_idx, r in enumerate(robots):
            cur = r
            for t in parts[robot_idx]:
                total += planner.cost(cur, t)
                cur = t
        return total

    best_score = score(best)
    for _ in range(iters):
        i, j = rng.sample(range(len(best)), 2)
        candidate = best[:]
        candidate[i], candidate[j] = candidate[j], candidate[i]
        val = score(candidate)
        if val < best_score:
            best = candidate
            best_score = val

    parts = split(best)
    out = {}
    for idx, r in enumerate(robots):
        out[r] = parts[idx]
    return out


def compile_task_assignments(
    robots: Sequence[Tuple[int, int]],
    assigned: Dict[Tuple[int, int], List[Tuple[int, int]]],
    planner: PathLibrary,
) -> Tuple[List[dict], Dict[str, dict]]:
    robot_payload = []
    task_map: Dict[str, dict] = {}
    for idx, robot in enumerate(robots):
        color = ROBOT_COLORS[idx % len(ROBOT_COLORS)]
        tasks_for_robot = assigned.get(robot, [])
        legs = []
        cur = robot
        total_cost = 0.0
        for order, task in enumerate(tasks_for_robot, start=1):
            info = planner.ensure(cur, task)
            legs.append(
                {
                    "order": order,
                    "task": list(task),
                    "cost": info["cost"],
                    "path": info["path"],
                }
            )
            total_cost += info["cost"]
            cur = task
            task_map[f"{task[0]},{task[1]}"] = {
                "robot_index": idx,
                "robot_start": list(robot),
                "order": order,
                "color": color,
                "cost": info["cost"],
            }
        robot_payload.append(
            {
                "id": idx,
                "color": color,
                "start": list(robot),
                "assignments": legs,
                "total_cost": total_cost,
            }
        )
    return robot_payload, task_map


def csp_schedule(paths, moving_obstacles, max_offset=20):
    max_path_len = 0
    for seq in paths.values():
        if isinstance(seq, list):
            max_path_len = max(max_path_len, len(seq))
    horizon = int(max_offset + max_path_len + 10)

    obstruct = set()
    obstruct_edges = set()
    for ob in moving_obstacles:
        p = ob.get("path", [])
        L = len(p)
        if L == 0:
            continue
        for t in range(horizon + 1):
            a = p[t % L]
            obstruct.add((a, t))
            if L > 1:
                b = p[(t + 1) % L]
                if a != b:
                    obstruct_edges.add((a, b, t))

    robots = list(paths.keys())
    assigned = {}
    nodes_expanded = 0

    def backtrack(idx):
        nonlocal nodes_expanded
        if idx == len(robots):
            return True
        r = robots[idx]
        P = paths[r]
        for s in range(0, max_offset + 1):
            nodes_expanded += 1
            bad = False
            for k, cell in enumerate(P):
                t = s + k
                if (cell, t) in obstruct:
                    bad = True
                    break
            if bad:
                continue
            for k in range(len(P) - 1):
                a = P[k]
                b = P[k + 1]
                t = s + k
                if (b, a, t) in obstruct_edges:
                    bad = True
                    break
            if bad:
                continue
            for other, so in assigned.items():
                Po = paths[other]
                for k, cell in enumerate(P):
                    t = s + k
                    for mo, k2 in enumerate(Po):
                        if so + mo == t and k2 == cell:
                            bad = True
                            break
                    if bad:
                        break
                if bad:
                    break
                for k in range(len(P) - 1):
                    a = P[k]
                    b = P[k + 1]
                    t = s + k
                    for mo in range(len(Po) - 1):
                        a2 = Po[mo]
                        b2 = Po[mo + 1]
                        if so + mo == t and a == b2 and b == a2:
                            bad = True
                            break
                    if bad:
                        break
                if bad:
                    break
            if bad:
                continue
            assigned[r] = s
            if backtrack(idx + 1):
                return True
            del assigned[r]
        return False

    ok = backtrack(0)
    return {"ok": ok, "start_times": assigned, "nodes": nodes_expanded}


def build_timeline(path: List[Tuple[int, int]], tasks: List[Tuple[int, int]]) -> List[dict]:
    timeline = []
    task_iter = list(tasks)
    reached = 0
    for time_step, cell in enumerate(path):
        marker = None
        if reached < len(task_iter) and cell == task_iter[reached]:
            reached += 1
            marker = {
                "task": list(cell),
                "order": reached,
            }
        timeline.append(
            {
                "time": time_step,
                "cell": list(cell),
                "reached_task": marker,
            }
        )
    return timeline


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


def snapshot_meta(
    width: int,
    height: int,
    num_robots: int,
    num_tasks: int,
    num_moving: int,
    seed: Optional[int],
    density: float,
) -> dict:
    return {
        "width": width,
        "height": height,
        "num_robots": num_robots,
        "num_tasks": num_tasks,
        "num_moving": num_moving,
        "seed": seed,
        "wall_density": density,
    }


@app.route("/api/generate_map", methods=["POST"])
def api_generate_map():
    body = request.get_json() or {}
    seed_input = body.get("seed")
    seed = int(seed_input) if seed_input is not None else None
    rng = random.Random(seed)

    width = clamp_int(body.get("width", 30), 8, MAX_WIDTH)
    height = clamp_int(body.get("height", 20), 8, MAX_HEIGHT)

    wall_range = parse_range(
        body.get("wall_density_range"),
        DEFAULT_WALL_RANGE,
        integer=False,
        low=0.02,
        high=0.45,
    )
    robot_range = parse_range(
        body.get("robot_count_range"),
        DEFAULT_ROBOT_RANGE,
        integer=True,
        low=1,
        high=MAX_ROBOTS,
    )
    moving_range = parse_range(
        body.get("moving_count_range"),
        DEFAULT_MOVING_RANGE,
        integer=True,
        low=0,
        high=10,
    )
    task_range = parse_range(
        body.get("task_count_range"),
        DEFAULT_TASK_RANGE,
        integer=True,
        low=3,
        high=width * height,
    )

    num_robots_requested = body.get("num_robots")
    if num_robots_requested is not None:
        num_robots = clamp_int(int(num_robots_requested), 1, MAX_ROBOTS)
    else:
        num_robots = clamp_int(choose_from_range(rng, robot_range, integer=True), 1, MAX_ROBOTS)

    tasks_target = 3 * num_robots + 3
    tasks_min, tasks_max = task_range
    tasks_count = clamp_int(tasks_target, int(tasks_min), int(tasks_max))

    moving_requested = body.get("moving")
    if moving_requested is not None:
        moving_count = max(0, int(moving_requested))
    else:
        moving_count = max(0, choose_from_range(rng, moving_range, integer=True))

    grid, actual_density = generate_warehouse(seed, width, height, wall_range)
    free_cells = get_free_cells(grid)
    if not free_cells:
        free_cells = [(0, 0)]

    robots = select_unique_cells(rng, list(free_cells), num_robots, forbidden=set())
    remaining_free = [cell for cell in free_cells if cell not in robots]
    tasks = select_unique_cells(rng, remaining_free, tasks_count, forbidden=set(robots))
    tasks = tasks or select_unique_cells(rng, list(free_cells), tasks_count, forbidden=set(robots))

    moving = generate_moving_obstacles(grid, moving_count, rng, robots, tasks)

    response = {
        "grid": grid,
        "tasks": [list(t) for t in tasks],
        "robots": [list(r) for r in robots],
        "moving": [
            {
                **ob,
                "path": [list(cell) for cell in ob["path"]],
            }
            for ob in moving
        ],
        "meta": snapshot_meta(
            width,
            height,
            len(robots),
            len(tasks),
            len(moving),
            seed,
            actual_density,
        ),
    }
    return jsonify(response)


@app.route("/api/plan_tasks", methods=["POST"])
def api_plan_tasks():
    body = request.get_json() or {}
    grid = normalize_grid(body.get("grid", []))
    robots = normalize_positions(body.get("robots", []))
    tasks = normalize_positions(body.get("tasks", []))
    optimizer = body.get("optimizer", "greedy").lower()
    alg = body.get("path_alg", "astar")

    t_planning_start = time.perf_counter()
    planner = PathLibrary(grid, alg)
    active_robots, inactive_robots, assignable_tasks, unreachable_tasks = analyze_reachability(robots, tasks, planner)

    assigned_subset: Dict[Tuple[int, int], List[Tuple[int, int]]] = {r: [] for r in active_robots}
    if active_robots and assignable_tasks:
        if optimizer == "greedy":
            assigned_subset = greedy_assign(grid, active_robots, assignable_tasks, alg, planner)
        elif optimizer == "ga":
            assigned_subset = ga_assign(grid, active_robots, assignable_tasks, alg, planner)
        else:
            assigned_subset = local_search_assign(grid, active_robots, assignable_tasks, alg, planner)

    assigned = {r: [] for r in robots}
    for robot, seq in assigned_subset.items():
        assigned[robot] = seq
    planning_time_ms = (time.perf_counter() - t_planning_start) * 1000.0

    robot_payload, task_map = compile_task_assignments(robots, assigned, planner)
    legacy_costs = {}
    for robot, entries in assigned.items():
        cur = robot
        legs = []
        total = 0.0
        for t in entries:
            info = planner.ensure(cur, t)
            legs.append(
                {
                    "to": list(t),
                    "cost": info["cost"],
                    "path": [list(cell) for cell in info["path"]],
                }
            )
            total += info["cost"]
            cur = t
        legacy_costs[str(list(robot))] = {
            "tasks": [list(t) for t in entries],
            "legs": legs,
            "total_cost": total,
        }

    response = {
        "assigned": {str(list(k)): [list(t) for t in v] for k, v in assigned.items()},
        "robots": robot_payload,
        "task_assignments": task_map,
        "costs": legacy_costs,
        "metrics": {
            "planning_time_ms": planning_time_ms,
            "robots_considered": len(robots),
            "tasks_considered": len(tasks),
            "active_robots": len(active_robots),
            "inactive_robots": len(inactive_robots),
            "assignable_tasks": len(assignable_tasks),
            "unreachable_tasks": len(unreachable_tasks),
        },
    }
    return jsonify(response)


@app.route("/api/compute_paths", methods=["POST"])
def api_compute_paths():
    body = request.get_json() or {}
    grid = normalize_grid(body.get("grid", []))
    alg = body.get("alg", "astar")
    rp_in = body.get("robot_plans", {})
    robot_plans = {parse_cell(k): [parse_cell(t) for t in v] for k, v in rp_in.items()}
    planner = PathLibrary(grid, alg)

    t_paths_start = time.perf_counter()
    base_paths = {}
    perrobot_stats = {}
    for robot, seq in robot_plans.items():
        cur = robot
        full = [cur]
        nodes = 0
        elapsed = 0.0
        for goal in seq:
            info = planner.ensure(cur, goal)
            path = info["path"]
            if not path:
                return jsonify({"ok": False, "reason": "no_path", "robot": robot, "to": goal})
            if full and path:
                if full[-1] == path[0]:
                    full.extend(path[1:])
                else:
                    full.extend(path)
            else:
                full.extend(path)
            nodes += info["nodes"]
            elapsed += info["time"]
            cur = goal
        base_paths[robot] = full
        robot_key = str(list(robot))
        perrobot_stats[robot_key] = {
            "planner_nodes": nodes,
            "planner_time_s": elapsed,
            "path_steps": max(len(full) - 1, 0),
        }
    path_compute_time_ms = (time.perf_counter() - t_paths_start) * 1000.0

    moving = body.get("moving", [])
    moving_obs = []
    for ob in moving:
        if not isinstance(ob, dict):
            continue
        try:
            norm_path = [parse_cell(pos) for pos in ob.get("path", [])]
        except Exception:
            norm_path = []
        moving_obs.append(
            {
                "path": norm_path,
                "loop": bool(ob.get("loop", True)),
            }
        )

    t_schedule_start = time.perf_counter()
    csp = csp_schedule(base_paths, moving_obs, max_offset=40)
    schedule_time_ms = (time.perf_counter() - t_schedule_start) * 1000.0
    scheduled_paths = {}
    for robot, path in base_paths.items():
        delay = csp.get("start_times", {}).get(robot, 0)
        wait_segment = [path[0]] * int(delay) if path else []
        full = wait_segment + path
        robot_key = str(list(robot))
        scheduled_paths[robot_key] = [list(cell) for cell in full]

        entry = perrobot_stats.setdefault(robot_key, {})
        entry.setdefault("path_steps", max(len(path) - 1, 0))
        wait_steps = max(int(delay), 0)
        execution_steps = max(len(full) - 1, 0)
        entry["wait_steps"] = wait_steps
        entry["execution_steps"] = execution_steps
        entry["execution_time_s"] = execution_steps

    response_paths = {str(list(k)): [list(cell) for cell in v] for k, v in base_paths.items()}
    step_meta = {}
    for robot, path in scheduled_paths.items():
        key_robot = parse_cell(robot)
        timeline = build_timeline([tuple(cell) for cell in path], robot_plans.get(key_robot, []))
        step_meta[robot] = timeline

    if isinstance(csp.get("start_times"), dict):
        csp["start_times"] = {str(list(k)): v for k, v in csp["start_times"].items()}

    return jsonify(
        {
            "ok": True,
            "paths": response_paths,
            "scheduled_paths": scheduled_paths,
            "stats": perrobot_stats,
            "step_metadata": step_meta,
            "csp": csp,
            "timing": {
                "path_compute_time_ms": path_compute_time_ms,
                "schedule_time_ms": schedule_time_ms,
                "total_execution_time_ms": path_compute_time_ms + schedule_time_ms,
            },
        }
    )


def build_dynamic_obstacle_timeline(moving: List[dict], horizon: int, start_time: int = 0) -> Dict[int, Set[Tuple[int, int]]]:
    timeline: Dict[int, Set[Tuple[int, int]]] = {}
    for t in range(horizon + 1):
        timeline[start_time + t] = set()
    for ob in moving:
        path = ob.get("path", [])
        if not path:
            continue
        period = len(path)
        for idx in range(horizon + 1):
            cell = parse_cell(path[(start_time + idx) % period])
            timeline[start_time + idx].add(cell)
    return timeline


@app.route("/api/replan", methods=["POST"])
def api_replan():
    body = request.get_json() or {}
    grid = normalize_grid(body.get("grid", []))
    start = parse_cell(body.get("start"))
    tasks_remaining = normalize_positions(body.get("tasks_remaining", []))
    moving = body.get("moving", [])
    current_time = int(body.get("current_time", 0))
    horizon = max(40, len(tasks_remaining) * 12)

    dynamic_timeline = {}
    if moving:
        dynamic_timeline = build_dynamic_obstacle_timeline(moving, horizon, current_time)

    if not tasks_remaining:
        return jsonify({"ok": True, "path": [list(start)]})

    full_path: List[Tuple[int, int]] = []
    cur = start
    time_offset = current_time
    for goal in tasks_remaining:
        dyn_subset = {
            t - time_offset: list(cells)
            for t, cells in dynamic_timeline.items()
            if t >= time_offset
        }
        path, _, _ = astar(
            grid,
            cur,
            goal,
            heuristic=manhattan,
            dynamic_obstacles={k: set(map(tuple, v)) for k, v in dyn_subset.items()},
        )
        if not path:
            return jsonify({"ok": False, "reason": "no_path_replan", "task": list(goal)})
        if full_path and path:
            if full_path[-1] == path[0]:
                full_path.extend(path[1:])
            else:
                full_path.extend(path)
        else:
            full_path.extend(path)
        cur = goal
        time_offset += max(len(path) - 1, 0)

    return jsonify({"ok": True, "path": [list(cell) for cell in full_path]})


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


def apply_manual_edits(payload: dict) -> Tuple[List[List[int]], List[List[int]], List[List[int]], List[dict], dict]:
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
        path = []
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
        updated_moving.append(
            {
                "path": [list(cell) for cell in path],
                "loop": bool(ob.get("loop", True)),
                "period": len(path),
            }
        )

    report = {
        "robots": len(new_robots),
        "tasks": len(new_tasks),
        "forklifts": len(updated_moving),
    }

    return grid, [list(r) for r in new_robots], [list(t) for t in new_tasks], updated_moving, report


@app.route("/api/manual/apply", methods=["POST"])
def api_manual_apply():
    body = request.get_json() or {}
    confirm = bool(body.get("confirm", False))
    grid, robots, tasks, moving, report = apply_manual_edits(body)
    if not confirm:
        return jsonify({"ok": True, "preview": report})

    if len(robots) > MAX_ROBOTS:
        robots = robots[:MAX_ROBOTS]

    response = {
        "ok": True,
        "grid": grid,
        "robots": robots,
        "tasks": tasks,
        "moving": moving,
        "report": report,
    }
    return jsonify(response)


if __name__ == "__main__":
    print("Starting backend on 5001")
    app.run(host="0.0.0.0", port=5001, debug=True)
