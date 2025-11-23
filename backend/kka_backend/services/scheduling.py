from typing import Dict, List, Sequence, Set, Tuple

from kka_backend.utils.cells import parse_cell


def obstacle_timeline_index(length: int, step: int, loop: bool) -> int:
    if length <= 0:
        return 0
    if loop:
        return step % length
    return min(step, length - 1)


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
