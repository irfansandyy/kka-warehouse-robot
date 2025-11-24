import React from "react";
import { formatCell } from "../utils/formatters";

function safeFormatCell(cell) {
  if (Array.isArray(cell) && cell.length === 2) return formatCell(cell);
  if (typeof cell === "string") return cell;
  if (cell && typeof cell === "object" && Number.isFinite(cell.row) && Number.isFinite(cell.col)) {
    return formatCell([cell.row, cell.col]);
  }
  return "N/A";
}

function formatNumber(value, digits = 2) {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(digits) : value;
}

function describeDelta(prevStep, currStep) {
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
}

function manhattanDelta(prevStep, currStep) {
  if (!prevStep || !currStep) return 0;
  return Math.abs(currStep[0] - prevStep[0]) + Math.abs(currStep[1] - prevStep[1]);
}

export function RobotDetailModal({ robotKey, robotData, onClose }) {
  const { path, currentStepIdx, log, tasks } = robotData;
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
                        {metaBits.length ? (
                          metaBits.map((text, metaIdx) => <span key={`${taskKey}-meta-${metaIdx}`}>{text}</span>)
                        ) : (
                          <span>Queued &amp; ready</span>
                        )}
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
              <span>
                {path.length} step{path.length === 1 ? "" : "s"}
              </span>
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
                    <div key={`path-${idx}-${coordLabel}`} className={`path-detail-card${isCurrent ? " current" : ""}`}>
                      <div className="path-detail-row">
                        <span className="path-detail-index">Step {idx}</span>
                        <span className="path-detail-coord">{coordLabel}</span>
                      </div>
                      <div className="path-detail-meta">
                        <span>{describeDelta(prevStep, step)}</span>
                        {distance > 0 && (
                          <span>
                            {distance} tile{distance === 1 ? "" : "s"}
                          </span>
                        )}
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
