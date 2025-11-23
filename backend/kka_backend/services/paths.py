import heapq
import math
import time
from typing import Dict, Iterable, List, Optional, Sequence, Set, Tuple

from kka_backend.utils.geometry import manhattan, neighbors4


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
