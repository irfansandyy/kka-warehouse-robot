import React from "react";
import { formatCell } from "../utils/formatters";
import { lightenColor } from "../utils/colors";

export function RobotSummaryCard({ robot, robotColor, log, onSelect }) {
  const assignments = robot?.assignments || [];
  const displayColor = robotColor || "#0b69ff";
  const costText = robot.total_cost?.toFixed?.(2) ?? robot.total_cost;
  const labelColor = lightenColor(displayColor, 0.55);

  return (
    <div
      className="stat"
      style={{ borderLeft: `4px solid ${displayColor}`, cursor: "pointer" }}
      onClick={onSelect}
    >
      <div className="value" style={{ color: displayColor }}>
        Robot {robot.id + 1} @ {formatCell(robot.start)}
      </div>
      {log && (
        <div style={{ marginBottom: "6px" }}>
          <div className="robot-log-item">
            <span className="label">Status</span>
            <span className="value" style={{ fontSize: "12px" }}>
              {log.status}
            </span>
          </div>
          <div className="robot-log-item">
            <span className="label">Position</span>
            <span className="value" style={{ fontSize: "12px" }}>
              {log.position}
            </span>
          </div>
          <div className="robot-log-item">
            <span className="label">Target</span>
            <span className="value" style={{ fontSize: "12px" }}>
              {log.target}
            </span>
          </div>
        </div>
      )}
      <div className="label" style={{ fontSize: "12px", color: labelColor }}>
        Cost: {costText} | Tasks: {assignments.length}
      </div>
      {assignments.length > 0 ? (
        <div className="label" style={{ fontSize: "11px", marginTop: "4px", lineHeight: "1.4" }}>
          {assignments.map((task) => `#${task.order}: ${formatCell(task.task)};`).join(" ")}
        </div>
      ) : (
        <div className="label">No tasks assigned</div>
      )}
    </div>
  );
}
