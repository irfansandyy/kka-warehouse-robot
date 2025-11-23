import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";

const BACKEND = "http://localhost:5001/api";
const COLORS = ["#0b69ff", "#ff5f55", "#2dbf88", "#e2a72e", "#7b5fff"];
const COMPLETED_COLOR = "#25a86b";
const MAX_ROBOTS = 5;
const MAX_WIDTH = 200;
const MAX_HEIGHT = 200;
const EXECUTION_DETAIL_INLINE_LIMIT = 3;
const FORKLIFT_MIN_STEPS = 10;
const FORKLIFT_MAX_STEPS = 35;

function createEmptyManualEdits() {
  return {
    robots: { add: [], remove: [] },
    tasks: { add: [], remove: [] },
    walls: { add: [], remove: [] },
    forklifts: { add: [], remove: [] },
  };
}

function pathSignature(path) {
  return JSON.stringify((path || []).map((step) => parseCell(step)).filter(Boolean));
}

function parseCell(cell) {
  if (Array.isArray(cell) && cell.length === 2) {
    return [Number(cell[0]), Number(cell[1])];
  }
  if (typeof cell === "string") {
    try {
      const parsed = JSON.parse(cell);
      if (Array.isArray(parsed) && parsed.length === 2) {
        return [Number(parsed[0]), Number(parsed[1])];
      }
    } catch (error) {
      try {
        const fallback = cell.trim().replace(/[()\[\]]/g, "");
        const parts = fallback.split(",").map((p) => p.trim());
        if (parts.length === 2) {
          return [Number(parts[0]), Number(parts[1])];
        }
      } catch (ignored) {
        return null;
      }
    }
  }
  return null;
}

function canonicalKey(cell) {
  const coords = parseCell(cell);
  if (!coords) return null;
  return JSON.stringify([Number(coords[0]), Number(coords[1])]);
}

function clampNumber(value, min, max) {
  const num = Number(value);
  if (!Number.isFinite(num)) return min;
  return Math.max(min, Math.min(max, num));
}

function lightenColor(hex, amount = 0.35) {
  if (!hex || hex[0] !== "#") return hex;
  const num = parseInt(hex.slice(1), 16);
  const r = Math.min(255, Math.floor((num >> 16) * (1 - amount) + 255 * amount));
  const g = Math.min(255, Math.floor(((num >> 8) & 0xff) * (1 - amount) + 255 * amount));
  const b = Math.min(255, Math.floor((num & 0xff) * (1 - amount) + 255 * amount));
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b
    .toString(16)
    .padStart(2, "0")}`;
}

function formatCell(cell) {
  if (!cell || cell.length < 2) return "(?, ?)";
  return `(${cell[0]}, ${cell[1]})`;
}

function prettifyLabel(label) {
  if (!label) return "";
  return label
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatDuration(value, assumesMilliseconds = false) {
  if (!Number.isFinite(value)) return "—";
  const ms = assumesMilliseconds ? value : value * 1000;
  if (ms < 1) {
    return `${ms.toFixed(3)} ms`;
  }
  if (ms < 1000) {
    return `${ms.toFixed(ms < 100 ? 2 : 1)} ms`;
  }
  const seconds = ms / 1000;
  if (seconds < 60) {
    const precision = seconds < 10 ? 3 : 2;
    return `${seconds.toFixed(precision)} s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  const minutePart = `${minutes}m`;
  const secondPart = remainder > 0 ? ` ${remainder.toFixed(remainder < 10 ? 2 : 1)}s` : "";
  return `${minutePart}${secondPart}`.trim();
}

function summarizeObject(obj, depth = 0) {
  if (!obj || typeof obj !== "object") return String(obj);
  const entries = Object.entries(obj);
  if (!entries.length) return "{}";
  const preview = entries.slice(0, 3).map(([key, val]) => {
    const label = prettifyLabel(key);
    return `${label}: ${formatMetricValue(val, key, depth + 1)}`;
  });
  const remainder = entries.length - preview.length;
  return `${preview.join(" · ")}${remainder > 0 ? ` · +${remainder} more` : ""}`;
}

function formatMetricValue(value, key = "", depth = 0) {
  if (value === null || value === undefined) return "—";
  const normalizedKey = key?.toLowerCase?.() || "";
  if (typeof value === "number") {
    if (normalizedKey.includes("time") || normalizedKey.includes("duration") || normalizedKey.includes("latency")) {
      const assumesMs = normalizedKey.endsWith("ms") || normalizedKey.includes("_ms");
      return formatDuration(value, assumesMs);
    }
    if (Math.abs(value) >= 1000) return value.toLocaleString();
    if (Number.isInteger(value)) return value.toString();
    const precision = Math.abs(value) < 1 ? 3 : 2;
    return value.toFixed(precision);
  }
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    const preview = value.slice(0, 3).map((v) => formatMetricValue(v, key, depth + 1)).join(", ");
    return value.length > 3 ? `[${preview}, … +${value.length - 3}]` : `[${preview}]`;
  }
  if (typeof value === "object") {
    if (depth >= 2) {
      return JSON.stringify(value);
    }
    return summarizeObject(value, depth);
  }
  return String(value);
}

const METRIC_PRIMARY_KEYS = [
  "total",
  "value",
  "score",
  "cost",
  "execution_time_s",
  "time_ms",
  "time",
  "duration",
  "avg",
  "average",
  "mean",
  "count",
];

function extractPrimaryMetric(obj) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null;
  for (const key of METRIC_PRIMARY_KEYS) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      return [key, obj[key]];
    }
  }
  const numericEntry = Object.entries(obj).find(([, value]) => typeof value === "number");
  if (numericEntry) return numericEntry;
  const firstEntry = Object.entries(obj)[0];
  return firstEntry || null;
}

function buildMetricCards(section = {}) {
  if (!section || typeof section !== "object") return [];
  return Object.entries(section).map(([key, value]) => {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return {
        key,
        label: prettifyLabel(key),
        headline: formatMetricValue(value, key),
        headlineLabel: null,
        details: [],
      };
    }
    const primary = extractPrimaryMetric(value);
    const details = Object.entries(value)
      .filter(([childKey]) => !primary || childKey !== primary[0])
      .map(([childKey, childValue]) => {
        const normalized = typeof childKey === "string" ? childKey.toLowerCase() : String(childKey).toLowerCase();
        let label = prettifyLabel(childKey);
        let valueText = formatMetricValue(childValue, childKey);
        if (normalized === "ok" || normalized === "success") {
          label = "Status";
          valueText = childValue ? "OK" : "Failed";
        }
        return {
          label,
          value: valueText,
          rawValue: childValue,
          isComplex: typeof childValue === "object" && childValue !== null,
        };
      });
    return {
      key,
      label: prettifyLabel(key),
      headline: primary ? formatMetricValue(primary[1], primary[0]) : null,
      headlineLabel: primary ? prettifyLabel(primary[0]) : null,
      details,
      rawValue: value,
    };
  });
}

function findMetricByKeywords(section, keywords = [], path = []) {
  if (!section || typeof section !== "object" || Array.isArray(section)) return null;
  for (const [key, value] of Object.entries(section)) {
    const normalized = typeof key === "string" ? key.toLowerCase() : String(key).toLowerCase();
    const nextPath = [...path, key];
    if (typeof value === "number" && keywords.some((kw) => normalized.includes(kw))) {
      return { key, value, path: nextPath };
    }
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const nested = findMetricByKeywords(value, keywords, nextPath);
      if (nested) return nested;
    }
  }
  return null;
}

function cellKey(cell) {
  if (!cell || cell.length < 2) return "";
  return `${cell[0]},${cell[1]}`;
}

function cellsEqual(a, b) {
  if (!a || !b) return false;
  return Number(a[0]) === Number(b[0]) && Number(a[1]) === Number(b[1]);
}

function averageDensity(range) {
  if (!range) return 0.08;
  const lo = Number(range.min ?? range[0] ?? 0.02);
  const hi = Number(range.max ?? range[1] ?? lo);
  return clampNumber((lo + hi) / 2, 0.02, 0.45);
}

