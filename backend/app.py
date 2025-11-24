import os
import random
import time
from flask import Flask, request, jsonify
from flask_cors import CORS

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
from kka_backend.services.progress import progress_registry, touch_progress, mark_success, mark_failure
from kka_backend.services.paths import PathLibrary, astar, build_timeline
from kka_backend.services.scheduling import build_dynamic_obstacle_timeline, csp_schedule
from kka_backend.utils.cells import parse_cell, normalize_positions
from kka_backend.utils.grid import get_free_cells, normalize_grid
from kka_backend.utils.numeric import clamp_int, estimate_walkable_cells
from kka_backend.utils.ranges import choose_from_range, parse_range
from kka_backend.utils.selection import select_unique_cells

app = Flask(__name__)
CORS(app)


@app.route("/api/progress/start", methods=["POST"])
def api_progress_start():
    body = request.get_json() or {}
    action = (body.get("action") or "custom").strip() or "custom"
    label = body.get("label")
    entry = progress_registry.create(action=action, label=label)
    return jsonify({"ok": True, "progress": entry})


@app.route("/api/progress/<job_id>", methods=["GET"])
def api_progress_status(job_id):
    entry = progress_registry.get(job_id)
    if not entry:
        return jsonify({"ok": False, "error": "not_found"}), 404
    return jsonify({"ok": True, "progress": entry})


@app.route("/api/generate_map", methods=["POST"])
def api_generate_map():
    body = request.get_json() or {}
    progress_id = body.get("progress_id") or request.args.get("progress_id")
    try:
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
        touch_progress(progress_id, 10, "Config ready")
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
        touch_progress(progress_id, 30, "Generated grid")
        free_cells = get_free_cells(grid)
        if not free_cells:
            free_cells = [(0, 0)]
        robots = select_unique_cells(rng, list(free_cells), num_robots, forbidden=set())
        touch_progress(progress_id, 55, "Placed robots")
        remaining_free = [cell for cell in free_cells if cell not in robots]
        tasks = select_unique_cells(rng, remaining_free, tasks_count, forbidden=set(robots))
        if not tasks:
            tasks = select_unique_cells(rng, list(free_cells), tasks_count, forbidden=set(robots))
        touch_progress(progress_id, 75, "Placed tasks")
        moving_count = min(moving_count, max_moving_cap)
        moving = generate_moving_obstacles(grid, moving_count, rng, robots, tasks)
        touch_progress(progress_id, 90, "Simulated moving obstacles")
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
        mark_success(progress_id, "Map ready", payload={"meta": response["meta"]})
        return jsonify(response)
    except Exception as exc:
        mark_failure(progress_id, str(exc))
        raise


