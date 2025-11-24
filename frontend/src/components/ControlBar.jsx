import React from "react";

export function ControlBar({
  onOpenSettings,
  onGenerateMap,
  onPlanTasks,
  onComputePaths,
  optimizer,
  onOptimizerChange,
  selectedAlg,
  onAlgChange,
  speed,
  onSpeedChange,
  simPlaying,
  simPaused,
  hasScheduledPaths,
  onPause,
  onResume,
  onReset,
  onPlay,
  isEditMode,
  onToggleEditMode,
  status,
}) {
  return (
    <div className="header">
      <button className="btn" onClick={onOpenSettings}>
        Map Settings
      </button>
      <button className="small" onClick={onGenerateMap}>
        Regenerate
      </button>
      <button className="small" onClick={onPlanTasks}>
        Plan Tasks
      </button>
      <button className="small" onClick={onComputePaths}>
        Compute Paths
      </button>
      <div className="control-group">
        <label className="label">Optimizer</label>
        <select value={optimizer} onChange={(e) => onOptimizerChange(e.target.value)}>
          <option value="greedy">Greedy</option>
          <option value="ga">Genetic Algorithm</option>
          <option value="local">Local Search</option>
        </select>
      </div>
      <div className="control-group">
        <label className="label">Path</label>
        <select value={selectedAlg} onChange={(e) => onAlgChange(e.target.value)}>
          <option value="astar">A*</option>
          <option value="dijkstra">Dijkstra</option>
        </select>
      </div>
      <div className="speed">
        <label className="label">Speed</label>
        <input type="range" min="1" max="20" value={speed} onChange={(e) => onSpeedChange(Number(e.target.value))} />
        <span className="value">{speed}x</span>
      </div>
      {simPlaying ? (
        <button className="small" onClick={onPause}>
          Pause
        </button>
      ) : simPaused && hasScheduledPaths ? (
        <>
          <button className="small" onClick={onResume}>
            Resume
          </button>
          <button className="small" onClick={onReset}>
            Reset
          </button>
        </>
      ) : (
        <button className="small" onClick={onPlay}>
          Play
        </button>
      )}
      <button
        className="small"
        style={{ borderColor: isEditMode ? "#0b69ff" : undefined, color: isEditMode ? "#0b69ff" : undefined }}
        onClick={onToggleEditMode}
      >
        {isEditMode ? "Exit Edit Mode (E)" : "Edit Mode (E)"}
      </button>
      <div className="label" style={{ marginLeft: "auto" }}>
        Status: <strong>{status}</strong>
      </div>
    </div>
  );
}