function estimateWalkableCells(width, height, wallRange) {
  const avg = averageDensity(wallRange);
  const area = Math.max(1, Number(width) * Number(height));
  return Math.max(1, Math.floor(area * (1 - avg)));
}

function computeTaskCap(width, height, wallRange) {
  const walkable = estimateWalkableCells(width, height, wallRange);
  return Math.max(3, Math.min(width * height, Math.floor(walkable * 0.9)));
}

function computeMovingCap(width, height, wallRange) {
  const walkable = estimateWalkableCells(width, height, wallRange);
  return Math.max(10, Math.min(width * height, Math.floor(walkable / 60)));
}

function randomInt(min, max) {
  const lo = Math.ceil(min);
  const hi = Math.floor(max);
  return Math.floor(Math.random() * (hi - lo + 1)) + lo;
}

function buildRandomForkliftPath(grid, start, options = {}) {
  if (!Array.isArray(start) || start.length < 2) return [];
  const height = grid?.length || 0;
  const width = height ? grid[0].length : 0;
  if (!height || !width) return [];
  const minLen = Math.max(2, options.minLen ?? FORKLIFT_MIN_STEPS);
  const maxLen = Math.max(minLen, options.maxLen ?? FORKLIFT_MAX_STEPS);
  const targetLen = randomInt(minLen, maxLen);
  const path = [[start[0], start[1]]];
  let current = [start[0], start[1]];
  let prev = null;

  for (let step = 1; step < targetLen; step += 1) {
    const neighbors = [];
    const directions = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ];
    directions.forEach(([dr, dc]) => {
      const nr = current[0] + dr;
      const nc = current[1] + dc;
      if (nr < 0 || nc < 0 || nr >= height || nc >= width) return;
      if (grid[nr][nc] !== 0) return;
      neighbors.push([nr, nc]);
    });
    let candidates = neighbors;
    if (prev && candidates.length > 1) {
      const filtered = candidates.filter((cell) => !cellsEqual(cell, prev));
      if (filtered.length) {
        candidates = filtered;
      }
    }
    if (!candidates.length) break;
    const next = candidates[randomInt(0, candidates.length - 1)];
    path.push(next);
    prev = current;
    current = next;
  }
  return path;
}

function RangeInput({ label, value, min, max, onChange, step = 1, hint }) {
  const handleMinChange = (e) => {
    const next = Number(e.target.value);
    onChange({ min: next, max: Math.max(next, value.max) });
  };
  const handleMaxChange = (e) => {
    const next = Number(e.target.value);
    onChange({ max: next, min: Math.min(next, value.min) });
  };
  return (
    <div className="input-group">
      <label className="label">{label}</label>
      <input type="number" value={value.min} step={step} min={min} max={max} onChange={handleMinChange} />
      <span>-</span>
      <input type="number" value={value.max} step={step} min={min} max={max} onChange={handleMaxChange} />
      {hint && <span className="input-hint">{hint}</span>}
    </div>
  );
}

