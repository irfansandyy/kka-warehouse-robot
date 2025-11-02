import pygame, sys, random, math, time, heapq
from itertools import permutations

GRID_W, GRID_H = 25, 18
CELL = 32
FPS = 60
OBSTACLE_RATE = 0.15
NUM_TASKS = 5
NUM_ROBOTS = 2
WHITE, BLACK = (250,250,250), (10,10,10)
GRAY, DARK = (150,150,150), (60,60,60)
GREEN, RED, BLUE, ORANGE = (50,200,80), (200,50,50), (80,120,230), (240,180,70)

pygame.init()
font = pygame.font.SysFont("Consolas", 16)
screen = pygame.display.set_mode((GRID_W*CELL + 300, GRID_H*CELL))
pygame.display.set_caption("Smart Warehouse Optimizer")

def neighbors4(r,c):
    for dr,dc in [(1,0),(-1,0),(0,1),(0,-1)]:
        nr, nc = r+dr, c+dc
        if 0 <= nr < GRID_H and 0 <= nc < GRID_W:
            yield nr,nc

def heuristic(a,b): return abs(a[0]-b[0]) + abs(a[1]-b[1])
def euclid(a,b): return math.hypot(a[0]-b[0], a[1]-b[1])

def astar(grid, start, goal):
    open_heap = [(heuristic(start,goal),0,start)]
    g = {start:0}; came = {}
    closed=set(); expanded=0
    while open_heap:
        f, cost, cur = heapq.heappop(open_heap)
        if cur in closed: continue
        expanded += 1
        if cur == goal:
            path=[cur]
            while cur in came:
                cur=came[cur]
                path.append(cur)
            path.reverse()
            return path, expanded
        closed.add(cur)
        for nb in neighbors4(*cur):
            if grid[nb[0]][nb[1]]==1: continue
            g2=g[cur]+1
            if g2<g.get(nb,1e9):
                g[nb]=g2
                came[nb]=cur
                heapq.heappush(open_heap,(g2+heuristic(nb,goal),g2,nb))
    return [], expanded

def line_of_sight(grid,a,b):
    (x0,y0)=(a[1],a[0]); (x1,y1)=(b[1],b[0])
    dx,dy=abs(x1-x0),abs(y1-y0)
    sx=1 if x0<x1 else -1; sy=1 if y0<y1 else -1
    err=dx-dy
    while True:
        if grid[y0][x0]==1: return False
        if x0==x1 and y0==y1: break
        e2=2*err
        if e2>-dy: err-=dy; x0+=sx
        if e2<dx: err+=dx; y0+=sy
    return True

def theta_star(grid,start,goal):
    openh=[(euclid(start,goal),start)]
    g={start:0}; parent={start:start}; expanded=0
    while openh:
        _,s=heapq.heappop(openh)
        expanded+=1
        if s==goal:
            path=[s]
            while s!=parent[s]:
                s=parent[s]; path.append(s)
            path.reverse(); return path, expanded
        for nb in neighbors4(*s):
            if grid[nb[0]][nb[1]]==1: continue
            ps=parent[s]
            if line_of_sight(grid,ps,nb):
                cost=g[ps]+euclid(ps,nb)
                par=ps
            else:
                cost=g[s]+euclid(s,nb)
                par=s
            if cost<g.get(nb,1e9):
                g[nb]=cost; parent[nb]=par
                heapq.heappush(openh,(cost+euclid(nb,goal),nb))
    return [], expanded

def generate_warehouse():
    grid=[[0]*GRID_W for _ in range(GRID_H)]
    for c in range(2, GRID_W-2, 4):
        for r in range(GRID_H):
            if random.random()<0.85:
                grid[r][c]=1
        for _ in range(2): grid[random.randint(1,GRID_H-2)][c]=0
    for _ in range(int(GRID_W*GRID_H*OBSTACLE_RATE*0.5)):
        r,c=random.randrange(GRID_H), random.randrange(GRID_W)
        grid[r][c]=1
    for r in range(GRID_H):
        grid[r][0]=grid[r][GRID_W-1]=0
    for c in range(GRID_W):
        grid[0][c]=grid[GRID_H-1][c]=0
    return grid

