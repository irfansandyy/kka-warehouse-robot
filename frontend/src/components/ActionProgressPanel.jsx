import React from "react";

const STATUS_COLOR = {
  running: "#0b69ff",
  success: "#25a86b",
  error: "#f5533e",
};

export function ActionProgressPanel({ progress, descriptors }) {
  const entries = (descriptors || [])
    .map((descriptor) => ({ ...descriptor, state: progress?.[descriptor.key] }))
    .filter((entry) => entry.state?.active);

  if (entries.length === 0) {
    return null;
  }

  return (
    <div className="action-progress-panel">
      {entries.map(({ key, label, state }) => {
        const displayLabel = state.label || label;
        const color = STATUS_COLOR[state.status] || STATUS_COLOR.running;
        const width = `${Math.round(Math.min(100, Math.max(0, state.value)))}%`;
        return (
          <div key={key} className="action-progress-item">
            <div className="action-progress-title">
              <span>{displayLabel}</span>
              <span className="progress-bar-value">{Math.round(state.value)}%</span>
            </div>
            <div className="progress-bar">
              <div className="progress-bar-fill" style={{ width, background: color }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
