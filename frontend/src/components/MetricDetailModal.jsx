import React from "react";

export function MetricDetailModal({ data, onClose }) {
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