@app.route("/api/plan_tasks", methods=["POST"])
def api_plan_tasks():
    body = request.get_json() or {}
    progress_id = body.get("progress_id") or request.args.get("progress_id")
    grid = normalize_grid(body.get("grid", []))
    robots = normalize_positions(body.get("robots", []))
    tasks = normalize_positions(body.get("tasks", []))
    optimizer = body.get("optimizer", "greedy").lower()
    alg = body.get("path_alg", "astar")
    touch_progress(progress_id, 5, "Normalizing inputs")
    t_planning_start = time.perf_counter()
    try:
        planner = PathLibrary(grid, alg)
        touch_progress(progress_id, 10, "Analyzing reachability")
        active_robots, inactive_robots, assignable_tasks, unreachable_tasks = analyze_reachability(robots, tasks, planner)
        touch_progress(progress_id, 30, "Assigning tasks")
        assignment_progress_start = 30.0
        assignment_progress_end = 65.0
        assignment_span = max(1.0, assignment_progress_end - assignment_progress_start)

        def assignment_progress(event, payload):
            if not progress_id:
                return
            pct = assignment_progress_start
            label = "Assigning tasks"
            robot_val = payload.get("robot")
            task_val = payload.get("task")
            robot_display = list(robot_val) if isinstance(robot_val, (tuple, list)) else robot_val
            task_display = list(task_val) if isinstance(task_val, (tuple, list)) else task_val
            if event == "greedy_assign":
                total = max(1.0, float(payload.get("total", 1)))
                completed = max(0.0, min(total, float(payload.get("completed", 0))))
                ratio = completed / total
                pct = assignment_progress_start + assignment_span * ratio
                label = f"Greedy assigned ({int(completed)}/{int(total)}) {task_display} → {robot_display}"
            elif event == "ga_generation":
                gens = max(1.0, float(payload.get("total_generations", 1)))
                generation = max(0.0, min(gens, float(payload.get("generation", 0))))
                phase = payload.get("phase") or "end"
                if phase == "start":
                    ratio = max(0.0, (generation - 1) / gens)
                else:
                    ratio = generation / gens
                pct = assignment_progress_start + assignment_span * ratio
                best_cost = payload.get("best_cost")
                if isinstance(best_cost, (int, float)):
                    cost_display = f"{best_cost:.1f}"
                else:
                    cost_display = best_cost
                if phase == "start":
                    label = f"GA generation {int(generation)}/{int(gens)} running"
                else:
                    label = f"GA generation {int(generation)}/{int(gens)} (best cost {cost_display})"
            elif event == "ga_generation_step":
                gens = max(1.0, float(payload.get("total_generations", 1)))
                generation = max(0.0, min(gens, float(payload.get("generation", 0))))
                population = max(1.0, float(payload.get("population", 1)))
                produced = max(0.0, min(population, float(payload.get("produced", 0))))
                inner_ratio = produced / population
                overall = max(0.0, (generation - 1 + inner_ratio) / gens)
                pct = assignment_progress_start + assignment_span * overall
                label = f"GA generation {int(generation)}/{int(gens)} building population ({int(produced)}/{int(population)})"
            elif event == "local_search_iteration":
                total_iters = max(1.0, float(payload.get("total_iterations", 1)))
                iteration = max(0.0, min(total_iters, float(payload.get("iteration", 0))))
                ratio = iteration / total_iters
                pct = assignment_progress_start + assignment_span * ratio
                best_score = payload.get("best_score")
                if isinstance(best_score, (int, float)):
                    best_display = f"{best_score:.1f}"
                else:
                    best_display = best_score
                label = f"Local search loop {int(iteration)}/{int(total_iters)} (best {best_display})"
            pct = max(assignment_progress_start, min(assignment_progress_end, pct))
            touch_progress(progress_id, pct, label)

        assignment_cb = assignment_progress if progress_id else None
        assigned_subset = {r: [] for r in active_robots}
        if active_robots and assignable_tasks:
            if optimizer == "greedy":
                assigned_subset = greedy_assign(grid, active_robots, assignable_tasks, alg, planner, progress_cb=assignment_cb)
            elif optimizer == "ga":
                assigned_subset = ga_assign(grid, active_robots, assignable_tasks, alg, planner, progress_cb=assignment_cb)
            else:
                assigned_subset = local_search_assign(grid, active_robots, assignable_tasks, alg, planner, progress_cb=assignment_cb)
        assigned = {r: [] for r in robots}
        for robot, seq in assigned_subset.items():
            assigned[robot] = seq
        planning_time_ms = (time.perf_counter() - t_planning_start) * 1000.0
        touch_progress(progress_id, 65, "Validating assignments")
        robot_payload, task_map = compile_task_assignments(robots, assigned, planner)
        compile_progress_start = 65.0
        compile_progress_end = 85.0
        compile_span = max(1.0, compile_progress_end - compile_progress_start)
        total_compile = max(1, len(robots))
        legacy_costs = {}
        for idx_robot, (robot, entries) in enumerate(assigned.items(), start=1):
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
            compile_ratio = idx_robot / total_compile
            compile_pct = compile_progress_start + compile_span * compile_ratio
            touch_progress(
                progress_id,
                compile_pct,
                f"Verified robot {idx_robot}/{total_compile} assignments",
            )
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
        touch_progress(progress_id, 90, "Finalizing plan payload")
        mark_success(progress_id, "Plan ready", payload={"metrics": response["metrics"]})
        return jsonify(response)
    except Exception as exc:
        mark_failure(progress_id, str(exc))
        raise


