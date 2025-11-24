import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ControlBar } from "./components/ControlBar";
import { CanvasGrid } from "./components/CanvasGrid";
import { EditModePanel } from "./components/EditModePanel";
import { MapSettingsModal } from "./components/MapSettingsModal";
import { MetricDetailModal } from "./components/MetricDetailModal";
import { PerformancePanel } from "./components/PerformancePanel";
import { RobotDetailModal } from "./components/RobotDetailModal";
import { RobotLegend } from "./components/RobotLegend";
import { RobotSummaryList } from "./components/RobotSummaryList";
import { MAX_HEIGHT, MAX_ROBOTS, MAX_WIDTH, COLORS } from "./constants/config";
import { useManualEdits } from "./hooks/useManualEdits";
import { backendApi } from "./services/backendApi";
import { canonicalKey, cellKey, parseCell } from "./utils/cells";
import { estimateWalkableCells, computeTaskCap, computeMovingCap } from "./utils/density";
import { buildMetricCards, formatCell, prettifyLabel } from "./utils/formatters";
import { clampNumber } from "./utils/numbers";

export default function App() {
  const [grid, setGrid] = useState(Array.from({ length: 20 }, () => Array(30).fill(0)));
  const [tasks, setTasks] = useState([]);
  const [visibleTasks, setVisibleTasks] = useState([]);
  const [robots, setRobots] = useState([]);
  const [moving, setMoving] = useState([]);
  const [paths, setPaths] = useState({});
  const [robotSummaries, setRobotSummaries] = useState([]);
  const [taskAssignments, setTaskAssignments] = useState({});
  const [mapMeta, setMapMeta] = useState(null);
  const [status, setStatus] = useState("idle");
  const [stats, setStats] = useState({});
  const [selectedAlg, setSelectedAlg] = useState("astar");
  const [optimizer, setOptimizer] = useState("greedy");
  const [speed, setSpeed] = useState(6);
  const [simPlaying, setSimPlaying] = useState(false);
  const [simPaused, setSimPaused] = useState(false);
  const [robotPositions, setRobotPositions] = useState([]);
  const [robotTaskAssignments, setRobotTaskAssignments] = useState({});
  const [robotTaskIndices, setRobotTaskIndices] = useState([]);
  const [robotSimTimes, setRobotSimTimes] = useState([]);
  const [isReplanning, setIsReplanning] = useState([]);
  const [robotLogs, setRobotLogs] = useState({});
  const [forkliftPositions, setForkliftPositions] = useState([]);
  const [completedTasks, setCompletedTasks] = useState(new Set());
  const completedTasksRef = useRef(new Set());
  const [globalSimTime, setGlobalSimTime] = useState(0);
  const [selectedRobotKey, setSelectedRobotKey] = useState(null);
  const [stepMetadata, setStepMetadata] = useState({});
  const [metricDetail, setMetricDetail] = useState(null);

  const [mapWidth, setMapWidth] = useState(30);
  const [mapHeight, setMapHeight] = useState(20);
  const [wallRange, setWallRange] = useState({ min: 0.08, max: 0.18 });
  const [taskRange, setTaskRange] = useState({ min: 9, max: 21 });
  const [movingRange, setMovingRange] = useState({ min: 1, max: 3 });
  const [robotRange, setRobotRange] = useState({ min: 2, max: 4 });
  const [seed, setSeed] = useState("");

  const [showSettings, setShowSettings] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);

  const {
    manualEdits,
    hoverCell,
    setHoverCell,
    hasPendingChanges,
    pendingTotals,
    pendingRobotAdds,
    pendingRobotRemovals,
    pendingTaskAdds,
    pendingTaskRemovals,
    pendingWallAdds,
    pendingWallRemovals,
    pendingForkliftAdds,
    pendingForkliftRemovals,
    handleRobotShortcut,
    handleTaskShortcut,
    handleWallShortcut,
    handleForkliftShortcut,
    resetManualEdits,
  } = useManualEdits({ grid, robots, tasks, moving, isEditMode });

  const rafRef = useRef(null);
  const timeRef = useRef([]);
  const globalTimeRef = useRef(0);
  const hasGeneratedRef = useRef(false);
  const robotPathsRef = useRef([]);
  const robotAssignmentsRef = useRef([]);
  const forkliftPathsRef = useRef([]);
  const forkliftLoopFlagsRef = useRef([]);
  const robotTaskIndicesRef = useRef([]);
  const robotTaskPathIndicesRef = useRef([]);

  const robotColorMap = useMemo(() => {
    const map = {};
    (robots || []).forEach((robot, idx) => {
      if (!Array.isArray(robot) || robot.length < 2) return;
      const canonical = canonicalKey(robot);
      const color = COLORS[idx % COLORS.length];
      if (canonical) {
        map[canonical] = color;
      }
      map[cellKey(robot)] = color;
    });
    return map;
  }, [robots]);

  const hasScheduledPaths = useMemo(() => paths && Object.keys(paths).length > 0, [paths]);

  const planTiming = stats?.plan?.timing || null;
  const executionTiming = stats?.execution?.timing || null;
  const executionPerRobot = stats?.execution?.perRobot || null;

  const executionMetricCards = useMemo(() => buildMetricCards(executionPerRobot || {}), [executionPerRobot]);

  const robotNameMap = useMemo(() => {
    const map = {};
    (robotSummaries || []).forEach((robot, idx) => {
      const displayName = robot?.name?.trim?.() || `Robot ${idx + 1}`;
      const start = robot?.start;
      if (Array.isArray(start) && start.length === 2) {
        const variations = new Set([
          formatCell(start),
          `${start[0]},${start[1]}`,
          `[${start[0]},${start[1]}]`,
          `[${start[0]}, ${start[1]}]`,
          JSON.stringify([start[0], start[1]]),
          JSON.stringify(start),
        ]);
        const canonical = canonicalKey(start);
        if (canonical) variations.add(canonical);
        variations.forEach((key) => {
          map[key] = displayName;
          map[prettifyLabel(key)] = displayName;
        });
      }
    });
    return map;
  }, [robotSummaries]);

  const timingEntries = useMemo(
    () => [
      {
        key: "planning",
        label: "Planning Time",
        value: planTiming?.planning_time_ms,
        valueKey: "planning_time_ms",
      },
      {
        key: "compute",
        label: "Compute Paths Time",
        value: executionTiming?.path_compute_time_ms,
        valueKey: "path_compute_time_ms",
      },
      {
        key: "schedule",
        label: "Scheduling Time",
        value: executionTiming?.schedule_time_ms,
        valueKey: "schedule_time_ms",
      },
    ],
    [planTiming, executionTiming]
  );

  const executionRows = useMemo(() => {
    if (!executionMetricCards || executionMetricCards.length === 0) return [];
    return executionMetricCards.map((card, idx) => {
      const baseLabel = card.label?.trim?.() || card.key || `Metric ${idx + 1}`;
      const fallbackLabel = prettifyLabel(card.key || "");
      const title = robotNameMap[baseLabel] || robotNameMap[card.key] || robotNameMap[fallbackLabel] || baseLabel;
      return {
        key: card.key || idx,
        title,
        sourceLabel: card.label || baseLabel,
        headline: card.headline,
        headlineLabel: card.headlineLabel,
        details: card.details,
        card,
      };
    });
  }, [executionMetricCards, robotNameMap]);

  const hasTimingCard = timingEntries.some((entry) => Number.isFinite(entry.value));
  const showPerformancePanel = hasTimingCard || executionRows.length > 0;

  const clampSize = useCallback((value, min, max) => clampNumber(value, min, max), []);

  const walkableEstimate = useMemo(
    () => estimateWalkableCells(mapWidth, mapHeight, wallRange),
    [mapWidth, mapHeight, wallRange]
  );
  const dynamicTaskMax = useMemo(
    () => computeTaskCap(mapWidth, mapHeight, wallRange),
    [mapWidth, mapHeight, wallRange]
  );
  const dynamicMovingMax = useMemo(
    () => computeMovingCap(mapWidth, mapHeight, wallRange),
    [mapWidth, mapHeight, wallRange]
  );
  const taskRangeHint = `≤ ${dynamicTaskMax.toLocaleString()} tasks (≈ ${walkableEstimate.toLocaleString()} walkable tiles)`;
  const movingRangeHint = `0–${dynamicMovingMax} forklifts suggested (walkable ≈ ${walkableEstimate.toLocaleString()} tiles)`;

  useEffect(() => {
    setTaskRange((prev) => {
      const cappedMin = Math.min(prev.min, dynamicTaskMax);
      const cappedMax = Math.min(prev.max, dynamicTaskMax);
      if (cappedMin === prev.min && cappedMax === prev.max) {
        return prev;
      }
      return { min: cappedMin, max: Math.max(cappedMin, cappedMax) };
    });
  }, [dynamicTaskMax]);

  useEffect(() => {
    setMovingRange((prev) => {
      const cappedMin = Math.min(prev.min, dynamicMovingMax);
      const cappedMax = Math.min(prev.max, dynamicMovingMax);
      if (cappedMin === prev.min && cappedMax === prev.max) {
        return prev;
      }
      return { min: cappedMin, max: Math.max(cappedMin, cappedMax) };
    });
  }, [dynamicMovingMax]);

  const generateMap = useCallback(async () => {
    setStatus("generating");
    try {
      const payload = {
        width: clampSize(mapWidth, 8, MAX_WIDTH),
        height: clampSize(mapHeight, 8, MAX_HEIGHT),
        seed: seed || undefined,
        wall_density_range: wallRange,
        task_count_range: taskRange,
        moving_count_range: movingRange,
        robot_count_range: robotRange,
      };
      const data = await backendApi.generateMap(payload);
      const nextGrid = data.grid || [];
      const nextTasks = data.tasks || [];
      const nextRobots = data.robots || [];
      const nextMoving = data.moving || [];
      const meta = data.meta || null;

      setGrid(nextGrid);
      setTasks(nextTasks);
      setVisibleTasks(nextTasks);
      setRobots(nextRobots);
      setMoving(nextMoving);
      setMapMeta(meta);
      setPaths({});
      setRobotSummaries([]);
      setTaskAssignments({});
      setRobotTaskAssignments({});
      setRobotTaskIndices(new Array(nextRobots.length).fill(0));
      setIsReplanning(new Array(nextRobots.length).fill(false));
      setRobotSimTimes(new Array(nextRobots.length).fill(0));
      setRobotPositions(nextRobots.map((r) => [r[0], r[1]]));
      setRobotLogs({});
      setStepMetadata({});
      setStats({});
      resetManualEdits();
      completedTasksRef.current = new Set();
      setCompletedTasks(new Set());
      timeRef.current = new Array(nextRobots.length).fill(0);
      globalTimeRef.current = 0;
      setGlobalSimTime(0);
      setForkliftPositions(nextMoving.map((ob) => (ob?.path && ob.path.length ? ob.path[0] : null)));
      setStatus("ready");
    } catch (err) {
      console.error("generateMap failed", err);
      setStatus("error");
    }
  }, [
    clampSize,
    mapWidth,
    mapHeight,
    seed,
    wallRange,
    taskRange,
    movingRange,
    robotRange,
    resetManualEdits,
  ]);

  useEffect(() => {
    if (hasGeneratedRef.current) {
      return;
    }
    hasGeneratedRef.current = true;
    generateMap();
  }, [generateMap]);

  const stopAnimation = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    setSimPlaying(false);
    setSimPaused(false);
    if (paths && Object.keys(paths).length > 0) {
      setStatus("scheduled");
    } else {
      setStatus("idle");
    }
  }, [paths]);

  const resetSimulationUi = useCallback(
    ({ clearAssignments = false } = {}) => {
      stopAnimation();
      setPaths({});
      setStepMetadata({});
      setRobotLogs({});
      setSelectedRobotKey(null);
      setMetricDetail(null);
      setStats({});
      completedTasksRef.current = new Set();
      setCompletedTasks(new Set());
      if (clearAssignments) {
        setRobotSummaries([]);
        setTaskAssignments({});
        setRobotTaskAssignments({});
        setRobotTaskIndices([]);
      }
    },
    [stopAnimation]
  );

  const pauseAnimation = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    setSimPlaying(false);
    if (paths && Object.keys(paths).length > 0) {
      setSimPaused(true);
      setStatus("paused");
    } else {
      setSimPaused(false);
      setStatus("idle");
    }
  }, [paths]);

  const planTasks = useCallback(
    async (options = {}) => {
      const { skipReset = false } = options;
      if (!skipReset) {
        resetSimulationUi({ clearAssignments: true });
      }
      setStatus("planning");
      try {
        const payload = {
          grid,
          robots,
          tasks,
          optimizer,
          path_alg: selectedAlg === "astar" ? "astar" : "dijkstra",
        };
        const data = await backendApi.planTasks(payload);
        setStatus("planned");
        setRobotSummaries(data.robots || []);
        setTaskAssignments(data.task_assignments || {});
        setStats((prev) => ({
          ...prev,
          plan: {
            costs: data.costs || {},
            timing: data.metrics || {},
          },
        }));

        const assignments = {};
        Object.entries(data.assigned || {}).forEach(([robotKey, assignedTasks]) => {
          const parsedRobot = parseCell(robotKey);
          const canonical = parsedRobot ? canonicalKey(parsedRobot) : null;
          const parsedTasks = (assignedTasks || [])
            .map((task) => parseCell(task))
            .filter((cell) => Array.isArray(cell) && cell.length === 2);
          assignments[robotKey] = parsedTasks;
          if (canonical && canonical !== robotKey) {
            assignments[canonical] = parsedTasks;
          }
        });
        setRobotTaskAssignments(assignments);
        setRobotTaskIndices(new Array(robots.length).fill(0));
        setIsReplanning(new Array(robots.length).fill(false));
        return data;
      } catch (err) {
        console.error("planTasks failed", err);
        setStatus("error");
        throw err;
      }
    },
    [grid, optimizer, resetSimulationUi, robots, selectedAlg, tasks]
  );

  const computePathsAndSchedule = useCallback(async () => {
    resetSimulationUi({ clearAssignments: false });
    setStatus("computing paths");
    try {
      const assignment = await planTasks({ skipReset: true });
      const robotPlans = {};
      robots.forEach((robot) => {
        const key = JSON.stringify(robot);
        robotPlans[key] = [];
      });

      Object.entries(assignment.assigned || {}).forEach(([robotKey, assignedTasks]) => {
        const coords = parseCell(robotKey);
        if (!coords || coords.length < 2) {
          return;
        }
        const normalizedKey = JSON.stringify([Number(coords[0]), Number(coords[1])]);
        robotPlans[normalizedKey] = (assignedTasks || [])
          .map((task) => parseCell(task))
          .filter((cell) => Array.isArray(cell) && cell.length === 2)
          .map((cell) => [Number(cell[0]), Number(cell[1])]);
      });

      const payload = {
        grid,
        robot_plans: robotPlans,
        alg: selectedAlg === "astar" ? "astar" : "dijkstra",
        moving,
      };
      const data = await backendApi.computePaths(payload);
      if (!data.ok) {
        alert(`Compute paths failed: ${JSON.stringify(data)}`);
        setStatus("error");
        return;
      }

      const rawPaths = data.scheduled_paths && Object.keys(data.scheduled_paths).length
        ? data.scheduled_paths
        : data.paths;
      const newPaths = {};
      Object.entries(rawPaths || {}).forEach(([key, seq]) => {
        const canonical = canonicalKey(key);
        const targetKey = canonical || key;
        newPaths[targetKey] = seq;
      });
      setPaths(newPaths);
      setStatus("scheduled");
      setStats((prev) => ({
        ...prev,
        execution: {
          perRobot: data.stats || {},
          timing: data.timing || {},
        },
        csp: data.csp || {},
      }));
      setStepMetadata(data.step_metadata || {});
      setRobotLogs({});
    } catch (err) {
      console.error("computePaths failed", err);
      setStatus("error");
    }
  }, [grid, moving, planTasks, resetSimulationUi, robots, selectedAlg]);

  const handleReplanning = useCallback(
    async (robotIdx, robotKey) => {
      if (isReplanning[robotIdx]) return;
      setIsReplanning((prev) => {
        const next = [...prev];
        next[robotIdx] = true;
        return next;
      });
      try {
        const currentTime = globalTimeRef.current;
        const normalizedKey = canonicalKey(robotKey) || robotKey;
        const robotPath = paths[normalizedKey] || paths[robotKey] || [];
        if (!robotPath.length) return;
        const currentIdx = Math.min(robotPath.length - 1, Math.floor(timeRef.current[robotIdx] || 0));
        const start = robotPath[currentIdx];
        const assignments = robotTaskAssignments[normalizedKey] || robotTaskAssignments[robotKey] || [];
        const pendingTasks = assignments.slice(robotTaskIndices[robotIdx] || 0);
        if (!pendingTasks.length) return;
        const payload = {
          grid,
          start,
          tasks_remaining: pendingTasks,
          moving,
          current_time: Math.floor(currentTime),
        };
        const data = await backendApi.replan(payload);
        if (data.ok && data.path) {
          const newPath = data.path;
          setPaths((prev) => {
            const existing = prev[robotKey] || [];
            const updated = existing.slice(0, currentIdx).concat(newPath);
            return { ...prev, [robotKey]: updated };
          });
        }
      } catch (err) {
        console.error("replan error", err);
      } finally {
        setIsReplanning((prev) => {
          const next = [...prev];
          next[robotIdx] = false;
          return next;
        });
      }
    },
    [grid, moving, paths, robotTaskAssignments, robotTaskIndices, isReplanning]
  );

  const initializeAnimationState = useCallback(
    (pathsObj) => {
      const perRobotPaths = new Array(robots.length).fill(null).map(() => []);
      Object.entries(pathsObj).forEach(([key, rawPath]) => {
        const canonical = canonicalKey(key) || key;
        const coords = parseCell(canonical);
        if (!coords) return;
        const idx = robots.findIndex((r) => r[0] === coords[0] && r[1] === coords[1]);
        if (idx === -1) return;
        const parsed = (rawPath || [])
          .map((step) => parseCell(step))
          .filter(
            (p) => Array.isArray(p) && p.length === 2 && Number.isFinite(p[0]) && Number.isFinite(p[1])
          )
          .map((p) => [Number(p[0]), Number(p[1])]);
        if (parsed.length) perRobotPaths[idx] = parsed;
      });
      robotPathsRef.current = perRobotPaths;

      const perRobotAssignments = new Array(robots.length).fill(null).map(() => []);
      const perRobotTaskPathIndices = new Array(robots.length).fill(null).map(() => []);
      robots.forEach((robot, idx) => {
        const k = canonicalKey(robot) || JSON.stringify(robot);
        const assigned = (robotTaskAssignments[k] || [])
          .map((cell) => parseCell(cell))
          .filter((c) => Array.isArray(c) && c.length === 2);
        perRobotAssignments[idx] = assigned;
        const pathSteps = perRobotPaths[idx] || [];
        const indexMap = new Map();
        pathSteps.forEach((step, stepIdx) => {
          if (Array.isArray(step) && step.length === 2) {
            const key = `${step[0]},${step[1]}`;
            if (!indexMap.has(key)) indexMap.set(key, stepIdx);
          }
        });
        perRobotTaskPathIndices[idx] = assigned.map((t) => indexMap.get(`${t[0]},${t[1]}`));
      });
      robotAssignmentsRef.current = perRobotAssignments;
      robotTaskPathIndicesRef.current = perRobotTaskPathIndices;

      forkliftPathsRef.current = moving.map((ob) =>
        (ob?.path || [])
          .map((step) => parseCell(step))
          .filter(
            (p) => Array.isArray(p) && p.length === 2 && Number.isFinite(p[0]) && Number.isFinite(p[1])
          )
          .map((p) => [Number(p[0]), Number(p[1])])
      );
      forkliftLoopFlagsRef.current = moving.map((ob) => ob?.loop !== false);
      const startingForkliftPositions = (forkliftPathsRef.current || []).map((path) =>
        path?.length ? path[0] : null
      );
      setForkliftPositions(startingForkliftPositions);

      const zeroTimes = new Array(robots.length).fill(0);
      const zeroIndices = new Array(robots.length).fill(0);
      timeRef.current = zeroTimes.slice();
      setRobotSimTimes(zeroTimes);
      setRobotTaskIndices(zeroIndices);
      robotTaskIndicesRef.current = zeroIndices.slice();
      globalTimeRef.current = 0;
      setGlobalSimTime(0);
      completedTasksRef.current = new Set();
      setCompletedTasks(new Set());
      setRobotPositions(robots.map((r) => [r[0], r[1]]));
      setRobotLogs({});
      setVisibleTasks(tasks);
      return perRobotPaths.some((path) => path && path.length);
    },
    [robots, moving, robotTaskAssignments, tasks]
  );

  const runAnimationLoop = useCallback(() => {
    const perRobotPaths = robotPathsRef.current || [];
    const hasPaths = perRobotPaths.some((path) => path && path.length);
    if (!hasPaths) {
      stopAnimation();
      return;
    }
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    setSimPlaying(true);
    setSimPaused(false);
    setStatus("running");
    let lastTs = performance.now();

    const frame = (now) => {
      const currentPaths = robotPathsRef.current || [];
      const assignments = robotAssignmentsRef.current || [];
      const taskPathIdx = robotTaskPathIndicesRef.current || [];
      const dt = Math.max(0, (now - lastTs) / 1000);
      lastTs = now;
      const speedFactor = Math.max(0.01, speed);
      globalTimeRef.current += dt * speedFactor;
      setGlobalSimTime(globalTimeRef.current);

      const newTimes = [...timeRef.current];
      const newPositions = robots.map((r) => [r[0], r[1]]);
      const newTaskIndices = [...robotTaskIndicesRef.current];
      const logs = {};
      const completed = new Set(completedTasksRef.current);

      currentPaths.forEach((pathSteps, idx) => {
        if (!pathSteps || pathSteps.length === 0) return;
        const currentT = timeRef.current[idx] || 0;
        const nextT = Math.min(pathSteps.length - 1, currentT + dt * speedFactor);
        newTimes[idx] = nextT;
        const baseIdx = Math.floor(nextT);
        const nextIdx = Math.min(pathSteps.length - 1, baseIdx + 1);
        const frac = Math.min(1, nextT - baseIdx);
        const a = pathSteps[baseIdx];
        const b = pathSteps[nextIdx] || a;
        if (!a || !b) return;
        const interp = [a[0] + (b[0] - a[0]) * frac, a[1] + (b[1] - a[1]) * frac];
        newPositions[idx] = interp;

        const assignmentPathIndices = taskPathIdx[idx] || [];
        const assignedTasks = assignments[idx] || [];
        let currentTaskIdx = newTaskIndices[idx] || 0;
        while (
          currentTaskIdx < assignedTasks.length &&
          Number.isFinite(assignmentPathIndices[currentTaskIdx]) &&
          nextT >= assignmentPathIndices[currentTaskIdx]
        ) {
          const goal = assignedTasks[currentTaskIdx];
          completed.add(`${goal[0]},${goal[1]}`);
          currentTaskIdx += 1;
        }
        newTaskIndices[idx] = currentTaskIdx;
        const canonicalRobotKey = canonicalKey(robots[idx]) || JSON.stringify(robots[idx]);
        const statusText = isReplanning[idx]
          ? "Replanning..."
          : newTaskIndices[idx] >= assignedTasks.length
          ? "Completed"
          : "En route";
        const upcomingStep = pathSteps[Math.min(pathSteps.length - 1, baseIdx + 1)];
        const color = robotColorMap[canonicalRobotKey] || COLORS[idx % COLORS.length];
        logs[canonicalRobotKey] = {
          status: statusText,
          position: formatCell(interp.map((v) => Number(v.toFixed(1)))),
          target: assignedTasks[newTaskIndices[idx]] ? formatCell(assignedTasks[newTaskIndices[idx]]) : "N/A",
          nextStep: upcomingStep ? formatCell(upcomingStep) : "N/A",
          color,
        };
      });

      const forkliftPos = (forkliftPathsRef.current || []).map((pathSteps, fIdx) => {
        if (!pathSteps || pathSteps.length === 0) return null;
        if (pathSteps.length === 1) return pathSteps[0];
        const loop = forkliftLoopFlagsRef.current?.[fIdx];
        const progress = loop
          ? globalTimeRef.current % pathSteps.length
          : Math.min(globalTimeRef.current, pathSteps.length - 1);
        const baseIdx = Math.floor(progress);
        const nextIdx = loop ? (baseIdx + 1) % pathSteps.length : Math.min(pathSteps.length - 1, baseIdx + 1);
        const frac = Math.min(1, progress - baseIdx);
        const a = pathSteps[baseIdx];
        const b = pathSteps[nextIdx] || a;
        if (!a || !b) return pathSteps[baseIdx];
        return [a[0] + (b[0] - a[0]) * frac, a[1] + (b[1] - a[1]) * frac];
      });

      timeRef.current = newTimes;
      setRobotSimTimes(newTimes);
      setRobotPositions(newPositions);
      setRobotTaskIndices(newTaskIndices);
      robotTaskIndicesRef.current = newTaskIndices;
      setRobotLogs(logs);
      completedTasksRef.current = completed;
      setCompletedTasks(new Set(completed));
      setForkliftPositions(forkliftPos);

      const allDone = currentPaths.every((p, idx) => !p?.length || newTimes[idx] >= p.length - 1);
      if (allDone) {
        stopAnimation();
        return;
      }
      rafRef.current = requestAnimationFrame(frame);
    };

    rafRef.current = requestAnimationFrame(frame);
  }, [robots, speed, isReplanning, robotColorMap, stopAnimation]);

  const startAnimation = useCallback(
    (pathsObj, options = {}) => {
      const { resume = false } = options;
      if (!pathsObj || !Object.keys(pathsObj).length || robots.length === 0) {
        stopAnimation();
        return;
      }
      if (!resume) {
        const initialized = initializeAnimationState(pathsObj);
        if (!initialized) {
          stopAnimation();
          return;
        }
      } else if (!robotPathsRef.current || robotPathsRef.current.every((p) => !p || p.length === 0)) {
        stopAnimation();
        return;
      }
      runAnimationLoop();
    },
    [initializeAnimationState, runAnimationLoop, stopAnimation]
  );

  const resumeAnimation = useCallback(() => {
    startAnimation(paths, { resume: true });
  }, [paths, startAnimation]);

  const handleResetRun = useCallback(() => {
    if (!paths || !Object.keys(paths).length) {
      stopAnimation();
      return;
    }
    stopAnimation();
    initializeAnimationState(paths);
  }, [initializeAnimationState, paths, stopAnimation]);

  useEffect(() => () => rafRef.current && cancelAnimationFrame(rafRef.current), []);

  useEffect(() => {
    if (!paths || Object.keys(paths).length === 0 || robots.length === 0) {
      stopAnimation();
    }
  }, [paths, robots.length, stopAnimation]);

  useEffect(() => {
    robotTaskIndicesRef.current = robotTaskIndices;
  }, [robotTaskIndices]);

  useEffect(() => {
    const handler = (event) => {
      const target = event.target;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target?.isContentEditable) {
        return;
      }
      const key = event.key?.toLowerCase?.();
      if (key === "e" && !event.repeat) {
        setIsEditMode((prev) => !prev);
      } else if (key === "r") {
        event.preventDefault();
        handleRobotShortcut();
      } else if (key === "t") {
        event.preventDefault();
        handleTaskShortcut();
      } else if (key === "w") {
        event.preventDefault();
        handleWallShortcut();
      } else if (key === "f") {
        event.preventDefault();
        handleForkliftShortcut();
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleRobotShortcut, handleTaskShortcut, handleWallShortcut, handleForkliftShortcut]);

  const applyManualChanges = useCallback(async () => {
    if (!hasPendingChanges) return;
    try {
      setStatus("applying edits");
      const payload = {
        grid,
        robots,
        tasks,
        moving,
        edits: manualEdits,
        confirm: true,
      };
      const res = await backendApi.applyManualEdits(payload);
      if (!res.ok) {
        alert("Manual edit failed");
        return;
      }
      const nextGrid = res.grid || grid;
      const nextRobots = res.robots || robots;
      const nextTasks = res.tasks || tasks;
      const nextMoving = res.moving || moving;
      setGrid(nextGrid);
      setRobots(nextRobots);
      setTasks(nextTasks);
      setVisibleTasks(nextTasks);
      setMoving(nextMoving);
      setForkliftPositions(nextMoving.map((ob) => (ob?.path && ob.path.length ? ob.path[0] : null)));
      resetManualEdits();
      setPaths({});
      setRobotSummaries([]);
      setTaskAssignments({});
      setRobotTaskAssignments({});
      setRobotTaskIndices(new Array(nextRobots.length).fill(0));
      setIsReplanning(new Array(nextRobots.length).fill(false));
      setRobotSimTimes(new Array(nextRobots.length).fill(0));
      setRobotPositions(nextRobots.map((r) => [r[0], r[1]]));
      setRobotLogs({});
      setStepMetadata({});
      completedTasksRef.current = new Set();
      setCompletedTasks(new Set());
      setStatus("edits applied");
    } catch (err) {
      console.error("manual apply failed", err);
      setStatus("error");
    }
  }, [grid, robots, tasks, moving, manualEdits, resetManualEdits, hasPendingChanges]);

  const prevEditModeRef = useRef(isEditMode);
  useEffect(() => {
    if (prevEditModeRef.current && !isEditMode && hasPendingChanges) {
      const applyAsync = async () => {
        try {
          await applyManualChanges();
        } catch (error) {
          console.error("Auto apply manual edits failed", error);
        }
      };
      applyAsync();
    }
    prevEditModeRef.current = isEditMode;
  }, [isEditMode, hasPendingChanges, applyManualChanges]);

  useEffect(() => {
    setForkliftPositions((moving || []).map((ob) => (ob?.path && ob.path.length ? ob.path[0] : null)));
  }, [moving]);

  return (
    <div className="app">
      <div className="left">
        <ControlBar
          onOpenSettings={() => setShowSettings(true)}
          onGenerateMap={generateMap}
          onPlanTasks={() => planTasks()}
          onComputePaths={computePathsAndSchedule}
          optimizer={optimizer}
          onOptimizerChange={setOptimizer}
          selectedAlg={selectedAlg}
          onAlgChange={setSelectedAlg}
          speed={speed}
          onSpeedChange={setSpeed}
          simPlaying={simPlaying}
          simPaused={simPaused}
          hasScheduledPaths={hasScheduledPaths}
          onPause={pauseAnimation}
          onResume={resumeAnimation}
          onReset={handleResetRun}
          onPlay={() => startAnimation(paths)}
          isEditMode={isEditMode}
          onToggleEditMode={() => setIsEditMode((prev) => !prev)}
          status={status}
        />
        <div className="canvas-shell">
          <CanvasGrid
            grid={grid}
            tasks={visibleTasks}
            paths={paths}
            robotsPositions={robotPositions}
            moving={moving}
            simTime={globalSimTime}
            forkliftPositions={forkliftPositions}
            taskAssignments={taskAssignments}
            completedTasks={completedTasks}
            editMode={isEditMode}
            hoverCell={hoverCell}
            pendingRobotAdds={pendingRobotAdds}
            pendingRobotRemovals={pendingRobotRemovals}
            pendingTaskAdds={pendingTaskAdds}
            pendingTaskRemovals={pendingTaskRemovals}
            pendingWallAdds={pendingWallAdds}
            pendingWallRemovals={pendingWallRemovals}
            pendingForkliftAdds={pendingForkliftAdds}
            pendingForkliftRemovals={pendingForkliftRemovals}
            onHoverCell={setHoverCell}
            robotColorMap={robotColorMap}
          />
        </div>
      </div>

      <div className="right">
        <h3>Common Information</h3>
        <div className="stat">
          <div className="label">Meta</div>
          <div className="value">
            {mapMeta
              ? `Grid ${mapMeta.width}x${mapMeta.height} | Robots ${mapMeta.num_robots} | Tasks ${mapMeta.num_tasks} | Forklifts ${mapMeta.num_moving}`
              : "N/A"}
          </div>
        </div>

        <RobotLegend robots={robots} />
        <EditModePanel isEditMode={isEditMode} pendingTotals={pendingTotals} />

        <div className="stat">
          <div className="label">Optimizer</div>
          <div className="value">{optimizer.toUpperCase()}</div>
          <div className="label">Path Algorithm</div>
          <div className="value">{selectedAlg.toUpperCase()}</div>
        </div>

        <h3>Robots & Tasks</h3>
        <RobotSummaryList
          robotSummaries={robotSummaries}
          robotLogs={robotLogs}
          robotColorMap={robotColorMap}
          onSelectRobot={setSelectedRobotKey}
        />

        <h3>Metrics</h3>
        <PerformancePanel
          showPerformancePanel={showPerformancePanel}
          hasTimingCard={hasTimingCard}
          timingEntries={timingEntries}
          executionRows={executionRows}
          onShowDetails={setMetricDetail}
        />
      </div>

      <MapSettingsModal
        open={showSettings}
        onClose={() => setShowSettings(false)}
        onGenerate={() => {
          generateMap();
          setShowSettings(false);
        }}
        mapWidth={mapWidth}
        mapHeight={mapHeight}
        seed={seed}
        onMapWidthChange={(value) => setMapWidth(clampSize(value, 8, MAX_WIDTH))}
        onMapHeightChange={(value) => setMapHeight(clampSize(value, 8, MAX_HEIGHT))}
        onSeedChange={setSeed}
        robotRange={robotRange}
        onRobotRangeChange={setRobotRange}
        taskRange={taskRange}
        onTaskRangeChange={setTaskRange}
        movingRange={movingRange}
        onMovingRangeChange={setMovingRange}
        wallRange={wallRange}
        onWallRangeChange={setWallRange}
        maxWidth={MAX_WIDTH}
        maxHeight={MAX_HEIGHT}
        maxRobots={MAX_ROBOTS}
        dynamicTaskMax={dynamicTaskMax}
        dynamicMovingMax={dynamicMovingMax}
        taskRangeHint={taskRangeHint}
        movingRangeHint={movingRangeHint}
      />

      {selectedRobotKey && (
        <RobotDetailModal
          robotKey={selectedRobotKey}
          onClose={() => setSelectedRobotKey(null)}
          robotData={{
            path: paths[canonicalKey(selectedRobotKey)] || paths[selectedRobotKey] || [],
            log: robotLogs[canonicalKey(selectedRobotKey)] || robotLogs[selectedRobotKey] || {},
            tasks:
              robotSummaries.find(
                (r) => (canonicalKey(r.start) || JSON.stringify(r.start)) === selectedRobotKey
              )?.assignments || [],
            currentStepIdx:
              (() => {
                const canonical = canonicalKey(selectedRobotKey);
                const idx = robots.findIndex((robot) => {
                  const key = JSON.stringify([robot[0], robot[1]]);
                  return key === selectedRobotKey || key === canonical;
                });
                if (idx === -1) return 0;
                const sim = robotSimTimes[idx];
                return Number.isFinite(sim) ? Math.floor(sim) : 0;
              })(),
          }}
        />
      )}
      {metricDetail && <MetricDetailModal data={metricDetail} onClose={() => setMetricDetail(null)} />}
    </div>
  );
}