function CanvasGrid({
  grid,
  tasks,
  paths,
  robotsPositions,
  moving,
  simTime,
  forkliftPositions,
  taskAssignments,
  completedTasks,
  editMode,
  hoverCell,
  pendingRobotAdds,
  pendingRobotRemovals,
  pendingTaskAdds,
  pendingTaskRemovals,
  pendingWallAdds,
  pendingWallRemovals,
  pendingForkliftAdds,
  pendingForkliftRemovals,
  onHoverCell,
  robotColorMap,
}) {
  const canvasRef = useRef(null);
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

    for (let r = 0; r < grid.length; r += 1) {
      for (let c = 0; c < grid[0].length; c += 1) {
        if (grid[r][c] === 1) {
          ctx.fillStyle = "#24354e";
          ctx.fillRect(c * cell, r * cell, cell - 1, cell - 1);
        } else {
          ctx.fillStyle = "#f7fbff";
          ctx.fillRect(c * cell, r * cell, cell - 1, cell - 1);
          ctx.strokeStyle = "#e6f0fb";
          ctx.strokeRect(c * cell, r * cell, cell - 1, cell - 1);
        }
      }
    }

    if (paths) {
      Object.keys(paths).forEach((key, idx) => {
        const points = (paths[key] || []).filter((p) => Array.isArray(p) && p.length >= 2);
        if (points.length < 2) return;
        const colorKey = canonicalKey(key) || key;
        const strokeColor = robotColorMap?.[colorKey] || COLORS[idx % COLORS.length];
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(points[0][1] * cell + cell / 2, points[0][0] * cell + cell / 2);
        for (let i = 1; i < points.length; i += 1) {
          const p = points[i];
          ctx.lineTo(p[1] * cell + cell / 2, p[0] * cell + cell / 2);
        }
        ctx.stroke();
      });
    }

    const completedSet = new Set(completedTasks || []);
    if (tasks && tasks.length) {
      tasks.forEach((task, idx) => {
        if (!Array.isArray(task) || task.length < 2) return;
        const [r, c] = task;
        const key = `${r},${c}`;
        const assignment = taskAssignments?.[key];
        const isDone = completedSet.has(key);
        const strokeColor = isDone ? COMPLETED_COLOR : assignment ? assignment.color : "#ffcc00";
        const fillColor = lightenColor(strokeColor, isDone ? 0.15 : 0.35);
        ctx.beginPath();
        ctx.fillStyle = fillColor;
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = isDone ? 3 : 2;
        ctx.arc(c * cell + cell / 2, r * cell + cell / 2, cell / 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = isDone ? "#0b2140" : "#002b45";
        ctx.font = "bold 11px Inter";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        const label = isDone ? "✓" : assignment ? assignment.order : idx + 1;
        ctx.fillText(label, c * cell + cell / 2, r * cell + cell / 2);
      });
    }

    if (Array.isArray(forkliftPositions)) {
      forkliftPositions.forEach((pos) => {
        if (!Array.isArray(pos) || pos.length < 2) return;
        ctx.fillStyle = "#f5533e";
        ctx.fillRect(pos[1] * cell + 6, pos[0] * cell + 6, cell - 12, cell - 12);
      });
    }
    // Fallback: if no forkliftPositions yet but moving obstacles exist, draw their first cell.
    if ((!forkliftPositions || forkliftPositions.length === 0) && Array.isArray(moving)) {
      moving.forEach((ob) => {
        const first = ob?.path?.[0];
        if (!Array.isArray(first) || first.length < 2) return;
        ctx.fillStyle = "#f5533e";
        ctx.fillRect(first[1] * cell + 6, first[0] * cell + 6, cell - 12, cell - 12);
      });
    }

    if (robotsPositions) {
      robotsPositions.forEach((pos, idx) => {
        if (!Array.isArray(pos) || pos.length < 2) return;
        const color = COLORS[idx % COLORS.length];
        ctx.beginPath();
        ctx.fillStyle = color;
        ctx.arc(pos[1] * cell + cell / 2, pos[0] * cell + cell / 2, cell / 2 - 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = "#ffffff";
        ctx.stroke();
      });
    }
    if (editMode && hoverCell && grid?.length) {
      const [r, c] = hoverCell;
      if (r >= 0 && r < grid.length && c >= 0 && c < grid[0].length) {
        ctx.save();
        ctx.strokeStyle = "#0b69ff";
        ctx.lineWidth = 2;
        ctx.strokeRect(c * cell + 1.5, r * cell + 1.5, cell - 3, cell - 3);
        ctx.restore();
      }
    }

    (pendingRobotAdds || []).forEach((pos) => {
      if (!Array.isArray(pos) || pos.length < 2) return;
      ctx.save();
      ctx.strokeStyle = "#0b69ff";
      ctx.setLineDash([4, 3]);
      ctx.lineWidth = 2;
      ctx.strokeRect(pos[1] * cell + 4, pos[0] * cell + 4, cell - 8, cell - 8);
      ctx.strokeStyle = "#0b69ff";
      ctx.beginPath();
      ctx.moveTo(pos[1] * cell + cell / 2, pos[0] * cell + 6);
      ctx.lineTo(pos[1] * cell + cell / 2, pos[0] * cell + cell - 6);
      ctx.moveTo(pos[1] * cell + 6, pos[0] * cell + cell / 2);
      ctx.lineTo(pos[1] * cell + cell - 6, pos[0] * cell + cell / 2);
      ctx.stroke();
      ctx.restore();
    });

    (pendingRobotRemovals || []).forEach((pos) => {
      if (!Array.isArray(pos) || pos.length < 2) return;
      ctx.save();
      ctx.strokeStyle = "#f5533e";
      ctx.setLineDash([3, 3]);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(pos[1] * cell + 5, pos[0] * cell + 5);
      ctx.lineTo(pos[1] * cell + cell - 5, pos[0] * cell + cell - 5);
      ctx.moveTo(pos[1] * cell + cell - 5, pos[0] * cell + 5);
      ctx.lineTo(pos[1] * cell + 5, pos[0] * cell + cell - 5);
      ctx.stroke();
      ctx.restore();
    });

    // Pending task additions (dashed yellow circles)
    (pendingTaskAdds || []).forEach((task, idx) => {
      if (!Array.isArray(task) || task.length < 2) return;
      const [r, c] = task;
      ctx.save();
      ctx.setLineDash([4, 3]);
      ctx.lineWidth = 2;
      ctx.strokeStyle = "#ffcc00";
      ctx.fillStyle = "rgba(255,204,0,0.25)";
      ctx.beginPath();
      ctx.arc(c * cell + cell / 2, r * cell + cell / 2, cell / 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#664d00";
      ctx.font = "bold 11px Inter";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(`+${idx + 1}`, c * cell + cell / 2, r * cell + cell / 2);
      ctx.restore();
    });

    // Pending task removals (red X over existing task cell center)
    (pendingTaskRemovals || []).forEach((task) => {
      if (!Array.isArray(task) || task.length < 2) return;
      const [r, c] = task;
      ctx.save();
      ctx.strokeStyle = "#f5533e";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(c * cell + 6, r * cell + 6);
      ctx.lineTo(c * cell + cell - 6, r * cell + cell - 6);
      ctx.moveTo(c * cell + cell - 6, r * cell + 6);
      ctx.lineTo(c * cell + 6, r * cell + cell - 6);
      ctx.stroke();
      ctx.restore();
    });

    // Pending wall additions (dashed dark cell)
    (pendingWallAdds || []).forEach((cellPos) => {
      if (!Array.isArray(cellPos) || cellPos.length < 2) return;
      const [r, c] = cellPos;
      ctx.save();
      ctx.setLineDash([4, 3]);
      ctx.strokeStyle = "#24354e";
      ctx.lineWidth = 2;
      ctx.strokeRect(c * cell + 2, r * cell + 2, cell - 4, cell - 4);
      ctx.restore();
    });

    // Pending wall removals (red X over wall cell)
    (pendingWallRemovals || []).forEach((cellPos) => {
      if (!Array.isArray(cellPos) || cellPos.length < 2) return;
      const [r, c] = cellPos;
      ctx.save();
      ctx.strokeStyle = "#f5533e";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(c * cell + 4, r * cell + 4);
      ctx.lineTo(c * cell + cell - 4, r * cell + cell - 4);
      ctx.moveTo(c * cell + cell - 4, r * cell + 4);
      ctx.lineTo(c * cell + 4, r * cell + cell - 4);
      ctx.stroke();
      ctx.restore();
    });

    // Pending forklift additions (dashed path)
    (pendingForkliftAdds || []).forEach((ob, idx) => {
      const path = ob?.path || [];
      const pts = path.filter((p) => Array.isArray(p) && p.length === 2);
      if (pts.length < 2) return;
      ctx.save();
      ctx.setLineDash([6, 4]);
      ctx.strokeStyle = "#f5533e";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(pts[0][1] * cell + cell / 2, pts[0][0] * cell + cell / 2);
      for (let i = 1; i < pts.length; i += 1) {
        ctx.lineTo(pts[i][1] * cell + cell / 2, pts[i][0] * cell + cell / 2);
      }
      ctx.stroke();
      // Mark start
      ctx.fillStyle = "#f5533e";
      ctx.font = "bold 11px Inter";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(`F+${idx + 1}`, pts[0][1] * cell + cell / 2, pts[0][0] * cell + cell / 2);
      ctx.restore();
    });

    // Pending forklift removals (cross on first cell of existing obstacle index)
    (pendingForkliftRemovals || []).forEach((remIdx) => {
      if (!Array.isArray(moving)) return;
      const ob = moving[remIdx];
      const first = ob?.path?.[0];
      const start = Array.isArray(first) && first.length === 2 ? first : null;
      if (!start) return;
      const [r, c] = start;
      ctx.save();
      ctx.strokeStyle = "#ba1e00";
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(c * cell + 6, r * cell + 6);
      ctx.lineTo(c * cell + cell - 6, r * cell + cell - 6);
      ctx.moveTo(c * cell + cell - 6, r * cell + 6);
      ctx.lineTo(c * cell + 6, r * cell + cell - 6);
      ctx.stroke();
      ctx.restore();
    });
  }, [
    grid,
    tasks,
    paths,
    robotsPositions,
    moving,
    simTime,
    forkliftPositions,
    taskAssignments,
    completedTasks,
    editMode,
    hoverCell,
    pendingRobotAdds,
    pendingRobotRemovals,
    pendingTaskAdds,
    pendingTaskRemovals,
    pendingWallAdds,
    pendingWallRemovals,
    pendingForkliftAdds,
    pendingForkliftRemovals,
    robotColorMap,
  ]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !onHoverCell) return;

    const handleMove = (event) => {
      const rect = canvas.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const col = Math.floor(x / cell);
      const row = Math.floor(y / cell);
      if (!grid?.length || row < 0 || col < 0 || row >= grid.length || col >= grid[0].length) {
        onHoverCell(null);
        return;
      }
      onHoverCell([row, col]);
    };

    const handleLeave = () => {
      onHoverCell(null);
    };

    canvas.addEventListener("mousemove", handleMove);
    canvas.addEventListener("mouseleave", handleLeave);

    return () => {
      canvas.removeEventListener("mousemove", handleMove);
      canvas.removeEventListener("mouseleave", handleLeave);
    };
  }, [grid, onHoverCell]);

  return <canvas ref={canvasRef} className="grid-canvas" />;
}

