import math
import random
from typing import Dict, List, Sequence, Tuple

from config import (
    GA_DEFAULT_GENERATIONS,
    GA_DEFAULT_MUTATION_RATE,
    GA_DEFAULT_POPULATION,
    GA_TOURNAMENT_SIZE,
    LOCAL_SEARCH_DEFAULT_ITERATIONS,
    LOCAL_SEARCH_SIMULATED_ANNEALING_PROB,
)
from pathfinding import PathLibrary
from utils import euclidean

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
        best_dist = math.inf
        best_cost = math.inf
        for r in robots:
            cur = robot_pos[r]
            for t in remaining:
                cost = planner.cost(cur, t)
                if cost == math.inf:
                    continue
                dist = euclidean(cur, t)
                if dist < best_dist - 1e-6 or (
                    math.isclose(dist, best_dist, rel_tol=1e-6, abs_tol=1e-6)
                    and cost < best_cost
                ):
                    best_dist = dist
                    best_cost = cost
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
    pop: int = GA_DEFAULT_POPULATION,
    gens: int = GA_DEFAULT_GENERATIONS,
    pmut: float = GA_DEFAULT_MUTATION_RATE,
) -> Dict[Tuple[int, int], List[Tuple[int, int]]]:
    if not tasks:
        return {r: [] for r in robots}
    rng = random.Random()
    num_robots = len(robots)
    greedy_seed = greedy_assign(grid, robots, tasks, alg, planner)
    greedy_flat: List[Tuple[int, int]] = []
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

    fitness_cache: Dict[Tuple[Tuple[int, int], ...], float] = {}

    def fitness(chrom: Sequence[Tuple[int, int]]) -> float:
        key = tuple(chrom)
        if key in fitness_cache:
            return fitness_cache[key]
        parts = split_chrom(chrom)
        total = 0.0
        for robot_idx, r in enumerate(robots):
            cur = r
            for t in parts[robot_idx]:
                total += planner.cost(cur, t)
                cur = t
        fitness_cache[key] = total
        return total

    def random_chrom() -> List[Tuple[int, int]]:
        perm = list(tasks)
        rng.shuffle(perm)
        return perm

    def ordered_crossover(a: Sequence[Tuple[int, int]], b: Sequence[Tuple[int, int]]) -> List[Tuple[int, int]]:
        if len(a) < 2:
            return list(a)
        i, j = sorted(rng.sample(range(len(a)), 2))
        child = [None] * len(a)
        child[i : j + 1] = a[i : j + 1]
        fill_idx = (j + 1) % len(a)
        for candidate in b:
            if candidate in child:
                continue
            child[fill_idx] = candidate
            fill_idx = (fill_idx + 1) % len(a)
        return [step for step in child if step is not None]

    def mutate(chrom: List[Tuple[int, int]]):
        if len(chrom) < 2:
            return
        i, j = sorted(rng.sample(range(len(chrom)), 2))
        if rng.random() < 0.5:
            chrom[i], chrom[j] = chrom[j], chrom[i]
        else:
            segment = chrom[i:j]
            rng.shuffle(segment)
            chrom[i:j] = segment

    def tournament(population: List[List[Tuple[int, int]]], k: int = GA_TOURNAMENT_SIZE) -> List[Tuple[int, int]]:
        contenders = rng.sample(population, min(k, len(population)))
        return min(contenders, key=fitness)

    population: List[List[Tuple[int, int]]] = [greedy_flat[:]]
    while len(population) < pop:
        population.append(random_chrom())

    for _ in range(gens):
        next_population: List[List[Tuple[int, int]]] = []
        elite = min(population, key=fitness)
        next_population.append(elite[:])
        while len(next_population) < pop:
            parent1 = tournament(population)
            parent2 = tournament(population)
            child = ordered_crossover(parent1, parent2)
            if rng.random() < pmut:
                mutate(child)
            next_population.append(child)
        population = next_population

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
    iters: int = LOCAL_SEARCH_DEFAULT_ITERATIONS,
) -> Dict[Tuple[int, int], List[Tuple[int, int]]]:
    assigned = greedy_assign(grid, robots, tasks, alg, planner)
    flat = []
    for r in robots:
        flat.extend(assigned.get(r, []))
    if not flat:
        return assigned

    rng = random.Random()
    current = flat[:]

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

    current_score = score(current)
    best = current[:]
    best_score = current_score

    for _ in range(iters):
        candidate = current[:]
        if len(candidate) >= 2:
            i, j = rng.sample(range(len(candidate)), 2)
            candidate[i], candidate[j] = candidate[j], candidate[i]
        if rng.random() < 0.25 and len(candidate) >= 3:
            i, j = sorted(rng.sample(range(len(candidate)), 2))
            segment = candidate[i:j]
            candidate[i:j] = list(reversed(segment))
        val = score(candidate)
        if val < current_score or rng.random() < LOCAL_SEARCH_SIMULATED_ANNEALING_PROB:
            current = candidate
            current_score = val
            if val < best_score:
                best = candidate
                best_score = val

    parts = split(best)
    out = {}
    for idx, r in enumerate(robots):
        out[r] = parts[idx]
    return out

def analyze_reachability(
    robots: Sequence[Tuple[int, int]],
    tasks: Sequence[Tuple[int, int]],
    planner: PathLibrary,
) -> Tuple[List[Tuple[int, int]], List[Tuple[int, int]], List[Tuple[int, int]], List[Tuple[int, int]]]:
    if not robots:
        return [], [], list(tasks), []
    if not tasks:
        return list(robots), [], [], []

    reachable_tasks = set()
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
