import React from "react";
import { RangeInput } from "./RangeInput";

export function MapSettingsModal({
  open,
  onClose,
  onGenerate,
  mapWidth,
  mapHeight,
  seed,
  onMapWidthChange,
  onMapHeightChange,
  onSeedChange,
  robotRange,
  onRobotRangeChange,
  taskRange,
  onTaskRangeChange,
  movingRange,
  onMovingRangeChange,
  wallRange,
  onWallRangeChange,
  maxWidth,
  maxHeight,
  maxRobots,
  dynamicTaskMax,
  dynamicMovingMax,
  taskRangeHint,
  movingRangeHint,
}) {
  if (!open) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
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
              max={maxWidth}
              onChange={(e) => onMapWidthChange(e.target.value)}
            />
          </div>
          <div className="input-group">
            <label className="label">Height</label>
            <input
              type="number"
              value={mapHeight}
              min={8}
              max={maxHeight}
              onChange={(e) => onMapHeightChange(e.target.value)}
            />
          </div>
          <div className="input-group">
            <label className="label">Seed</label>
            <input type="text" value={seed} placeholder="Optional" onChange={(e) => onSeedChange(e.target.value)} />
          </div>
        </div>

        <div className="settings-section">
          <h3>Counts</h3>
          <RangeInput
            label="Robots"
            value={robotRange}
            min={1}
            max={maxRobots}
            onChange={(next) => {
              const min = Math.min(maxRobots, Math.max(1, Number(next.min)));
              const max = Math.min(maxRobots, Math.max(min, Number(next.max)));
              onRobotRangeChange({ min, max });
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
              onTaskRangeChange({ min, max });
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
              onMovingRangeChange({ min, max });
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
              onWallRangeChange({
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
              onGenerate();
            }}
          >
            Generate Map
          </button>
          <button className="small" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
