import React from "react";
import { EXECUTION_DETAIL_INLINE_LIMIT } from "../constants/config";
import { formatMetricValue } from "../utils/formatters";

export function PerformancePanel({
  showPerformancePanel,
  hasTimingCard,
  timingEntries,
  executionRows,
  onShowDetails,
}) {
  if (!showPerformancePanel) {
    return <div className="label">Run planning to view metrics.</div>;
  }

  const safeTimingEntries = timingEntries || [];
  const safeExecutionRows = executionRows || [];

  return (
    <div className="stat performance-panel">
      <div className="label">Performance</div>
      {hasTimingCard && (
        <div className="timing-card">
          <div className="timing-card-header">
            <div className="timing-card-eyebrow">Latest run</div>
            <div className="timing-card-title">Planning · Paths · Scheduling</div>
          </div>
          <div className="timing-rows">
            {safeTimingEntries.map((entry) => (
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
      {safeExecutionRows.length > 0 && (
        <div className="execution-rows">
          <div className="label">Execution</div>
          {safeExecutionRows.map((row) => {
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
                    onClick={() => onShowDetails({ title: `Execution · ${row.title}`, card: row.card })}
                  >
                    View details
                  </button>
                )}
                {!needsMoreButton && needsInspectButton && (
                  <button
                    type="button"
                    className="metrics-card-button subtle"
                    onClick={() => onShowDetails({ title: `Execution · ${row.title}`, card: row.card })}
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
  );
}
