from flask import Flask, request, jsonify
from flask_cors import CORS
import random
import time

from kka_backend.config import (
    DEFAULT_MOVING_RANGE,
    DEFAULT_ROBOT_RANGE,
    DEFAULT_TASK_RANGE,
    DEFAULT_WALL_RANGE,
    MAX_HEIGHT,
    MAX_ROBOTS,
    MAX_WIDTH,
)
from kka_backend.services.assignments import (
    analyze_reachability,
    compile_task_assignments,
    ga_assign,
    greedy_assign,
    local_search_assign,
)
from kka_backend.services.manual_edits import apply_manual_edits
from kka_backend.services.map_generation import generate_moving_obstacles, generate_warehouse
from kka_backend.services.meta import snapshot_meta
from kka_backend.services.paths import PathLibrary, astar, build_timeline
from kka_backend.services.scheduling import build_dynamic_obstacle_timeline, csp_schedule
from kka_backend.utils.cells import parse_cell, normalize_positions
from kka_backend.utils.grid import get_free_cells, normalize_grid
from kka_backend.utils.numeric import clamp_int, estimate_walkable_cells
from kka_backend.utils.ranges import choose_from_range, parse_range
from kka_backend.utils.selection import select_unique_cells

app = Flask(__name__)
CORS(app)


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
    walkable_estimate = estimate_walkable_cells(width, height, wall_range)
    max_moving_cap = clamp_int(max(10, walkable_estimate // 60), 0, width * height)
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
        high=max(10, max_moving_cap),
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
    if not tasks:
        tasks = select_unique_cells(rng, list(free_cells), tasks_count, forbidden=set(robots))
    moving_count = min(moving_count, max_moving_cap)
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
    assigned_subset = {r: [] for r in active_robots}
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
    full_path = []
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
    app.run(host="0.0.0.0", port=5001, debug=True)
