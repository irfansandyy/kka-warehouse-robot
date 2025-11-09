import { useEffect, useRef, useState, useCallback } from "react";
import axios from "axios";

const BACKEND = "http://localhost:5001/api";
function parseCell(cell) {
  if (Array.isArray(cell) && cell.length === 2)
    return [Number(cell[0]), Number(cell[1])];
  if (typeof cell === "string") {
    try {
      const v = JSON.parse(cell);
      if (Array.isArray(v) && v.length === 2)
        return [Number(v[0]), Number(v[1])];
    } catch (e) {
      const s = cell.trim().replace(/[()\[\]]/g, "");
      const parts = s.split(",").map((p) => p.trim());
      if (parts.length === 2) return [Number(parts[0]), Number(parts[1])];
    }
  }
  return null;
}

const COLORS = ["#0b69ff", "#ff5f55", "#2dbf88", "#e2a72e", "#7b5fff"];

function CanvasGrid({
  grid,
  tasks,
  paths,
  robotsPositions,
  moving,
  simTime,
  forkliftPositions,
}) {
  const canvasRef = useRef();
  const cell = 24;
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !grid || !grid[0]) return;
    canvas.width = grid[0].length * cell;
    canvas.height = grid.length * cell;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    for (let r = 0; r < grid.length; r++) {
      for (let c = 0; c < grid[0].length; c++) {
        if (grid[r][c] === 1) {
          ctx.fillStyle = "#254061";
          ctx.fillRect(c * cell, r * cell, cell - 1, cell - 1);
        } else {
          ctx.fillStyle = "#f7fbff";
          ctx.fillRect(c * cell, r * cell, cell - 1, cell - 1);
          ctx.strokeStyle = "#e6f0fb";
          ctx.strokeRect(c * cell, r * cell, cell - 1, cell - 1);
        }
      }
    }

    if (tasks && tasks.length) {
      ctx.fillStyle = "#ffcc00";
      tasks.forEach((t) => {
        const [r, c] = t;
        ctx.beginPath();
        ctx.arc(
          c * cell + cell / 2,
          r * cell + cell / 2,
          cell / 5,
          0,
          Math.PI * 2
        );
        ctx.fill();
      });
    }

    if (forkliftPositions && forkliftPositions.length) {
      ctx.fillStyle = "#f5533e";
      forkliftPositions.forEach((cur) => {
        if (Array.isArray(cur) && cur.length >= 2) {
          ctx.fillRect(cur[1] * cell, cur[0] * cell, cell - 1, cell - 1);
        }
      });
    }

    if (paths) {
      Object.keys(paths).forEach((k, idx) => {
        const col = COLORS[idx % COLORS.length];
        const pts = (paths[k] || []).filter(
          (p) => Array.isArray(p) && p.length >= 2
        );
        if (pts.length < 2) return;
        ctx.strokeStyle = col;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(pts[0][1] * cell + cell / 2, pts[0][0] * cell + cell / 2);
        for (let i = 1; i < pts.length; i++) {
          const p = pts[i];
          ctx.lineTo(p[1] * cell + cell / 2, p[0] * cell + cell / 2);
        }
        ctx.stroke();
      });
    }

    if (robotsPositions) {
      robotsPositions.forEach((rp, idx) => {
        if (
          !rp ||
          !Array.isArray(rp) ||
          rp.length < 2 ||
          !isFinite(rp[0]) ||
          !isFinite(rp[1])
        )
          return;
        ctx.beginPath();
        ctx.fillStyle = COLORS[idx % COLORS.length];
        ctx.arc(
          rp[1] * cell + cell / 2,
          rp[0] * cell + cell / 2,
          cell / 2 - 3,
          0,
          Math.PI * 2
        );
        ctx.fill();
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 1;
        ctx.stroke();
      });
    }
  }, [grid, tasks, paths, robotsPositions, moving, simTime, forkliftPositions]);
  return <canvas ref={canvasRef} className="grid-canvas" />;
}