function RobotDetailModal({ robotKey, robotData, onClose }) {
  const { path, currentStepIdx, log, tasks } = robotData;

  const safeFormatCell = (cell) => {
    if (Array.isArray(cell) && cell.length === 2) return formatCell(cell);
    if (typeof cell === "string") return cell;
    if (cell && typeof cell === "object" && Number.isFinite(cell.row) && Number.isFinite(cell.col)) {
      return formatCell([cell.row, cell.col]);
    }
    return "N/A";
  };

  const formatNumber = (value, digits = 2) =>
    typeof value === "number" && Number.isFinite(value) ? value.toFixed(digits) : value;

  const describeDelta = (prevStep, currStep) => {
    if (!prevStep) return "Start position";
    if (!currStep) return "N/A";
    const dr = currStep[0] - prevStep[0];
    const dc = currStep[1] - prevStep[1];
    if (dr === 0 && dc === 0) return "Hold";
    const parts = [];
    if (dr < 0) parts.push("North");
    if (dr > 0) parts.push("South");
    if (dc < 0) parts.push("West");
    if (dc > 0) parts.push("East");
    return `Move ${parts.join(" & ")}`;
  };

  const manhattanDelta = (prevStep, currStep) => {
    if (!prevStep || !currStep) return 0;
    return Math.abs(currStep[0] - prevStep[0]) + Math.abs(currStep[1] - prevStep[1]);
  };

  const statEntries = [
    { label: "Status", value: log?.status || "N/A" },
    { label: "Position", value: log?.position || "N/A" },
    { label: "Target", value: log?.target || "N/A" },
    { label: "Next Step", value: log?.nextStep || "N/A" },
    { label: "Current Step", value: currentStepIdx },
  ];

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-content robot-detail-modal" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="Close robot detail">
          &times;
        </button>
        <div className="robot-modal-header">
          <div>
            <p className="robot-modal-eyebrow">Robot Detail</p>
            <h2>{robotKey}</h2>
            {log?.position && <span className="robot-modal-subtext">Currently at {log.position}</span>}
          </div>
        </div>
        <div className="robot-modal-body">
          <section className="robot-modal-section">
            <div className="robot-stat-grid">
              {statEntries.map((entry) => (
                <div key={entry.label} className="robot-stat-card">
                  <span className="robot-stat-label">{entry.label}</span>
                  <span className="robot-stat-value">{entry.value}</span>
                </div>
              ))}
            </div>
          </section>
          {tasks && tasks.length > 0 && (
            <section className="robot-modal-section">
              <div className="robot-section-title">
                <h3>Assigned Tasks</h3>
                <span>{tasks.length} total</span>
              </div>
              <div className="task-detail-list">
                {tasks.map((task, idx) => {
                  const locLabel = safeFormatCell(task.task);
                  const metaBits = [];
                  if (task?.cost != null) metaBits.push(`Cost ${formatNumber(task.cost)}`);
                  if (task?.distance != null) metaBits.push(`Dist ${formatNumber(task.distance)}`);
                  if (task?.duration != null) metaBits.push(`ETA ${formatNumber(task.duration)}`);
                  if (task?.ready_time != null) metaBits.push(`Ready t=${formatNumber(task.ready_time, 1)}`);
                  if (task?.wait_time != null) metaBits.push(`Wait ${formatNumber(task.wait_time)}`);
                  const badge = task?.order ?? idx + 1;
                  const taskKey = `task-${badge}-${locLabel}-${idx}`;
                  return (
                    <div key={taskKey} className="task-detail-card">
                      <div className="task-detail-head">
                        <span className="task-detail-badge">#{badge}</span>
                        <span className="task-detail-coord">{locLabel}</span>
                      </div>
                      <div className="task-detail-meta">
                        {metaBits.length
                          ? metaBits.map((text, metaIdx) => (
                              <span key={`${taskKey}-meta-${metaIdx}`}>{text}</span>
                            ))
                          : <span>Queued &amp; ready</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}
          <section className="robot-modal-section">
            <div className="robot-section-title">
              <h3>Path Detail</h3>
              <span>{path.length} step{path.length === 1 ? "" : "s"}</span>
            </div>
            {path.length === 0 ? (
              <div className="label">No path generated for this robot yet.</div>
            ) : (
              <div className="path-detail-list">
                {path.map((step, idx) => {
                  const prevStep = idx > 0 ? path[idx - 1] : null;
                  const distance = manhattanDelta(prevStep, step);
                  const isCurrent = idx === currentStepIdx;
                  const coordLabel = safeFormatCell(step);
                  return (
                    <div
                      key={`path-${idx}-${coordLabel}`}
                      className={`path-detail-card${isCurrent ? " current" : ""}`}
                    >
                      <div className="path-detail-row">
                        <span className="path-detail-index">Step {idx}</span>
                        <span className="path-detail-coord">{coordLabel}</span>
                      </div>
                      <div className="path-detail-meta">
                        <span>{describeDelta(prevStep, step)}</span>
                        {distance > 0 && <span>{distance} tile{distance === 1 ? "" : "s"}</span>}
                        {distance === 0 && idx > 0 && <span>Hold</span>}
                        {isCurrent && <span className="path-detail-chip live">Current</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function MetricDetailModal({ data, onClose }) {
  if (!data) return null;
  const { title, card } = data;
  const details = card?.details || [];
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-content metric-detail-modal" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="Close metric detail">
          &times;
        </button>
        <div className="metric-modal-header">
          <p className="metric-modal-eyebrow">Performance Detail</p>
          <h2>{title}</h2>
          {card?.headline && (
            <div className="metric-modal-headline">
              <span className="metric-modal-value">{card.headline}</span>
              {card.headlineLabel && <span className="metric-modal-caption">{card.headlineLabel}</span>}
            </div>
          )}
        </div>
        <div className="metric-modal-body">
          {details.length === 0 ? (
            <div className="label">No additional data provided.</div>
          ) : (
            <div className="metric-detail-grid">
              {details.map((detail, idx) => (
                <div key={`${card?.key || "metric"}-detail-${idx}`} className="metric-detail-row">
                  <div className="metric-detail-label">{detail.label}</div>
                  <div className="metric-detail-value">{detail.value}</div>
                  {detail.isComplex && detail.rawValue ? (
                    <pre className="metric-detail-json">{JSON.stringify(detail.rawValue, null, 2)}</pre>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

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

  const [manualEdits, setManualEdits] = useState(() => createEmptyManualEdits());

  const [showSettings, setShowSettings] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [hoverCell, setHoverCell] = useState(null);

  const rafRef = useRef(null);
  const timeRef = useRef([]);
  const globalTimeRef = useRef(0);
  const hasGeneratedRef = useRef(false);
  // New refs for rewritten animation system
  const robotPathsRef = useRef([]); // Array< Array<[r,c]> > per robot index
  const robotAssignmentsRef = useRef([]); // Array< Array<[r,c]> > per robot index
  const forkliftPathsRef = useRef([]); // Array< Array<[r,c]> > per forklift index
  const forkliftLoopFlagsRef = useRef([]); // Array<boolean>
  const robotTaskIndicesRef = useRef([]); // Keeps latest robotTaskIndices to avoid stale closure
  const robotTaskPathIndicesRef = useRef([]); // Array< Array<number> > path step index for each assignment per robot

  const pendingRobotAdds = manualEdits.robots?.add || [];
  const pendingRobotRemovals = manualEdits.robots?.remove || [];
  const pendingTaskAdds = manualEdits.tasks?.add || [];
  const pendingTaskRemovals = manualEdits.tasks?.remove || [];
  const pendingWallAdds = manualEdits.walls?.add || [];
  const pendingWallRemovals = manualEdits.walls?.remove || [];
  const pendingForkliftAdds = manualEdits.forklifts?.add || [];
  const pendingForkliftRemovals = manualEdits.forklifts?.remove || [];

  const robotCellSet = useMemo(
    () => new Set((robots || []).map((cell) => JSON.stringify([cell[0], cell[1]]))),
    [robots]
  );

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

  const pendingAddSet = useMemo(
    () => new Set((pendingRobotAdds || []).map((cell) => JSON.stringify([cell[0], cell[1]]))),
    [pendingRobotAdds]
  );

  const pendingRemoveSet = useMemo(
    () => new Set((pendingRobotRemovals || []).map((cell) => JSON.stringify([cell[0], cell[1]]))),
    [pendingRobotRemovals]
  );

  const taskCellSet = useMemo(
    () => new Set((tasks || []).map((cell) => `${cell[0]},${cell[1]}`)),
    [tasks]
  );

  const pendingTaskAddSet = useMemo(
    () => new Set((pendingTaskAdds || []).map((cell) => `${cell[0]},${cell[1]}`)),
    [pendingTaskAdds]
  );

  const pendingTaskRemoveSet = useMemo(
    () => new Set((pendingTaskRemovals || []).map((cell) => `${cell[0]},${cell[1]}`)),
    [pendingTaskRemovals]
  );

  const pendingWallAddSet = useMemo(
    () => new Set((pendingWallAdds || []).map((cell) => `${cell[0]},${cell[1]}`)),
    [pendingWallAdds]
  );

  const pendingWallRemoveSet = useMemo(
    () => new Set((pendingWallRemovals || []).map((cell) => `${cell[0]},${cell[1]}`)),
    [pendingWallRemovals]
  );

  const pendingForkliftAddKeys = useMemo(
    () =>
      new Set(
        (pendingForkliftAdds || []).map((item) => pathSignature(item?.path || []))
      ),
    [pendingForkliftAdds]
  );

  const robotCount = robots.length;

  const projectedRobotCount = useMemo(() => {
    let count = robotCellSet.size;
    (pendingRobotAdds || []).forEach((cell) => {
      const key = canonicalKey(cell);
      if (key && !robotCellSet.has(key)) count += 1;
    });
    (pendingRobotRemovals || []).forEach((cell) => {
      const key = canonicalKey(cell);
      if (key && robotCellSet.has(key)) count -= 1;
    });
    return count;
  }, [robotCellSet, pendingRobotAdds, pendingRobotRemovals]);

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

  const hasPendingChanges = useMemo(() => {
    if (!manualEdits) return false;
    const categories = [
      manualEdits.robots?.add?.length,
      manualEdits.robots?.remove?.length,
      manualEdits.tasks?.add?.length,
      manualEdits.tasks?.remove?.length,
      manualEdits.walls?.add?.length,
      manualEdits.walls?.remove?.length,
      manualEdits.forklifts?.add?.length,
      manualEdits.forklifts?.remove?.length,
    ];
    return categories.some((count) => (count || 0) > 0);
  }, [manualEdits]);

  const pendingTotals = useMemo(
    () => ({
      robots: (pendingRobotAdds?.length || 0) + (pendingRobotRemovals?.length || 0),
      tasks: (pendingTaskAdds?.length || 0) + (pendingTaskRemovals?.length || 0),
      walls: (pendingWallAdds?.length || 0) + (pendingWallRemovals?.length || 0),
      forklifts: (pendingForkliftAdds?.length || 0) + (pendingForkliftRemovals?.length || 0),
    }),
    [
      pendingRobotAdds,
      pendingRobotRemovals,
      pendingTaskAdds,
      pendingTaskRemovals,
      pendingWallAdds,
      pendingWallRemovals,
      pendingForkliftAdds,
      pendingForkliftRemovals,
    ]
  );

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
      const res = await axios.post(`${BACKEND}/generate_map`, {
        width: clampSize(mapWidth, 8, 60),
        height: clampSize(mapHeight, 8, 60),
        seed: seed || undefined,
        wall_density_range: wallRange,
        task_count_range: taskRange,
        moving_count_range: movingRange,
        robot_count_range: robotRange,
      });
      const nextGrid = res.data.grid || [];
      const nextTasks = res.data.tasks || [];
      const nextRobots = res.data.robots || [];
      const nextMoving = res.data.moving || [];
      const meta = res.data.meta || null;

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
  setManualEdits(createEmptyManualEdits());
      completedTasksRef.current = new Set();
      setCompletedTasks(new Set());
      setVisibleTasks(nextTasks);
      timeRef.current = new Array(nextRobots.length).fill(0);
      globalTimeRef.current = 0;
      setGlobalSimTime(0);
      setForkliftPositions(nextMoving.map((ob) => (ob?.path && ob.path.length ? ob.path[0] : null)));
      setStatus("ready");
    } catch (err) {
      console.error("generateMap failed", err);
      setStatus("error");
    }
  }, [clampSize, mapWidth, mapHeight, seed, wallRange, taskRange, movingRange, robotRange]);

  useEffect(() => {
    if (hasGeneratedRef.current) {
      return;
    }
    hasGeneratedRef.current = true;
    generateMap();
  }, [generateMap]);

  async function planTasks() {
    setStatus("planning");
    try {
      const payload = {
        grid,
        robots,
        tasks,
        optimizer,
        path_alg: selectedAlg === "astar" ? "astar" : "dijkstra",
      };
      const res = await axios.post(`${BACKEND}/plan_tasks`, payload);
      const data = res.data || {};
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
  }

  async function computePathsAndSchedule() {
    stopAnimation();
    setStatus("computing paths");
    try {
      const assignment = await planTasks();
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

      const res = await axios.post(`${BACKEND}/compute_paths`, {
        grid,
        robot_plans: robotPlans,
        alg: selectedAlg === "astar" ? "astar" : "dijkstra",
        moving,
      });
      const data = res.data || {};
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
  }

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
        const res = await axios.post(`${BACKEND}/replan`, {
          grid,
          start,
          tasks_remaining: pendingTasks,
          moving,
          current_time: Math.floor(currentTime),
        });
        if (res.data.ok && res.data.path) {
          const newPath = res.data.path;
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

  const stopAnimation = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    setSimPlaying(false);
    if (paths && Object.keys(paths).length > 0) {
      setStatus("scheduled");
    } else {
      setStatus("idle");
    }
  }, [paths]);

  const startAnimation = useCallback(
    (pathsObj) => {
      // Avoid restarting if already playing with same paths
      if (!pathsObj || !Object.keys(pathsObj).length || robots.length === 0) {
        stopAnimation();
        return;
      }

      // Preprocess robot paths mapped by robot index for efficiency
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

      // Preprocess assignments per robot index for task completion detection
      const perRobotAssignments = new Array(robots.length).fill(null).map(() => []);
      const perRobotTaskPathIndices = new Array(robots.length).fill(null).map(() => []);
      robots.forEach((robot, idx) => {
        const k = canonicalKey(robot) || JSON.stringify(robot);
        const assigned = (robotTaskAssignments[k] || [])
          .map((cell) => parseCell(cell))
          .filter((c) => Array.isArray(c) && c.length === 2);
        perRobotAssignments[idx] = assigned;
        // Build lookup map of path step indices for this robot
        const pathSteps = perRobotPaths[idx] || [];
        const indexMap = new Map();
        pathSteps.forEach((step, stepIdx) => {
          if (Array.isArray(step) && step.length === 2) {
            const key = `${step[0]},${step[1]}`;
            if (!indexMap.has(key)) indexMap.set(key, stepIdx); // first occurrence
          }
        });
        perRobotTaskPathIndices[idx] = assigned.map((t) => indexMap.get(`${t[0]},${t[1]}`));
      });
      robotAssignmentsRef.current = perRobotAssignments;
      robotTaskPathIndicesRef.current = perRobotTaskPathIndices;

      // Forklift preprocessing
      forkliftPathsRef.current = moving.map((ob) =>
        (ob?.path || [])
          .map((step) => parseCell(step))
          .filter(
            (p) => Array.isArray(p) && p.length === 2 && Number.isFinite(p[0]) && Number.isFinite(p[1])
          )
          .map((p) => [Number(p[0]), Number(p[1])])
      );
      forkliftLoopFlagsRef.current = moving.map((ob) => ob?.loop !== false);

      // Reset timing and bookkeeping to ensure consistent playback
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
      setVisibleTasks(tasks); // restore all tasks visually at replay start
      setSimPlaying(true);
      setStatus("running");

      let lastTs = performance.now();

      const frame = (now) => {
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

        perRobotPaths.forEach((pathSteps, idx) => {
          if (!pathSteps || pathSteps.length === 0) return;
          const currentT = timeRef.current[idx] || 0;
          // Advance time proportionally (1 unit per step) — could refine with per-step cost later
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

          // Robust task completion detection: mark all assignment tasks whose path index has been reached.
          const assignments = perRobotAssignments[idx];
          const assignmentPathIndices = robotTaskPathIndicesRef.current[idx] || [];
          let currentTaskIdx = newTaskIndices[idx] || 0;
          while (
            currentTaskIdx < assignments.length &&
            Number.isFinite(assignmentPathIndices[currentTaskIdx]) &&
            nextT >= assignmentPathIndices[currentTaskIdx]
          ) {
            const goal = assignments[currentTaskIdx];
            completed.add(`${goal[0]},${goal[1]}`);
            currentTaskIdx += 1;
          }
          newTaskIndices[idx] = currentTaskIdx;
          const canonicalRobotKey = canonicalKey(robots[idx]) || JSON.stringify(robots[idx]);
          const status = isReplanning[idx]
            ? "Replanning..."
            : newTaskIndices[idx] >= assignments.length
            ? "Completed"
            : "En route";
          const upcomingStep = pathSteps[Math.min(pathSteps.length - 1, baseIdx + 1)];
          const color = robotColorMap[canonicalRobotKey] || COLORS[idx % COLORS.length];
          logs[canonicalRobotKey] = {
            status,
            position: formatCell(interp.map((v) => Number(v.toFixed(1)))),
            target: assignments[newTaskIndices[idx]] ? formatCell(assignments[newTaskIndices[idx]]) : "N/A",
            nextStep: upcomingStep ? formatCell(upcomingStep) : "N/A",
            color,
          };
        });

        // Forklift animation
        const forkliftPos = forkliftPathsRef.current.map((pathSteps, fIdx) => {
          if (!pathSteps || pathSteps.length === 0) return null;
          if (pathSteps.length === 1) return pathSteps[0];
          const loop = forkliftLoopFlagsRef.current[fIdx];
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

        const allDone = perRobotPaths.every((p, idx) => !p.length || newTimes[idx] >= p.length - 1);
        if (allDone) {
          stopAnimation();
          return;
        }
        rafRef.current = requestAnimationFrame(frame);
      };

      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      rafRef.current = requestAnimationFrame(frame);
    },
    [robots, moving, robotTaskAssignments, robotTaskIndices, speed, isReplanning, robotColorMap, stopAnimation]
  );

  const handleRobotShortcut = useCallback(() => {
    if (!isEditMode || !hoverCell || !grid?.length) return;
    const [row, col] = hoverCell;
    if (row < 0 || col < 0 || row >= grid.length || col >= grid[0].length) return;
    const key = canonicalKey(hoverCell);
    if (!key) return;

    if (pendingAddSet.has(key)) {
      setManualEdits((prev) => {
        const bucket = prev.robots || { add: [], remove: [] };
        const nextAdds = (bucket.add || []).filter((cell) => !cellsEqual(cell, hoverCell));
        return { ...prev, robots: { add: nextAdds, remove: bucket.remove || [] } };
      });
      return;
    }

    if (pendingRemoveSet.has(key)) {
      setManualEdits((prev) => {
        const bucket = prev.robots || { add: [], remove: [] };
        const nextRemoves = (bucket.remove || []).filter((cell) => !cellsEqual(cell, hoverCell));
        return { ...prev, robots: { add: bucket.add || [], remove: nextRemoves } };
      });
      return;
    }

    if (robotCellSet.has(key)) {
      setManualEdits((prev) => {
        const bucket = prev.robots || { add: [], remove: [] };
        const nextRemoves = [...(bucket.remove || [])];
        if (nextRemoves.some((cell) => cellsEqual(cell, hoverCell))) {
          return prev;
        }
        nextRemoves.push([row, col]);
        return { ...prev, robots: { add: bucket.add || [], remove: nextRemoves } };
      });
      return;
    }

    if (projectedRobotCount >= MAX_ROBOTS) {
      alert(`Maximum ${MAX_ROBOTS} robots allowed`);
      return;
    }

    setManualEdits((prev) => {
      const bucket = prev.robots || { add: [], remove: [] };
      const existingAdds = bucket.add || [];
      if (existingAdds.some((cell) => cellsEqual(cell, hoverCell))) {
        return prev;
      }
      const cleansedRemoves = (bucket.remove || []).filter((cell) => !cellsEqual(cell, hoverCell));
      return {
        ...prev,
        robots: {
          add: [...existingAdds, [row, col]],
          remove: cleansedRemoves,
        },
      };
    });
  }, [
    grid,
    hoverCell,
    isEditMode,
    pendingAddSet,
    pendingRemoveSet,
    projectedRobotCount,
    robotCellSet,
  ]);

  const handleTaskShortcut = useCallback(() => {
    if (!isEditMode || !hoverCell || !grid?.length) return;
    const [row, col] = hoverCell;
    if (row < 0 || col < 0 || row >= grid.length || col >= grid[0].length) return;
    const key = cellKey(hoverCell);

    if (pendingTaskAddSet.has(key)) {
      setManualEdits((prev) => {
        const bucket = prev.tasks || { add: [], remove: [] };
        const nextAdds = (bucket.add || []).filter((cell) => !cellsEqual(cell, hoverCell));
        return { ...prev, tasks: { add: nextAdds, remove: bucket.remove || [] } };
      });
      return;
    }

    if (pendingTaskRemoveSet.has(key)) {
      setManualEdits((prev) => {
        const bucket = prev.tasks || { add: [], remove: [] };
        const nextRemoves = (bucket.remove || []).filter((cell) => !cellsEqual(cell, hoverCell));
        return { ...prev, tasks: { add: bucket.add || [], remove: nextRemoves } };
      });
      return;
    }

    if (taskCellSet.has(key)) {
      setManualEdits((prev) => {
        const bucket = prev.tasks || { add: [], remove: [] };
        if ((bucket.remove || []).some((cell) => cellsEqual(cell, hoverCell))) {
          return prev;
        }
        return {
          ...prev,
          tasks: {
            add: bucket.add || [],
            remove: [...(bucket.remove || []), [row, col]],
          },
        };
      });
      return;
    }

    if (grid[row][col] === 1) {
      alert("Cannot place a task on a wall cell.");
      return;
    }

    setManualEdits((prev) => {
      const bucket = prev.tasks || { add: [], remove: [] };
      if ((bucket.add || []).some((cell) => cellsEqual(cell, hoverCell))) {
        return prev;
      }
      const cleansedRemoves = (bucket.remove || []).filter((cell) => !cellsEqual(cell, hoverCell));
      return {
        ...prev,
        tasks: {
          add: [...(bucket.add || []), [row, col]],
          remove: cleansedRemoves,
        },
      };
    });
  }, [grid, hoverCell, isEditMode, pendingTaskAddSet, pendingTaskRemoveSet, taskCellSet]);

  const handleWallShortcut = useCallback(() => {
    if (!isEditMode || !hoverCell || !grid?.length) return;
    const [row, col] = hoverCell;
    if (row < 0 || col < 0 || row >= grid.length || col >= grid[0].length) return;
    const key = cellKey(hoverCell);

    if (pendingWallAddSet.has(key)) {
      setManualEdits((prev) => {
        const bucket = prev.walls || { add: [], remove: [] };
        const nextAdds = (bucket.add || []).filter((cell) => !cellsEqual(cell, hoverCell));
        return { ...prev, walls: { add: nextAdds, remove: bucket.remove || [] } };
      });
      return;
    }

    if (pendingWallRemoveSet.has(key)) {
      setManualEdits((prev) => {
        const bucket = prev.walls || { add: [], remove: [] };
        const nextRemoves = (bucket.remove || []).filter((cell) => !cellsEqual(cell, hoverCell));
        return { ...prev, walls: { add: bucket.add || [], remove: nextRemoves } };
      });
      return;
    }

    if (grid[row][col] === 1) {
      setManualEdits((prev) => {
        const bucket = prev.walls || { add: [], remove: [] };
        if ((bucket.remove || []).some((cell) => cellsEqual(cell, hoverCell))) {
          return prev;
        }
        return {
          ...prev,
          walls: {
            add: bucket.add || [],
            remove: [...(bucket.remove || []), [row, col]],
          },
        };
      });
      return;
    }

    setManualEdits((prev) => {
      const bucket = prev.walls || { add: [], remove: [] };
      if ((bucket.add || []).some((cell) => cellsEqual(cell, hoverCell))) {
        return prev;
      }
      const cleansedRemoves = (bucket.remove || []).filter((cell) => !cellsEqual(cell, hoverCell));
      return {
        ...prev,
        walls: {
          add: [...(bucket.add || []), [row, col]],
          remove: cleansedRemoves,
        },
      };
    });
  }, [grid, hoverCell, isEditMode, pendingWallAddSet, pendingWallRemoveSet]);

  const handleForkliftShortcut = useCallback(() => {
    if (!isEditMode || !hoverCell || !grid?.length) return;
    const [row, col] = hoverCell;
    if (row < 0 || col < 0 || row >= grid.length || col >= grid[0].length) return;

    const existingIdx = moving.findIndex((ob) =>
      (ob?.path || [])
        .map((step) => parseCell(step))
        .filter(Boolean)
        .some((cell) => cellsEqual(cell, hoverCell))
    );

    if (existingIdx !== -1) {
      setManualEdits((prev) => {
        const bucket = prev.forklifts || { add: [], remove: [] };
        const removalList = new Set(bucket.remove || []);
        let nextRemoves;
        if (removalList.has(existingIdx)) {
          nextRemoves = (bucket.remove || []).filter((idx) => idx !== existingIdx);
        } else {
          nextRemoves = [...(bucket.remove || []), existingIdx];
        }
        return {
          ...prev,
          forklifts: {
            add: bucket.add || [],
            remove: nextRemoves,
          },
        };
      });
      return;
    }

    if (grid[row][col] === 1) {
      alert("Cannot place a forklift path on a wall cell.");
      return;
    }

    const randomPath = buildRandomForkliftPath(grid, [row, col]);
    if (!randomPath || randomPath.length < 2) {
      alert("Could not build a random forklift path at that cell.");
      return;
    }

    const signature = pathSignature(randomPath);
    if (pendingForkliftAddKeys.has(signature)) {
      setManualEdits((prev) => {
        const bucket = prev.forklifts || { add: [], remove: [] };
        const nextAdds = (bucket.add || []).filter((item) => pathSignature(item?.path || []) !== signature);
        return {
          ...prev,
          forklifts: {
            add: nextAdds,
            remove: bucket.remove || [],
          },
        };
      });
      return;
    }

    setManualEdits((prev) => {
      const bucket = prev.forklifts || { add: [], remove: [] };
      return {
        ...prev,
        forklifts: {
          add: [...(bucket.add || []), { path: randomPath, loop: false }],
          remove: bucket.remove || [],
        },
      };
    });
  }, [grid, hoverCell, isEditMode, moving, pendingForkliftAddKeys]);

  useEffect(() => () => rafRef.current && cancelAnimationFrame(rafRef.current), []);

  useEffect(() => {
    // Only stop animation when paths cleared or no robots; do not auto-restart to avoid reset loop.
    if (!paths || Object.keys(paths).length === 0 || robotCount === 0) {
      stopAnimation();
    }
  }, [paths, robotCount, stopAnimation]);

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

  const prevEditModeRef = useRef(isEditMode);
  useEffect(() => {
    if (prevEditModeRef.current && !isEditMode && hasPendingChanges) {
      applyManualChanges().catch((err) => console.error("Auto apply manual edits failed", err));
    }
    prevEditModeRef.current = isEditMode;
  }, [isEditMode, hasPendingChanges]);

  const applyManualChanges = async () => {
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
      const res = await axios.post(`${BACKEND}/manual/apply`, payload);
      if (!res.data.ok) {
        alert("Manual edit failed");
        return;
      }
      setGrid(res.data.grid || grid);
      setRobots(res.data.robots || robots);
      setTasks(res.data.tasks || tasks);
      setVisibleTasks(res.data.tasks || tasks);
      setMoving(res.data.moving || moving);
      // Initialize forkliftPositions from updated moving obstacle paths.
      const updatedMoving = res.data.moving || moving || [];
      setForkliftPositions(updatedMoving.map((ob) => (ob?.path && ob.path.length ? ob.path[0] : null)));
      setManualEdits(createEmptyManualEdits());
      // Clear any existing schedule/path data; user can manually trigger planning later.
      setPaths({});
      setRobotSummaries([]);
      setTaskAssignments({});
      setRobotTaskAssignments({});
      setRobotTaskIndices(new Array((res.data.robots || robots).length).fill(0));
      setIsReplanning(new Array((res.data.robots || robots).length).fill(false));
      setRobotSimTimes(new Array((res.data.robots || robots).length).fill(0));
      setRobotPositions((res.data.robots || robots).map((r) => [r[0], r[1]]));
      setRobotLogs({});
      setStepMetadata({});
      completedTasksRef.current = new Set();
      setCompletedTasks(new Set());
      setStatus("edits applied");
    } catch (err) {
      console.error("manual apply failed", err);
      setStatus("error");
    }
  };

  // Keep forkliftPositions synced with moving when not animating.
  useEffect(() => {
    if (!simPlaying) {
      setForkliftPositions((moving || []).map((ob) => (ob?.path && ob.path.length ? ob.path[0] : null)));
    }
  }, [moving, simPlaying]);

  return (
    <div className="app">
      <div className="left">
        <div className="header">
          <button className="btn" onClick={() => setShowSettings(true)}>
            Map Settings
          </button>
          <button className="small" onClick={generateMap}>
            Regenerate
          </button>
          <button className="small" onClick={planTasks}>
            Plan Tasks
          </button>
          <button className="small" onClick={computePathsAndSchedule}>
            Compute Paths
          </button>
          <div className="control-group">
            <label className="label">Optimizer</label>
            <select value={optimizer} onChange={(e) => setOptimizer(e.target.value)}>
              <option value="greedy">Greedy</option>
              <option value="ga">Genetic Algorithm</option>
              <option value="local">Local Search</option>
            </select>
          </div>
          <div className="control-group">
            <label className="label">Path</label>
            <select value={selectedAlg} onChange={(e) => setSelectedAlg(e.target.value)}>
              <option value="astar">A*</option>
              <option value="dijkstra">Dijkstra</option>
            </select>
          </div>
          <div className="speed">
            <label className="label">Speed</label>
            <input
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
          <button
            className="small"
            style={{ borderColor: isEditMode ? "#0b69ff" : undefined, color: isEditMode ? "#0b69ff" : undefined }}
            onClick={() => setIsEditMode((prev) => !prev)}
          >
            {isEditMode ? "Exit Edit Mode (E)" : "Edit Mode (E)"}
          </button>
          <div className="label" style={{ marginLeft: "auto" }}>
            Status: <strong>{status}</strong>
          </div>
        </div>
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

        <div className="stat">
          <div className="label">Legend</div>
          <div className="legend">
            {robots.map((_, idx) => (
              <div key={idx} className="legend-item">
                <span className="dot" style={{ background: COLORS[idx % COLORS.length] }} />
                Robot {idx + 1}
              </div>
            ))}
            <div className="legend-item">
              <span className="dot" style={{ background: "#ffcc00" }} /> Task
            </div>
            <div className="legend-item">
              <span className="dot" style={{ background: COMPLETED_COLOR }} /> Completed Task
            </div>
            <div className="legend-item">
              <span className="dot" style={{ background: "#f5533e" }} /> Forklift
            </div>
          </div>
        </div>

        <div className="stat">
          <div className="label">Edit Mode</div>
          <div className="value" style={{ color: isEditMode ? "#0b69ff" : "#65739a" }}>
            {isEditMode ? "Active" : "Inactive"}
          </div>
          <div className="label">
            Toggle with <strong>E</strong>. While active use <strong>R</strong> for robots, <strong>T</strong> for tasks,
            <strong>W</strong> for walls, <strong>F</strong> for forklifts; tap the key again on the same cell to undo.
          </div>
          <div className="label">Edits auto-save when you exit edit mode.</div>
          {isEditMode && (pendingTotals.robots || pendingTotals.tasks || pendingTotals.walls || pendingTotals.forklifts) ? (
            <div className="label">
              Pending — R:{pendingTotals.robots} T:{pendingTotals.tasks} W:{pendingTotals.walls} F:{pendingTotals.forklifts}
            </div>
          ) : null}
        </div>

        <div className="stat">
          <div className="label">Optimizer</div>
          <div className="value">{optimizer.toUpperCase()}</div>
          <div className="label">Path Algorithm</div>
          <div className="value">{selectedAlg.toUpperCase()}</div>
        </div>

        <h3>Robots & Tasks</h3>
        {robotSummaries.map((robot) => {
          const robotKey = canonicalKey(robot.start) || JSON.stringify(robot.start);
          const log = robotLogs[robotKey];
          const baseColor = robot.color;
          const labelColor = lightenColor(baseColor, 0.55);
          return (
            <div
              key={robot.id}
              className="stat"
              style={{
                borderLeft: `4px solid ${baseColor}`,
                cursor: "pointer",
              }}
              onClick={() => setSelectedRobotKey(robotKey)}
            >
              <div className="value" style={{ color: baseColor }}>
                Robot {robot.id + 1} @ {formatCell(robot.start)}
              </div>
              {log && (
                <div style={{ marginBottom: "6px" }}>
                  <div className="robot-log-item">
                    <span className="label" >Status</span>
                    <span className="value" style={{fontSize: "12px" }}>{log.status}</span>
                  </div>
                  <div className="robot-log-item">
                    <span className="label" >Position</span>
                    <span className="value" style={{fontSize: "12px" }}>{log.position}</span>
                  </div>
                  <div className="robot-log-item">
                    <span className="label" >Target</span>
                    <span className="value" style={{fontSize: "12px" }}>{log.target}</span>
                  </div>
                </div>
              )}
              <div className="label" style={{ fontSize: "12px" }}>
                Cost: {robot.total_cost?.toFixed?.(2) ?? robot.total_cost} | Tasks: {robot.assignments?.length || 0}
              </div>
              {robot.assignments?.length > 0 && (
                <div className="label" style={{ fontSize: "11px", marginTop: "4px", lineHeight: "1.4" }}>
                  {robot.assignments.map((task) => `#${task.order}: ${formatCell(task.task)};`).join(" ")}
                </div>
              )}
              {robot.assignments?.length === 0 && <div className="label">No tasks assigned</div>}
            </div>
          );
        })}
        {robotSummaries.length === 0 && <div className="label">Run planning to view assignments.</div>}

        <h3>Metrics</h3>
        {showPerformancePanel && (
          <div className="stat performance-panel">
            <div className="label">Performance</div>
            {hasTimingCard && (
              <div className="timing-card">
                <div className="timing-card-header">
                  <div className="timing-card-eyebrow">Latest run</div>
                  <div className="timing-card-title">Planning · Paths · Scheduling</div>
                </div>
                <div className="timing-rows">
                  {timingEntries.map((entry) => (
                    <div key={entry.key} className="timing-row">
                      <div className="timing-label">{entry.label}</div>
                      <div className="timing-value">
                        {Number.isFinite(entry.value)
                          ? formatMetricValue(entry.value, entry.valueKey)
                          : "—"}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {executionRows.length > 0 && (
              <div className="execution-rows">
                <div className="label">Execution</div>
                {executionRows.map((row) => {
                  const detailCount = row.details?.length || 0;
                  const inlineDetails = row.details?.slice(0, EXECUTION_DETAIL_INLINE_LIMIT) || [];
                  const needsMoreButton = detailCount > EXECUTION_DETAIL_INLINE_LIMIT;
                  const needsInspectButton =
                    detailCount > 0 &&
                    detailCount <= EXECUTION_DETAIL_INLINE_LIMIT &&
                    row.details.some((detail) => detail.isComplex);
                  return (
                    <div key={`exec-row-${row.key}`} className="execution-row">
                      <div className="execution-row-header">
                        <div>
                          <div className="execution-row-title">{row.title}</div>
                          {row.sourceLabel && row.sourceLabel !== row.title && (
                            <div className="execution-row-subtitle">{row.sourceLabel}</div>
                          )}
                        </div>
                        {row.headline && (
                          <div className="execution-row-headline">
                            <span className="execution-row-value">{row.headline}</span>
                            {row.headlineLabel && (
                              <span className="execution-row-caption">{row.headlineLabel}</span>
                            )}
                          </div>
                        )}
                      </div>
                      {inlineDetails.length > 0 && (
                        <div className="execution-row-details">
                          {inlineDetails.map((detail, detailIdx) => (
                            <span key={`${row.key}-detail-${detailIdx}`} className="metrics-tag">
                              <strong>{detail.label}:</strong> {detail.value}
                            </span>
                          ))}
                        </div>
                      )}
                      {needsMoreButton && (
                        <button
                          type="button"
                          className="metrics-card-button"
                          onClick={() => setMetricDetail({ title: `Execution · ${row.title}`, card: row.card })}
                        >
                          View details
                        </button>
                      )}
                      {!needsMoreButton && needsInspectButton && (
                        <button
                          type="button"
                          className="metrics-card-button subtle"
                          onClick={() => setMetricDetail({ title: `Execution · ${row.title}`, card: row.card })}
                        >
                          Inspect
                        </button>
                      )}
                      {!row.headline && detailCount === 0 && (
                        <div className="execution-row-empty">No data</div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
        {!showPerformancePanel && <div className="label">Run planning to view metrics.</div>}
      </div>

      {showSettings && (
        <div className="modal-backdrop" onClick={() => setShowSettings(false)}>
          <div className="modal-content map-settings" onClick={(e) => e.stopPropagation()}>
            <h2>Map Settings</h2>
            <p className="modal-hint">Adjust the generator before creating a new layout.</p>
            <div className="settings-grid">
              <div className="input-group">
                <label className="label">Width</label>
                <input
                  type="number"
                  value={mapWidth}
                  min={8}
                  max={MAX_WIDTH}
                  onChange={(e) => setMapWidth(clampSize(e.target.value, 8, MAX_WIDTH))}
                />
              </div>
              <div className="input-group">
                <label className="label">Height</label>
                <input
                  type="number"
                  value={mapHeight}
                  min={8}
                  max={MAX_HEIGHT}
                  onChange={(e) => setMapHeight(clampSize(e.target.value, 8, MAX_HEIGHT))}
                />
              </div>
              <div className="input-group">
                <label className="label">Seed</label>
                <input
                  type="text"
                  value={seed}
                  placeholder="Optional"
                  onChange={(e) => setSeed(e.target.value)}
                />
              </div>
            </div>

            <div className="settings-section">
              <h3>Counts</h3>
              <RangeInput
                label="Robots"
                value={robotRange}
                min={1}
                max={MAX_ROBOTS}
                onChange={(next) => {
                  const min = Math.min(MAX_ROBOTS, Math.max(1, Number(next.min)));
                  const max = Math.min(MAX_ROBOTS, Math.max(min, Number(next.max)));
                  setRobotRange({ min, max });
                }}
              />
              <RangeInput
                label="Tasks"
                value={taskRange}
                min={3}
                max={dynamicTaskMax}
                hint={taskRangeHint}
                onChange={(next) => {
                  const min = Math.max(3, Math.min(Number(next.min), dynamicTaskMax));
                  const max = Math.max(min, Math.min(Number(next.max), dynamicTaskMax));
                  setTaskRange({ min, max });
                }}
              />
              <RangeInput
                label="Moving Obstacles"
                value={movingRange}
                min={0}
                max={dynamicMovingMax}
                hint={movingRangeHint}
                onChange={(next) => {
                  const min = Math.max(0, Math.min(Number(next.min), dynamicMovingMax));
                  const max = Math.max(min, Math.min(Number(next.max), dynamicMovingMax));
                  setMovingRange({ min, max });
                }}
              />
            </div>

            <div className="settings-section">
              <h3>Walls</h3>
              <RangeInput
                label="Density"
                value={wallRange}
                min={0.02}
                max={0.45}
                step={0.01}
                onChange={(next) =>
                  setWallRange({
                    min: Math.max(0.02, Number(next.min)),
                    max: Math.max(Number(next.min), Number(next.max)),
                  })
                }
              />
            </div>

            <div className="modal-actions">
              <button
                className="btn"
                onClick={() => {
                  generateMap();
                  setShowSettings(false);
                }}
              >
                Generate Map
              </button>
              <button className="small" onClick={() => setShowSettings(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {selectedRobotKey && (
        <RobotDetailModal
          robotKey={selectedRobotKey}
          onClose={() => setSelectedRobotKey(null)}
          robotData={{
            path: paths[canonicalKey(selectedRobotKey)] || paths[selectedRobotKey] || [],
            log: robotLogs[canonicalKey(selectedRobotKey)] || robotLogs[selectedRobotKey] || {},
            tasks: robotSummaries.find((r) => (canonicalKey(r.start) || JSON.stringify(r.start)) === selectedRobotKey)?.assignments || [],
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