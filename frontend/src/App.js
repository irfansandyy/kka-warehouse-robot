import React, { useEffect, useRef, useState, useMemo, useCallback } from "react";
import axios from "axios";

const BACKEND = "http://localhost:5001/api";
function parseCell(cell) {
  if (Array.isArray(cell) && cell.length === 2) return [Number(cell[0]), Number(cell[1])];
  if (typeof cell === 'string') {
    try {
      const v = JSON.parse(cell);
      if (Array.isArray(v) && v.length === 2) return [Number(v[0]), Number(v[1])];
    } catch (e) {
      const s = cell.trim().replace(/[()\[\]]/g, "");
      const parts = s.split(",").map(p=>p.trim());
      if (parts.length === 2) return [Number(parts[0]), Number(parts[1])];
    }
  }
  return null;
}

const COLORS = ["#0b69ff", "#ff5f55", "#2dbf88", "#e2a72e", "#7b5fff"];

function CanvasGrid({grid, tasks, paths, robotsPositions, moving, simTime}) {
  const canvasRef = useRef();
  const cell = 24;
  useEffect(()=> {
    const canvas = canvasRef.current;
    canvas.width = grid[0].length * cell;
    canvas.height = grid.length * cell;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0,0,canvas.width,canvas.height);
    ctx.fillStyle = "#fff";
    ctx.fillRect(0,0,canvas.width,canvas.height);
    for(let r=0;r<grid.length;r++){
      for(let c=0;c<grid[0].length;c++){
        if(grid[r][c]===1){
          ctx.fillStyle="#254061";
          ctx.fillRect(c*cell, r*cell, cell-1, cell-1);
        } else {
          ctx.fillStyle="#f7fbff";
          ctx.fillRect(c*cell, r*cell, cell-1, cell-1);
          ctx.strokeStyle="#e6f0fb";
          ctx.strokeRect(c*cell, r*cell, cell-1, cell-1);
        }
      }
    }
    
    if (tasks && tasks.length) {
      ctx.fillStyle = "#ffcc00";
      tasks.forEach(t => {
        const [r,c] = t;
        ctx.beginPath();
        ctx.arc(c*cell + cell/2, r*cell + cell/2, cell/5, 0, Math.PI*2);
        ctx.fill();
      });
    }
    
    if(moving && moving.length){
      moving.forEach((o, oi)=>{
        Array.isArray(o.path) && o.path.forEach(p=>{
          if (!Array.isArray(p) || p.length < 2) return;
          ctx.fillStyle = "rgba(245,83,62,0.10)";
          ctx.fillRect(p[1]*cell, p[0]*cell, cell-1, cell-1);
        });
        
        if (o.path && o.path.length) {
          const idx = Math.floor(simTime) % o.path.length;
          const cur = o.path[idx];
          if (Array.isArray(cur) && cur.length >= 2) {
            ctx.fillStyle = "#f5533e";
            ctx.fillRect(cur[1]*cell, cur[0]*cell, cell-1, cell-1);
          }
        }
      });
    }
    
    if(paths){
      Object.keys(paths).forEach((k, idx)=>{
        const col = COLORS[idx % COLORS.length];
        const pts = (paths[k] || []).filter(p => Array.isArray(p) && p.length>=2);
        if(pts.length<2) return;
        ctx.strokeStyle = col;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(pts[0][1]*cell + cell/2, pts[0][0]*cell + cell/2);
        for(let i=1;i<pts.length;i++){
          const p = pts[i];
          ctx.lineTo(p[1]*cell + cell/2, p[0]*cell + cell/2);
        }
        ctx.stroke();
      });
    }
    
    if(robotsPositions){
      robotsPositions.forEach((rp, idx)=>{
        if (!rp || !Array.isArray(rp) || rp.length < 2 || !isFinite(rp[0]) || !isFinite(rp[1])) return;
        ctx.beginPath();
        ctx.fillStyle = COLORS[idx % COLORS.length];
        ctx.arc(rp[1]*cell + cell/2, rp[0]*cell + cell/2, cell/2 - 3, 0, Math.PI*2);
        ctx.fill();
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 1;
        ctx.stroke();
      });
    }
  }, [grid, tasks, paths, robotsPositions, moving, simTime]);
  return <canvas ref={canvasRef} className="grid-canvas" />;
}

