from flask import Flask, request, jsonify
from flask_cors import CORS
import random, math, heapq, time, copy, ast
from itertools import permutations

app = Flask(__name__)
CORS(app)

GRID_W = 30
GRID_H = 20

def neighbors4(node):
    r,c = node
    for dr,dc in ((1,0),(-1,0),(0,1),(0,-1)):
        nr,nc = r+dr,c+dc
        if 0<=nr<GRID_H and 0<=nc<GRID_W:
            yield (nr,nc)

def manhattan(a,b):
    return abs(a[0]-b[0])+abs(a[1]-b[1])
def euclid(a,b):
    return math.hypot(a[0]-b[0], a[1]-b[1])

def parse_cell(cell):
    if isinstance(cell, (list, tuple)) and len(cell) == 2:
        return (int(cell[0]), int(cell[1]))
    if isinstance(cell, str):
        try:
            v = ast.literal_eval(cell)
            if isinstance(v, (list, tuple)) and len(v) == 2:
                return (int(v[0]), int(v[1]))
        except Exception:
            pass
        s = cell.strip().strip("()[]")
        parts = [p.strip() for p in s.split(",")]
        if len(parts) == 2:
            return (int(parts[0]), int(parts[1]))
    raise ValueError(f"Invalid cell format: {cell}")

def generate_warehouse(seed=None, obstacle_density=0.12):
    rng = random.Random(seed)
    grid = [[0]*GRID_W for _ in range(GRID_H)]
    for c in range(1, GRID_W-1):
        if rng.random() < 0.12:
            for r in range(GRID_H):
                if rng.random() < 0.9:
                    grid[r][c] = 1
            for _ in range(rng.randint(1,3)):
                gap = rng.randrange(0,GRID_H)
                grid[gap][c] = 0
    for r in range(GRID_H):
        for c in range(GRID_W):
            if rng.random() < obstacle_density*0.6:
                grid[r][c] = 1
    for c in range(GRID_W):
        grid[0][c]=0; grid[GRID_H-1][c]=0
    for r in range(GRID_H):
        grid[r][0]=0; grid[r][GRID_W-1]=0
    return grid

def astar(grid, start, goal, heuristic=manhattan):
    t0 = time.perf_counter()
    openh = []
    heapq.heappush(openh, (heuristic(start,goal), 0, start))
    came={}
    gscore={start:0}
    closed=set()
    nodes=0
    while openh:
        f,g,cur = heapq.heappop(openh)
        if cur in closed: continue
        nodes += 1
        if cur==goal:
            path=[cur]
            while cur in came:
                cur=came[cur]; path.append(cur)
            path.reverse()
            return path, nodes, time.perf_counter()-t0
        closed.add(cur)
        for nb in neighbors4(cur):
            if grid[nb[0]][nb[1]]==1: continue
            tentative = gscore[cur]+1
            if tentative < gscore.get(nb, 1e12):
                gscore[nb]=tentative
                came[nb]=cur
                heapq.heappush(openh, (tentative + heuristic(nb,goal), tentative, nb))
    return [], nodes, time.perf_counter()-t0

def dijkstra(grid, start, goal):
    return astar(grid, start, goal, heuristic=lambda a,b: 0)

def path_cost(grid, a, b, alg):
    if alg=="astar": p,_,_ = astar(grid,a,b); return len(p) if p else 1e6
    if alg=="dijkstra": p,_,_ = dijkstra(grid,a,b); return len(p) if p else 1e6
    return 1e6

def greedy_assign(grid, robots, tasks, alg):
    remaining = tasks[:]
    assigned = {r:[] for r in robots}
    robot_pos = {r:r for r in robots}
    while remaining:
        best = None; bestd = 1e12; best_robot=None
        for r in robots:
            cur = robot_pos[r]
            for t in remaining:
                d = path_cost(grid, cur, t, alg)
                if d < bestd:
                    bestd = d; best = (r,t); best_robot=r
        if best is None: break
        r,t = best
        assigned[r].append(t)
        robot_pos[r] = t
        remaining.remove(t)
    return assigned