export default function App() {
  const [grid, setGrid] = useState(
    Array.from({ length: 20 }, () => Array(30).fill(0))
  );
  const [tasks, setTasks] = useState([]);
  const [robots, setRobots] = useState([]);
  const [moving, setMoving] = useState([]);
  const [paths, setPaths] = useState({});
  const [selectedAlg, setSelectedAlg] = useState("astar");
  const [optimizer, setOptimizer] = useState("greedy");
  const [status, setStatus] = useState("idle");
  const [stats, setStats] = useState({});
  const [robotPositions, setRobotPositions] = useState([]);
  const [simPlaying, setSimPlaying] = useState(false);
  const [speed, setSpeed] = useState(6);

  const [robotTaskAssignments, setRobotTaskAssignments] = useState({});
  const [robotTaskIndices, setRobotTaskIndices] = useState([]);
  const [robotSimTimes, setRobotSimTimes] = useState([]);
  const [isReplanning, setIsReplanning] = useState([]);
  const [robotLogs, setRobotLogs] = useState({});

  const rafRef = useRef(null);
  const timeRef = useRef([]); // Waktu individual robot
  const globalTimeRef = useRef(0); // Waktu global untuk forklift
  const [globalSimTime, setGlobalSimTime] = useState(0); // Untuk rendering forklift

  const [forkliftPositions, setForkliftPositions] = useState([]);
  const lastForkliftTickRef = useRef(0);

  useEffect(() => {
    generateMap();
  }, []);

  async function generateMap() {
    setStatus("generating");
    const res = await axios.post(BACKEND + "/generate_map", {
      num_tasks: 5,
      robots: 2,
      moving: 3,
    });
    setGrid(res.data.grid);
    setTasks(res.data.tasks);
    setRobots(res.data.robots);
    setMoving(res.data.moving);
    setPaths({});
    setRobotPositions(res.data.robots);

    const startPos = res.data.moving.map((o) =>
      o.path && o.path[0] ? o.path[0] : [0, 0]
    );
    setForkliftPositions(startPos);

    setStatus("ready");
  }

  async function planTasks() {
    setStatus("planning");
    const body = {
      grid,
      robots,
      tasks,
      optimizer,
      path_alg: selectedAlg === "astar" ? "astar" : "dijkstra",
    };
    const res = await axios.post(BACKEND + "/plan_tasks", body);
    setStatus("planned");
    setStats(res.data.costs);
    return res.data;
  }

  async function computePathsAndSchedule() {
    setStatus("computing paths");
    const assignResp = await planTasks();
    const robot_plans = {};
    const robotKeys = {};

    for (const r_tuple of robots) {
      const r_key = JSON.stringify(r_tuple);
      robotKeys[r_key] = r_tuple;

      let assignedTasks = [];
      for (const k_str in assignResp.assigned) {
        const k_tuple = parseCell(k_str);
        if (k_tuple[0] === r_tuple[0] && k_tuple[1] === r_tuple[1]) {
          assignedTasks = assignResp.assigned[k_str];
          break;
        }
      }
      robot_plans[r_key] = assignedTasks;
    }

    setRobotTaskAssignments(robot_plans);
    setRobotTaskIndices(robots.map(() => 0));
    setIsReplanning(robots.map(() => false));

    const body = {
      grid,
      robot_plans,
      alg: selectedAlg === "astar" ? "astar" : "dijkstra",
      moving,
    };
    const res = await axios.post(BACKEND + "/compute_paths", body);
    if (!res.data.ok) {
      alert("Compute paths failed: " + JSON.stringify(res.data));
      setStatus("error");
      return;
    }

    const rawPaths =
      res.data.scheduled_paths && Object.keys(res.data.scheduled_paths).length
        ? res.data.scheduled_paths
        : res.data.paths;
    const newPaths = {};
    const newRobPos = [];
    for (const k in rawPaths) {
      const r = parseCell(k);
      const pts = rawPaths[k] || [];
      newPaths[k] = pts;

      if (Array.isArray(pts) && pts.length > 0) {
        newRobPos.push(pts[0]);
      } else {
        newRobPos.push(r);
      }
    }
    setPaths(newPaths);
    setRobotPositions(newRobPos);
    setStatus("computed");
    setStats((prev) => ({
      ...prev,
      csp: res.data.csp,
      perrobot: res.data.stats,
    }));

    startAnimation(newPaths, robotKeys);
  }

  const handleReplanning = useCallback(
    async (robotIdx, robotKey) => {
      if (isReplanning[robotIdx]) return;

      setIsReplanning((prev) => {
        const next = [...prev];
        next[robotIdx] = true;
        return next;
      });

      const currentRobotTime = timeRef.current[robotIdx] || 0;
      const robotPath = paths[robotKey] || [];
      if (robotPath.length === 0) return;

      const currentPosIdx = Math.min(
        robotPath.length - 1,
        Math.floor(currentRobotTime)
      );
      const start = robotPath[currentPosIdx];

      const taskList = robotTaskAssignments[robotKey] || [];
      const taskIdx = robotTaskIndices[robotIdx] || 0;
      const tasks_remaining = taskList.slice(taskIdx);

      if (tasks_remaining.length === 0) {
        setIsReplanning((prev) => {
          const next = [...prev];
          next[robotIdx] = false;
          return next;
        });
        return;
      }

      const dynamic_obstacles = [];
      const forkliftPositions = moving
        .map((o) => {
          if (!o.path || o.path.length === 0) return null;
          const idx = Math.floor(globalTimeRef.current) % o.path.length;
          return o.path[idx];
        })
        .filter((p) => p);
      dynamic_obstacles.push(...forkliftPositions);

      robotPositions.forEach((pos, idx) => {
        if (idx !== robotIdx && pos) {
          dynamic_obstacles.push([Math.round(pos[0]), Math.round(pos[1])]);
        }
      });

      try {
        const res = await axios.post(BACKEND + "/api/replan", {
          grid,
          start,
          tasks_remaining,
          dynamic_obstacles,
        });

        if (res.data.ok && res.data.path) {
          const newPathSegment = res.data.path;
          setPaths((prevPaths) => {
            const oldFullLengthPath = prevPaths[robotKey] || [];
            const newCombinedPath = oldFullLengthPath
              .slice(0, currentPosIdx)
              .concat(newPathSegment);
            return { ...prevPaths, [robotKey]: newCombinedPath };
          });
        } else {
          console.warn(`Replanning failed for ${robotKey}: ${res.data.reason}`);
        }
      } catch (e) {
        console.error("Replanning API error", e);
      }

      setIsReplanning((prev) => {
        const next = [...prev];
        next[robotIdx] = false;
        return next;
      });
    },
    [
      grid,
      moving,
      robotPositions,
      paths,
      robotTaskAssignments,
      robotTaskIndices,
      isReplanning,
    ]
  );

  const stopAnimation = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    setSimPlaying(false);
  }, []);

  const startAnimation = useCallback(
    (pathsObj, robotKeys) => {
      if (!pathsObj || Object.keys(pathsObj).length === 0 || !robotKeys) {
        stopAnimation();
        return;
      }

      setSimPlaying(true);
      const entries = Object.entries(pathsObj).map(([key, path]) => ({
        key,
        path,
      }));
      const robotIndices = entries.map((entry) => {
        const pathKeyCoords = parseCell(entry.key);
        if (!pathKeyCoords) return -1;
        return robots.findIndex(
          (r) => r[0] === pathKeyCoords[0] && r[1] === pathKeyCoords[1]
        );
      });

      timeRef.current = new Array(robots.length).fill(0);
      setRobotSimTimes(new Array(robots.length).fill(0));
      globalTimeRef.current = 0;
      setGlobalSimTime(0);

      lastForkliftTickRef.current = 0;

      let lastTs = performance.now();

      const step = (now) => {
        const dt = (now - lastTs) / 1000;
        lastTs = now;

        const globalTNext = globalTimeRef.current + dt * speed;
        globalTimeRef.current = globalTNext;
        setGlobalSimTime(globalTNext);

        const currentTick = Math.floor(globalTNext);
        const lastTick = lastForkliftTickRef.current;
        let currentForkliftPos = forkliftPositions;

        if (currentTick > lastTick) {
          lastForkliftTickRef.current = currentTick;

          currentForkliftPos = forkliftPositions.map((pos) => {
            if (!pos) return null;
            const [r, c] = pos;
            const neighbors = [
              [-1, 0],
              [1, 0],
              [0, -1],
              [0, 1],
            ];
            const validNeighbors = [];

            for (const [dr, dc] of neighbors) {
              const nr = r + dr;
              const nc = c + dc;
              if (
                nr >= 0 &&
                nr < grid.length &&
                nc >= 0 &&
                nc < grid[0].length &&
                grid[nr][nc] === 0
              ) {
                validNeighbors.push([nr, nc]);
              }
            }

            if (validNeighbors.length > 0) {
              return validNeighbors[
                Math.floor(Math.random() * validNeighbors.length)
              ];
            }
            return pos;
          });

          setForkliftPositions(currentForkliftPos);
        }

        const forkliftCells = new Set();
        currentForkliftPos.forEach((pos) => {
          if (pos) forkliftCells.add(`${pos[0]},${pos[1]}`);
        });

        const newSimTimes = [...timeRef.current];
        const newPositions = [];
        const newIndices = [...robotTaskIndices];
        const newLogs = {}; // Untuk logging

        for (let i = 0; i < entries.length; i++) {
          const robotIdx = robotIndices[i];
          if (robotIdx === -1) continue;

          const robotKey = entries[i].key;
          const path = paths[robotKey] || [];
          const pts = path.filter(
            (p) =>
              Array.isArray(p) &&
              p.length >= 2 &&
              isFinite(p[0]) &&
              isFinite(p[1])
          );

          if (pts.length === 0) {
            newPositions[robotIdx] = robots[robotIdx];
            continue;
          }

          const tRobot = timeRef.current[robotIdx];
          let tRobotNext = tRobot + dt * speed;

          if (Math.floor(tRobot) >= pts.length - 1) {
            newSimTimes[robotIdx] = pts.length - 1;
            const finalPos = pts[pts.length - 1];
            newPositions[robotIdx] = finalPos;

            // Log data saat selesai
            newLogs[robotKey] = {
              posisi: `(${finalPos[0].toFixed(1)}, ${finalPos[1].toFixed(1)})`,
              target: "N/A",
              langkahBerikutnya: "N/A",
              status: "Selesai",
            };
            continue;
          }

          const nextCellIdx = Math.min(
            pts.length - 1,
            Math.floor(tRobotNext) + 1
          );
          const nextCell = pts[nextCellIdx];

          if (
            forkliftCells.has(`${nextCell[0]},${nextCell[1]}`) &&
            !isReplanning[robotIdx]
          ) {
            tRobotNext = Math.floor(tRobot); // Berhenti
            handleReplanning(robotIdx, robotKey);
          }

          newSimTimes[robotIdx] = tRobotNext;

          const idx = Math.min(pts.length - 1, Math.floor(tRobotNext));
          let a = pts[idx];
          let b = pts[Math.min(pts.length - 1, idx + 1)];
          if (!Array.isArray(a) || a.length < 2) a = pts[0];
          if (!Array.isArray(b) || b.length < 2) b = a;

          const frac = Math.min(1, tRobotNext - Math.floor(tRobotNext));
          const currentPos = [
            a[0] + (b[0] - a[0]) * frac,
            a[1] + (b[1] - a[1]) * frac,
          ];
          newPositions[robotIdx] = currentPos;

          const taskList = robotTaskAssignments[robotKey] || [];
          const currentTaskIdx = robotTaskIndices[robotIdx] || 0;
          if (currentTaskIdx < taskList.length) {
            const goalTask = taskList[currentTaskIdx];
            if (nextCell[0] === goalTask[0] && nextCell[1] === goalTask[1]) {
              newIndices[robotIdx] = currentTaskIdx + 1;
            }
          }

          // Kumpulkan data log
          let statusLog = "Menuju Target";
          if (isReplanning[robotIdx]) statusLog = "REPLANNING...";

          const targetTask =
            taskList[newIndices[robotIdx]] || taskList[currentTaskIdx];
          const nextStep =
            pts[Math.min(pts.length - 1, Math.floor(tRobot) + 1)] || currentPos;

          newLogs[robotKey] = {
            posisi: `(${currentPos[0].toFixed(1)}, ${currentPos[1].toFixed(
              1
            )})`,
            target: targetTask ? `(${targetTask[0]}, ${targetTask[1]})` : "N/A",
            langkahBerikutnya: nextStep
              ? `(${nextStep[0]}, ${nextStep[1]})`
              : "N/A",
            status: statusLog,
          };
        }

        timeRef.current = newSimTimes;
        setRobotSimTimes(newSimTimes);
        setRobotPositions(newPositions);
        setRobotTaskIndices(newIndices);
        setRobotLogs(newLogs); // Perbarui state log

        const allDone = newSimTimes.every((t, i) => {
          const path = paths[entries[i].key] || [];
          return t >= path.length - 1;
        });

        if (allDone) {
          stopAnimation();
          return;
        }
        rafRef.current = requestAnimationFrame(step);
      };

      stopAnimation();
      rafRef.current = requestAnimationFrame(step);
    },
    [
      robots,
      speed,
      paths,
      moving,
      robotTaskAssignments,
      robotTaskIndices,
      isReplanning,
      handleReplanning,
      stopAnimation,
      forkliftPositions,
      grid,
    ]
  );

  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  useEffect(() => {
    if (paths && Object.keys(paths).length > 0 && robots.length > 0) {
      const robotKeys = {};
      robots.forEach((r) => {
        robotKeys[JSON.stringify(r)] = r;
      });
      startAnimation(paths, robotKeys);
    } else {
      stopAnimation();
    }
  }, [paths]); // Hanya bergantung pada paths

  return (
    <div className="app">
      <div className="left">
        <div className="header">
          <button className="btn" onClick={generateMap}>
            Generate Map
          </button>
          <button className="small" onClick={planTasks}>
            Plan Tasks
          </button>
          <button className="small" onClick={computePathsAndSchedule}>
            Compute Paths & Schedule
          </button>
          <select
            value={optimizer}
            onChange={(e) => setOptimizer(e.target.value)}
          >
            <option value="greedy">Greedy</option>
            <option value="ga">Genetic (GA)</option>
            <option value="local">Local Search</option>
          </select>
          <select
            value={selectedAlg}
            onChange={(e) => setSelectedAlg(e.target.value)}
          >
            <option value="astar">A*</option>
            <option value="dijkstra">Dijkstra</option>
          </select>
          <div className="speed">
            <label className="label" htmlFor="speed">
              Speed
            </label>
            <input
              id="speed"
              type="range"
              min="1"
              max="20"
              value={speed}
              onChange={(e) => setSpeed(Number(e.target.value))}
            />
            <span className="value">{speed}x</span>
          </div>
          {simPlaying ? (
            <button className="small" onClick={stopAnimation}>
              Pause
            </button>
          ) : (
            <button className="small" onClick={() => startAnimation(paths)}>
              Play
            </button>
          )}
          <div style={{ marginLeft: 12 }} className="label">
            Status: <b>{status}</b>
          </div>
        </div>
        <CanvasGrid
          grid={grid}
          tasks={tasks}
          paths={paths}
          robotsPositions={robotPositions}
          moving={moving}
          simTime={globalSimTime}
          forkliftPositions={forkliftPositions}
        />
      </div>

      <div className="right">
        <h3>Tasks</h3>
        {tasks.map((t, idx) => (
          <div key={idx} className="task">
            #{idx + 1}: ({t[0]}, {t[1]})
          </div>
        ))}
        <div className="panel">
          <div className="stat">
            <div className="label">Robots</div>
            <div className="value">
              {robots.map((r) => `(${r[0]},${r[1]})`).join("  |  ")}
            </div>
          </div>

          <h3>Real-time Log</h3>
          {Object.entries(robotLogs).map(([robotKey, logData]) => {
            const robotIdx = robots.findIndex(
              (r) => JSON.stringify(r) === robotKey
            );
            const color =
              robotIdx !== -1 ? COLORS[robotIdx % COLORS.length] : "#333";

            return (
              <div
                key={robotKey}
                className="stat"
                style={{ borderLeft: `5px solid ${color}`, padding: "10px" }}
              >
                <div
                  className="value"
                  style={{
                    color: color,
                    fontSize: "16px",
                    marginBottom: "8px",
                  }}
                >
                  Robot @ {robotKey}
                </div>
                <div className="robot-log-item">
                  <span className="label">Status:</span>
                  <span
                    className="value"
                    style={{
                      color:
                        logData.status === "REPLANNING..." ? "#f5533e" : "#333",
                      fontSize: "14px",
                      fontWeight: "bold",
                    }}
                  >
                    {logData.status}
                  </span>
                </div>
                <div className="robot-log-item">
                  <span className="label">Posisi:</span>
                  <span className="value" style={{ fontSize: "14px" }}>
                    {logData.posisi}
                  </span>
                </div>
                <div className="robot-log-item">
                  <span className="label">Target:</span>
                  <span className="value" style={{ fontSize: "14px" }}>
                    {logData.target}
                  </span>
                </div>
                <div className="robot-log-item">
                  <span className="label">Langkah Berikut:</span>
                  <span className="value" style={{ fontSize: "14px" }}>
                    {logData.langkahBerikutnya}
                  </span>
                </div>
              </div>
            );
          })}

          <div className="stat">
            <div className="label">Optimizer</div>
            <div className="value">{optimizer.toUpperCase()}</div>
            <div className="label">Path algorithm</div>
            <div className="value">{selectedAlg.toUpperCase()}</div>
          </div>
          <div className="stat">
            <div className="label">Per-Robot Stats</div>
            <pre style={{ whiteSpace: "pre-wrap" }}>
              {JSON.stringify(stats, null, 2)}
            </pre>
          </div>
          <div className="stat">
            <div className="label">Legend</div>
            <div className="legend">
              {robots.map((_, idx) => (
                <div key={idx} className="legend-item">
                  <span
                    className="dot"
                    style={{ background: COLORS[idx % COLORS.length] }}
                  />{" "}
                  Robot {idx + 1}
                </div>
              ))}
              <div className="legend-item">
                <span className="dot" style={{ background: "#ffcc00" }} /> Task
              </div>
              <div className="legend-item">
                <span className="dot" style={{ background: "#f5533e" }} />{" "}
                Moving Obstacle
              </div>
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
