import React from "react";

export function EditModePanel({ isEditMode, pendingTotals }) {
  const hasPending = Boolean(
    (pendingTotals?.robots || 0) ||
      (pendingTotals?.tasks || 0) ||
      (pendingTotals?.walls || 0) ||
      (pendingTotals?.forklifts || 0)
  );

  return (
    <div className="stat">
      <div className="label">Edit Mode</div>
      <div className="value" style={{ color: isEditMode ? "#0b69ff" : "#65739a" }}>
        {isEditMode ? "Active" : "Inactive"}
      </div>
      <div className="label">
        Toggle with <strong>E</strong>. While active use <strong>R</strong> for robots, <strong>T</strong> for tasks,
        {" "}
        <strong>W</strong> for walls, <strong>F</strong> for forklifts; tap the key again on the same cell to undo.
      </div>
      <div className="label">Edits auto-save when you exit edit mode.</div>
      {isEditMode && hasPending && (
        <div className="label">
          Pending — R:{pendingTotals?.robots || 0} T:{pendingTotals?.tasks || 0} W:{pendingTotals?.walls || 0} F:
          {pendingTotals?.forklifts || 0}
        </div>
      )}
    </div>
  );
}