def ga_assign(grid, robots, tasks, alg, pop=30, gens=60, pmut=0.2):
    if not tasks:
        return {r:[] for r in robots}
    rng = random.Random()
    num_robots = len(robots)
    def split_chrom(chrom):
        n = len(chrom)
        sizes = [n//num_robots]*num_robots
        for i in range(n % num_robots):
            sizes[i] += 1
        out=[]; idx=0
        for s in sizes:
            out.append(chrom[idx:idx+s])
            idx+=s
        return out
    def fitness(chrom):
        parts = split_chrom(chrom)
        total=0
        i=0
        for r in robots:
            cur = r
            for t in parts[i]:
                total += path_cost(grid, cur, t, alg)
                cur = t
            i+=1
        return total
    population = [random.sample(tasks, len(tasks)) for _ in range(pop)]
    for g in range(gens):
        scored = sorted([(fitness(p), p) for p in population], key=lambda x:x[0])
        newpop = [scored[0][1], scored[1][1]]
        while len(newpop) < pop:
            a = rng.choice(scored[:max(2, pop//3)])[1]
            b = rng.choice(scored[:max(2, pop//3)])[1]
            cut = rng.randint(0, len(tasks)-1)
            child = a[:cut] + [x for x in b if x not in a[:cut]]
            if rng.random() < pmut:
                i,j = rng.sample(range(len(tasks)),2)
                child[i],child[j] = child[j],child[i]
            newpop.append(child)
        population = newpop
    best = sorted([(fitness(p), p) for p in population], key=lambda x:x[0])[0][1]
    parts = split_chrom(best)
    assigned = {}
    i=0
    for r in robots:
        assigned[r] = parts[i]
        i+=1
    return assigned

def local_search_assign(grid, robots, tasks, alg, iters=2000):
    initial = []
    assigned = greedy_assign(grid, robots, tasks, alg)
    for r in robots:
        initial += assigned[r]
    if not initial:
        return {r:[] for r in robots}
    best = initial[:]
    def fitness(chrom):
        num_robots = len(robots)
        parts=[]
        n=len(chrom)
        sizes=[n//num_robots]*num_robots
        for i in range(n%num_robots): sizes[i]+=1
        idx=0
        total=0; i=0
        for r in robots:
            cur = r
            for _ in range(sizes[i]):
                t = chrom[idx]; total += path_cost(grid, cur, t, alg); cur = t; idx+=1
            i+=1
        return total
    best_score = fitness(best)
    rng = random.Random()
    for _ in range(iters):
        a,b = rng.sample(range(len(best)),2)
        cand = best[:]
        cand[a],cand[b]=cand[b],cand[a]
        sc = fitness(cand)
        if sc < best_score:
            best = cand; best_score = sc
    out={}
    n=len(best); sizes=[n//len(robots)]*len(robots)
    for i in range(n%len(robots)): sizes[i]+=1
    idx=0; i=0
    for r in robots:
        out[r] = best[idx:idx+sizes[i]]; idx+=sizes[i]; i+=1
    return out

def generate_moving_obstacles(grid, count=3):
    rng=random.Random()
    obs=[]
    free_cells = [(r,c) for r in range(GRID_H) for c in range(GRID_W) if grid[r][c]==0]
    for _ in range(count):
        start = rng.choice(free_cells)
        path=[start]
        cur = start
        for _ in range(rng.randint(3,8)):
            nbs=[nb for nb in neighbors4(cur) if grid[nb[0]][nb[1]]==0]
            if not nbs: break
            cur = rng.choice(nbs)
            path.append(cur)
        if len(path)<2: continue
        obs.append({"path":path, "loop":True})
    return obs

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
        for t in range(horizon+1):
            a = p[t % L]
            obstruct.add((a, t))
            b = p[(t+1) % L] if L > 1 else a
            if a != b:
                obstruct_edges.add((a, b, t))

    robots = list(paths.keys())
    assigned = {}
    def backtrack(idx):
        if idx==len(robots):
            return True
        r = robots[idx]
        P = paths[r]
        for s in range(0, max_offset+1):
            bad=False
            for k,cell in enumerate(P):
                t = s + k
                if (cell, t) in obstruct:
                    bad=True; break
            if bad: continue
            for k in range(len(P)-1):
                a = P[k]; b = P[k+1]
                t = s + k
                if (b, a, t) in obstruct_edges:
                    bad = True; break
            if bad: continue
            for other,so in assigned.items():
                Po = paths[other]
                for k,cell in enumerate(P):
                    t = s + k
                    for mo,k2 in enumerate(Po):
                        if (so + mo) == t and k2 == cell:
                            bad=True; break
                    if bad: break
                if bad: break
                for k in range(len(P)-1):
                    a = P[k]; b = P[k+1]
                    t = s + k
                    for mo in range(len(Po)-1):
                        a2 = Po[mo]; b2 = Po[mo+1]
                        if (so + mo) == t and a == b2 and b == a2:
                            bad=True; break
                    if bad: break
                if bad: break
            if bad: continue
            assigned[r]=s
            if backtrack(idx+1):
                return True
            del assigned[r]
        return False
    ok = backtrack(0)
    if ok:
        return {"ok":True, "start_times":assigned}
    else:
        return {"ok":False, "start_times":{}}

@app.route('/api/generate_map', methods=['POST'])
def api_generate_map():
    body = request.get_json() or {}
    seed = body.get("seed", None)
    grid = generate_warehouse(seed)
    tasks = []
    free = [(r,c) for r in range(GRID_H) for c in range(GRID_W) if grid[r][c]==0]
    for _ in range(body.get("num_tasks",5)):
        tasks.append(random.choice(free))
    robots = body.get("robots", 2)
    robot_positions = []
    for i in range(robots):
        robot_positions.append(random.choice(free))
    moving = generate_moving_obstacles(grid, count=body.get("moving", 3))
    return jsonify({"grid":grid, "tasks":tasks, "robots":robot_positions, "moving":moving})

@app.route('/api/plan_tasks', methods=['POST'])
def api_plan_tasks():
    body = request.get_json()
    grid = body["grid"]; robots = [tuple(r) for r in body["robots"]]; tasks = [tuple(t) for t in body["tasks"]]
    optimizer = body.get("optimizer","greedy"); alg = body.get("path_alg","astar")
    if optimizer=="greedy":
        assigned = greedy_assign(grid, robots, tasks, alg)
    elif optimizer=="ga":
        assigned = ga_assign(grid, robots, tasks, alg, pop=40, gens=80)
    else:
        assigned = local_search_assign(grid, robots, tasks, alg, iters=2000)
    costs={}
    for r, lst in assigned.items():
        cur=r; tot=0; legs=[]
        for t in lst:
            cost = path_cost(grid, cur, t, alg)
            p,_,_ = (astar if alg=="astar" else dijkstra)(grid, cur, t)
            legs.append({"to":t, "cost":cost, "path":p})
            tot += cost
            cur = t
        costs[r]= {"tasks": lst, "legs": legs, "total_cost": tot}
    costs_str_keys = {str(k): v for k, v in costs.items()}
    return jsonify({"assigned": {str(k): v for k, v in assigned.items()}, "costs": costs_str_keys})

@app.route('/api/compute_paths', methods=['POST'])
def api_compute_paths():
    body = request.get_json()
    grid = body["grid"]
    rp_in = body["robot_plans"]
    robot_plans = {parse_cell(k): [parse_cell(t) for t in v] for k, v in rp_in.items()}
    alg = body.get("alg","astar")
    paths={}
    perrobot_stats={}
    for r, seq in robot_plans.items():
        cur = parse_cell(r)
        full=[]
        nodes=0; ttot=0.0
        for t in seq:
            t = parse_cell(t)
            if alg=="astar":
                p,n,tt = astar(grid, cur, t)
            else:
                p,n,tt = dijkstra(grid, cur, t)
            if not p:
                return jsonify({"ok":False, "reason":"no_path", "robot":r, "to":t})
            if full and p[0]==full[-1]:
                full.extend(p[1:])
            else:
                full.extend(p)
            nodes += n; ttot += tt
            cur = t
        paths[str(r)] = full
        perrobot_stats[str(r)] = {"nodes":nodes, "time":ttot, "len":len(full)}
    moving = body.get("moving", [])
    moving_obs = []
    for ob in moving:
        if isinstance(ob, dict):
            path_list = ob.get("path", [])
            try:
                norm_path = [parse_cell(pos) for pos in path_list]
            except Exception:
                norm_path = []
            moving_obs.append({"path": norm_path, "loop": bool(ob.get("loop", True))})
    p2 = {parse_cell(k): v for k, v in paths.items()}
    csp = csp_schedule(p2, moving_obs, max_offset=40)
    scheduled_paths = {}
    if csp.get("ok") and isinstance(csp.get("start_times"), dict):
        for r, seq in p2.items():
            s = csp["start_times"].get(r, 0)
            wait = [seq[0]] * max(0, int(s)) if seq else []
            full = wait + seq
            scheduled_paths[str(r)] = full
    else:
        scheduled_paths = {k: v for k, v in paths.items()}
    if isinstance(csp, dict) and isinstance(csp.get("start_times"), dict):
        csp["start_times"] = {str(k): v for k, v in csp["start_times"].items()}
    return jsonify({"ok":True, "paths":paths, "scheduled_paths":scheduled_paths, "stats":perrobot_stats, "csp":csp})

if __name__=="__main__":
    print("Starting backend on 5001")
    app.run(host="0.0.0.0", port=5001, debug=True)