def generate_tasks(grid,n=NUM_TASKS):
    tasks=[]
    while len(tasks)<n:
        r,c=random.randrange(GRID_H), random.randrange(GRID_W)
        if grid[r][c]==0:
            tasks.append((r,c))
    return tasks

def total_path_length(grid, order, start, algo):
    total=0
    pos=start
    for t in order:
        path, _ = (astar if algo=="A*" else theta_star)(grid,pos,t)
        total += len(path)
        pos=t
    return total

def greedy_assign(grid, robots, tasks, algo):
    assigned={r:[] for r in robots}
    remaining=tasks[:]
    while remaining:
        best=None; bestd=1e9; bestbot=None
        for r in robots:
            if not remaining: break
            cur=r if not assigned[r] else assigned[r][-1]
            for t in remaining:
                d=len((astar if algo=="A*" else theta_star)(grid,cur,t)[0])
                if d<bestd: bestd, best, bestbot=d, t, r
        assigned[bestbot].append(best)
        remaining.remove(best)
    return assigned

def ga_assign(grid, robots, tasks, algo, pop=20, gen=30, pmut=0.2):
    N=len(tasks); split=len(tasks)//len(robots)
    def fitness(order):
        cost=0; i=0
        for r in robots:
            subtasks=order[i:i+split]
            cost+=total_path_length(grid,subtasks,r,algo)
            i+=split
        return cost
    popu=[random.sample(tasks,len(tasks)) for _ in range(pop)]
    for g in range(gen):
        scored=sorted([(fitness(p),p) for p in popu], key=lambda x:x[0])
        best=scored[0][1]
        newp=[best]
        while len(newp)<pop:
            a,b=random.sample(scored[:10],2)
            pa, pb=a[1], b[1]
            cut=random.randint(0,len(tasks)-1)
            child=pa[:cut]+[x for x in pb if x not in pa[:cut]]
            if random.random()<pmut:
                i,j=random.sample(range(len(tasks)),2)
                child[i],child[j]=child[j],child[i]
            newp.append(child)
        popu=newp
    best=sorted([(fitness(p),p) for p in popu], key=lambda x:x[0])[0][1]
    assigned={r:[] for r in robots}
    i=0
    for r in robots:
        assigned[r]=best[i:i+split]
        i+=split
    return assigned

def draw(grid, robots, tasks, paths, algo_name):
    screen.fill(WHITE)
    for r in range(GRID_H):
        for c in range(GRID_W):
            rect=pygame.Rect(c*CELL, r*CELL, CELL-1, CELL-1)
            if grid[r][c]==1:
                pygame.draw.rect(screen, DARK, rect)
            else:
                pygame.draw.rect(screen, WHITE, rect)
                pygame.draw.rect(screen, GRAY, rect,1)
    for t in tasks:
        pygame.draw.rect(screen, ORANGE, (t[1]*CELL+6,t[0]*CELL+6,CELL-12,CELL-12))
    for r,color in robots.items():
        pygame.draw.circle(screen, color, (r[1]*CELL+CELL//2, r[0]*CELL+CELL//2), CELL//3)
    for k,v in paths.items():
        col = BLUE if algo_name=="A*" else RED
        for (r,c) in v:
            pygame.draw.circle(screen, col, (c*CELL+CELL//2, r*CELL+CELL//2), 3)
    pygame.display.flip()

def main():
    grid=generate_warehouse()
    robots={(1,1):GREEN,(GRID_H-2,GRID_W-2):RED}
    tasks=generate_tasks(grid)
    algo_name="Theta*" 
    mode="Greedy"

    assigned = greedy_assign(grid, list(robots.keys()), tasks, algo_name)
    assigned_ga = ga_assign(grid, list(robots.keys()), tasks, algo_name)
    draw(grid, robots, tasks, {}, algo_name)

    print(f"Algorithm={algo_name}")
    print("Greedy assignment:", assigned)
    print("GA assignment:", assigned_ga)

    paths={}
    for r,sub in assigned_ga.items():
        cur=r
        for t in sub:
            p,_=(astar if algo_name=="A*" else theta_star)(grid,cur,t)
            paths.update({(cur,t):p})
            cur=t

    running=True
    while running:
        for e in pygame.event.get():
            if e.type==pygame.QUIT:
                running=False
        draw(grid,robots,tasks,{},algo_name)
        pygame.display.flip()
    pygame.quit()

if __name__=="__main__":
    main()
