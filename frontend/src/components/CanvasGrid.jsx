import { useEffect, useRef } from "react";
import { COLORS, COMPLETED_COLOR } from "../constants/config";
import { canonicalKey } from "../utils/cells";
import { lightenColor } from "../utils/colors";

export function CanvasGrid({
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
      ctx.fillStyle = "#f5533e";
      ctx.font = "bold 11px Inter";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(`F+${idx + 1}`, pts[0][1] * cell + cell / 2, pts[0][0] * cell + cell / 2);
      ctx.restore();
    });

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