export default function App(){
  const [grid, setGrid] = useState(Array.from({length:20}, ()=> Array(30).fill(0)));
  const [tasks, setTasks] = useState([]);
  const [robots, setRobots] = useState([]);
  const [moving, setMoving] = useState([]);
  const [paths, setPaths] = useState({});
  const [selectedAlg, setSelectedAlg] = useState("theta");
  const [optimizer, setOptimizer] = useState("greedy");
  const [status, setStatus] = useState("idle");
  const [stats, setStats] = useState({});
  const [robotPositions, setRobotPositions] = useState([]);
  const [simPlaying, setSimPlaying] = useState(false);
  const [speed, setSpeed] = useState(6); // cells per second
  const [simTime, setSimTime] = useState(0);
  const rafRef = useRef(null);
  const timeRef = useRef(0);

  useEffect(()=> {
    generateMap();
  }, []);

  async function generateMap(){
    setStatus("generating");
    const res = await axios.post(BACKEND + "/generate_map", {num_tasks:5, robots:2, moving:3});
    setGrid(res.data.grid);
    setTasks(res.data.tasks);
    setRobots(res.data.robots);
    setMoving(res.data.moving);
    setPaths({});
    setRobotPositions(res.data.robots);
    setStatus("ready");
  }

  async function planTasks(){
    setStatus("planning");
    const body = { grid, robots, tasks, optimizer, path_alg: selectedAlg==="astar" ? "astar" : selectedAlg==="theta" ? "theta" : "dijkstra" };
    const res = await axios.post(BACKEND + "/plan_tasks", body);
    setStatus("planned");
    setStats(res.data.costs);
    return res.data;
  }

  async function computePathsAndSchedule(){
    setStatus("computing paths");
    const assignResp = await planTasks();
    const robot_plans = {};
    let i = 0;
    for (const k of Object.keys(assignResp.assigned)){
      const rid = robots[i];
      robot_plans[JSON.stringify(rid)] = assignResp.assigned[k];
      i++;
    }
    const body = { grid, robot_plans, alg: selectedAlg==="astar"?"astar": selectedAlg==="theta"?"theta":"dijkstra", moving };
    const res = await axios.post(BACKEND + "/compute_paths", body);
    if(!res.data.ok){
      alert("Compute paths failed: " + JSON.stringify(res.data));
      setStatus("error");
      return;
    }
    
    const rawPaths = res.data.scheduled_paths && Object.keys(res.data.scheduled_paths).length ? res.data.scheduled_paths : res.data.paths;
    const newPaths = {};
    const newRobPos = [];
    for(const k in rawPaths){
      const r = parseCell(k);
      const pts = rawPaths[k] || [];
      newPaths[k] = pts;
      
      if (Array.isArray(pts) && pts.length>0) {
        newRobPos.push(pts[0]);
      } else {
        newRobPos.push(r);
      }
    }
    setPaths(newPaths);
    setRobotPositions(newRobPos);
    setStatus("computed");
    setStats(prev => ({...prev, csp:res.data.csp, perrobot:res.data.stats}));
    startAnimation(newPaths);
  }

  const startAnimation = useCallback((pathsObj)=>{
    if (!pathsObj || Object.keys(pathsObj).length===0) return;
    setSimPlaying(true);
    timeRef.current = 0;
    setSimTime(0);
    const entries = Object.entries(pathsObj);
    let lastTs = performance.now();
    const step = (now)=>{
      const dt = (now - lastTs) / 1000;
      lastTs = now;
      const tNext = timeRef.current + dt*speed;
      timeRef.current = tNext;
      setSimTime(tNext);
      
      const positions = entries.map(([k,v]) => {
        if(!Array.isArray(v) || v.length===0) return null;
        const pts = v.filter(p => Array.isArray(p) && p.length>=2 && isFinite(p[0]) && isFinite(p[1]));
        if (pts.length === 0) return null;
        const idx = Math.min(pts.length-1, Math.floor(tNext));
        let a = pts[idx];
        let b = pts[Math.min(pts.length-1, idx+1)];
        if (!Array.isArray(a) || a.length<2) a = pts[0];
        if (!Array.isArray(b) || b.length<2) b = a;
        const frac = Math.min(1, (tNext - Math.floor(tNext)));
        return [a[0] + (b[0]-a[0])*frac, a[1] + (b[1]-a[1])*frac];
      });
      setRobotPositions(positions);
      const allDone = entries.every(([k,v]) => Math.floor(tNext) >= (v ? v.length-1 : 0));
      if (allDone) {
        setSimPlaying(false);
        rafRef.current = null;
        return;
      }
      rafRef.current = requestAnimationFrame(step);
    };
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(step);
  }, [speed]);

  const stopAnimation = useCallback(()=>{
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    setSimPlaying(false);
  }, []);

  useEffect(()=>{
    return ()=> { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, []);

  useEffect(()=>{
    if(!paths || Object.keys(paths).length===0) return;
    startAnimation(paths);
  }, [paths, startAnimation]);

  return (
    <div className="app">
      <div className="left">
        <div className="header">
          <button className="btn" onClick={generateMap}>Generate Map</button>
          <button className="small" onClick={planTasks}>Plan Tasks</button>
          <button className="small" onClick={computePathsAndSchedule}>Compute Paths & Schedule</button>
          <select value={optimizer} onChange={e=>setOptimizer(e.target.value)}>
            <option value="greedy">Greedy</option>
            <option value="ga">Genetic (GA)</option>
            <option value="local">Local Search</option>
          </select>
          <select value={selectedAlg} onChange={e=>setSelectedAlg(e.target.value)}>
            <option value="theta">Theta*</option>
            <option value="astar">A*</option>
            <option value="dijkstra">Dijkstra</option>
          </select>
          <div className="speed">
            <label className="label" htmlFor="speed">Speed</label>
            <input id="speed" type="range" min="1" max="20" value={speed} onChange={e=>setSpeed(Number(e.target.value))}/>
            <span className="value">{speed}x</span>
          </div>
          {simPlaying ? (
            <button className="small" onClick={stopAnimation}>Pause</button>
          ) : (
            <button className="small" onClick={()=>startAnimation(paths)}>Play</button>
          )}
          <div style={{marginLeft:12}} className="label">Status: <b>{status}</b></div>
        </div>
        <CanvasGrid grid={grid} tasks={tasks} paths={paths} robotsPositions={robotPositions} moving={moving} simTime={simTime}/>
      </div>

      <div className="right">
        <h3>Tasks</h3>
        {tasks.map((t,idx)=> <div key={idx} className="task">#{idx+1}: ({t[0]}, {t[1]})</div>)}
        <div className="panel">
          <div className="stat">
            <div className="label">Robots</div>
            <div className="value">{robots.map(r=>`(${r[0]},${r[1]})`).join("  |  ")}</div>
          </div>
          <div className="stat">
            <div className="label">Optimizer</div>
            <div className="value">{optimizer.toUpperCase()}</div>
            <div className="label">Path algorithm</div>
            <div className="value">{selectedAlg.toUpperCase()}</div>
          </div>
          <div className="stat">
            <div className="label">Per-Robot Stats</div>
            <pre style={{whiteSpace:'pre-wrap'}}>{JSON.stringify(stats,null,2)}</pre>
          </div>
          <div className="stat">
            <div className="label">Legend</div>
            <div className="legend">
              {robots.map((_, idx)=> (
                <div key={idx} className="legend-item"><span className="dot" style={{background: COLORS[idx % COLORS.length]}}/> Robot {idx+1}</div>
              ))}
              <div className="legend-item"><span className="dot" style={{background: '#ffcc00'}}/> Task</div>
              <div className="legend-item"><span className="dot" style={{background: '#f5533e'}}/> Moving Obstacle</div>
            </div>
          </div>
          <div className="stat">
            <div className="label">Notes</div>
            <div>Click Generate -&gt; Plan Tasks -&gt; Compute Paths</div>
            <div>Visual animation plays automatically</div>
          </div>
        </div>
      </div>
    </div>
  );
}