@app.route("/api/compute_paths", methods=["POST"])
def api_compute_paths():
    body = request.get_json() or {}
    progress_id = body.get("progress_id") or request.args.get("progress_id")
    grid = normalize_grid(body.get("grid", []))
    alg = body.get("alg", "astar")
    rp_in = body.get("robot_plans", {})
    robot_plans = {parse_cell(k): [parse_cell(t) for t in v] for k, v in rp_in.items()}
    touch_progress(progress_id, 5, "Normalizing inputs")
    try:
        planner = PathLibrary(grid, alg)
        t_paths_start = time.perf_counter()
        base_paths = {}
        perrobot_stats = {}
        robot_items = list(robot_plans.items())
        total_robot_plans = max(1, len(robot_items))
        path_progress_start = 10.0
        path_progress_end = 50.0
        path_span = max(1.0, path_progress_end - path_progress_start)
        for idx_robot, (robot, seq) in enumerate(robot_items, start=1):
            cur = robot
            full = [cur]
            nodes = 0
            elapsed = 0.0
            for goal in seq:
                info = planner.ensure(cur, goal)
                path = info["path"]
                if not path:
                    mark_failure(progress_id, "Path blocked", payload={"robot": list(robot), "target": list(goal)})
                    return jsonify({"ok": False, "reason": "no_path", "robot": list(robot), "to": list(goal)})
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
            ratio = idx_robot / total_robot_plans
            pct = path_progress_start + path_span * ratio
            steps = perrobot_stats[robot_key]["path_steps"]
            detail_bits = [f"{steps} steps"]
            if nodes:
                detail_bits.append(f"{nodes} nodes")
            touch_progress(
                progress_id,
                pct,
                f"Base path {idx_robot}/{total_robot_plans} ({', '.join(detail_bits)})",
            )
        path_compute_time_ms = (time.perf_counter() - t_paths_start) * 1000.0
        moving = body.get("moving", [])
        total_moving = max(1, len(moving))
        moving_progress_start = 50.0
        moving_progress_end = 65.0
        moving_span = max(1.0, moving_progress_end - moving_progress_start)
        if moving:
            touch_progress(progress_id, moving_progress_start, "Integrating moving obstacles")
        moving_obs = []
        for idx_ob, ob in enumerate(moving, start=1):
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
            ratio = idx_ob / total_moving
            pct = moving_progress_start + moving_span * ratio
            touch_progress(progress_id, pct, f"Integrated obstacle {idx_ob}/{total_moving}")
        if moving_obs:
            touch_progress(progress_id, moving_progress_end, f"Moving obstacles integrated ({len(moving_obs)})")
        else:
            touch_progress(progress_id, moving_progress_end, "No moving obstacles to integrate")
        csp_max_offset = 40
        csp_progress_start = 65.0
        csp_progress_end = 85.0
        csp_progress_span = max(1.0, csp_progress_end - csp_progress_start)
        max_node_hint = max(200.0, total_robot_plans * csp_max_offset * 5.0)

        def csp_progress(stage, payload):
            if not progress_id:
                return
            assigned = float(payload.get("assigned", 0.0))
            nodes_used = float(payload.get("nodes_expanded", 0.0))
            ratio_assigned = assigned / total_robot_plans if total_robot_plans else 0.0
            ratio_nodes = min(1.0, nodes_used / max_node_hint)
            blended = max(ratio_assigned, ratio_nodes * 0.6)
            pct = csp_progress_start + csp_progress_span * min(1.0, blended)
            robot_val = payload.get("robot")
            if isinstance(robot_val, tuple):
                robot_display = list(robot_val)
            elif isinstance(robot_val, list):
                robot_display = robot_val
            else:
                robot_display = robot_val
            offset_val = payload.get("offset")
            if stage == "start":
                label = f"CSP init ({int(payload.get('robots', total_robot_plans))} robots, horizon {payload.get('horizon', 'n/a')})"
            elif stage == "search_tick":
                label = f"CSP exploring (placed {int(assigned)}/{total_robot_plans}, nodes {int(nodes_used)})"
            elif stage == "robot_assigned":
                label = f"CSP placed {robot_display} at t+{int(offset_val or 0)} ({int(assigned)}/{total_robot_plans})"
            elif stage == "robot_backtrack":
                label = f"CSP backtracking {robot_display} (nodes {int(nodes_used)})"
            elif stage == "done":
                label = "CSP offsets solved" if payload.get("ok") else "CSP search exhausted"
            else:
                label = "CSP scheduling"
            touch_progress(progress_id, pct, label)

        t_schedule_start = time.perf_counter()
        csp_cb = csp_progress if progress_id else None
        csp = csp_schedule(base_paths, moving_obs, max_offset=csp_max_offset, progress_cb=csp_cb)
        schedule_time_ms = (time.perf_counter() - t_schedule_start) * 1000.0
        scheduled_paths = {}
        base_items = list(base_paths.items())
        total_schedules = max(1, len(base_items))
        schedule_progress_start = 85.0
        schedule_progress_end = 95.0
        schedule_span = max(1.0, schedule_progress_end - schedule_progress_start)
        for idx_robot, (robot, path) in enumerate(base_items, start=1):
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
            ratio = idx_robot / total_schedules
            pct = schedule_progress_start + schedule_span * ratio
            touch_progress(progress_id, pct, f"Applied CSP offset {idx_robot}/{total_schedules}")
        response_paths = {str(list(k)): [list(cell) for cell in v] for k, v in base_paths.items()}
        step_meta = {}
        for robot, path in scheduled_paths.items():
            key_robot = parse_cell(robot)
            timeline = build_timeline([tuple(cell) for cell in path], robot_plans.get(key_robot, []))
            step_meta[robot] = timeline
        if isinstance(csp.get("start_times"), dict):
            csp["start_times"] = {str(list(k)): v for k, v in csp["start_times"].items()}
        response = {
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
        touch_progress(progress_id, 97, "Finalizing schedule payload")
        mark_success(progress_id, "Paths ready", payload={"timing": response["timing"]})
        return jsonify(response)
    except Exception as exc:
        mark_failure(progress_id, str(exc))
        raise


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
    debug_mode = os.environ.get("FLASK_DEBUG") in {"1", "true", "True"}
    app.run(host="0.0.0.0", port=5001, debug=debug_mode)
