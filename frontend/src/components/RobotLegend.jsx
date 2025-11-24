import React from "react";
import { COLORS, COMPLETED_COLOR } from "../constants/config";

export function RobotLegend({ robots }) {
  return (
    <div className="stat">
      <div className="label">Legend</div>
      <div className="legend">
        {(robots || []).map((_, idx) => (
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
  );
}
