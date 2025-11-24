from typing import Callable, Dict, List, Optional, Sequence, Set, Tuple

from kka_backend.utils.cells import parse_cell


def obstacle_timeline_index(length: int, step: int, loop: bool) -> int:
    if length <= 0:
        return 0
    if loop:
        return step % length
    return min(step, length - 1)


ProgressCallback = Callable[[str, dict], None]


def csp_schedule(paths, moving_obstacles, max_offset=20, progress_cb: Optional[ProgressCallback] = None):
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
        looping = bool(ob.get("loop", True))
        for t in range(horizon + 1):
            a = p[obstacle_timeline_index(L, t, looping)]
            obstruct.add((a, t))
            if L > 1:
                next_idx = obstacle_timeline_index(L, t + 1, looping)
                b = p[next_idx]
                if a != b:
                    obstruct_edges.add((a, b, t))
    robots = list(paths.keys())
    assigned = {}
    nodes_expanded = 0
    last_emit_nodes = 0
    emit_interval = max(25, len(robots) * 10)

    def emit(stage: str, payload: dict | None = None):
        if progress_cb is None:
            return
        data = {
            "stage": stage,
            "robots": len(robots),
            "assigned": len(assigned),
            "nodes_expanded": nodes_expanded,
            "max_offset": max_offset,
            "horizon": horizon,
        }
        if payload:
            data.update(payload)
        progress_cb(stage, data)

    emit("start")

    def backtrack(idx):
        nonlocal nodes_expanded, last_emit_nodes
        if idx == len(robots):
            return True
        r = robots[idx]
        P = paths[r]
        for s in range(0, max_offset + 1):
            nodes_expanded += 1
            if nodes_expanded - last_emit_nodes >= emit_interval:
                last_emit_nodes = nodes_expanded
                emit("search_tick", {"robot": r, "offset": s})
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
            emit("robot_assigned", {"robot": r, "offset": s})
            if backtrack(idx + 1):
                return True
            emit("robot_backtrack", {"robot": r, "offset": s})
            del assigned[r]
        return False

    ok = backtrack(0)
    emit("done", {"ok": ok})
    return {"ok": ok, "start_times": assigned, "nodes": nodes_expanded}


def build_dynamic_obstacle_timeline(moving: List[dict], horizon: int, start_time: int = 0) -> Dict[int, Set[Tuple[int, int]]]:
    timeline: Dict[int, Set[Tuple[int, int]]] = {}
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
