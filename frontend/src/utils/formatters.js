function formatCell(cell) {
  if (!cell || cell.length < 2) return "(?, ?)";
  return `(${cell[0]}, ${cell[1]})`;
}

function prettifyLabel(label) {
  if (!label) return "";
  return label.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatDuration(value, assumesMilliseconds = false) {
  if (!Number.isFinite(value)) return "—";
  const ms = assumesMilliseconds ? value : value * 1000;
  if (ms < 1) return `${ms.toFixed(3)} ms`;
  if (ms < 1000) return `${ms.toFixed(ms < 100 ? 2 : 1)} ms`;
  const seconds = ms / 1000;
  if (seconds < 60) {
    const precision = seconds < 10 ? 3 : 2;
    return `${seconds.toFixed(precision)} s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  const minutePart = `${minutes}m`;
  const secondPart = remainder > 0 ? ` ${remainder.toFixed(remainder < 10 ? 2 : 1)}s` : "";
  return `${minutePart}${secondPart}`.trim();
}

function summarizeObject(obj, depth = 0) {
  if (!obj || typeof obj !== "object") return String(obj);
  const entries = Object.entries(obj);
  if (!entries.length) return "{}";
  const preview = entries.slice(0, 3).map(([key, val]) => {
    const label = prettifyLabel(key);
    return `${label}: ${formatMetricValue(val, key, depth + 1)}`;
  });
  const remainder = entries.length - preview.length;
  return `${preview.join(" · ")}${remainder > 0 ? ` · +${remainder} more` : ""}`;
}

const METRIC_PRIMARY_KEYS = [
  "total",
  "value",
  "score",
  "cost",
  "execution_time_s",
  "time_ms",
  "time",
  "duration",
  "avg",
  "average",
  "mean",
  "count",
];

function formatMetricValue(value, key = "", depth = 0) {
  if (value === null || value === undefined) return "—";
  const normalizedKey = key?.toLowerCase?.() || "";
  if (typeof value === "number") {
    if (normalizedKey.includes("time") || normalizedKey.includes("duration") || normalizedKey.includes("latency")) {
      const assumesMs = normalizedKey.endsWith("ms") || normalizedKey.includes("_ms");
      return formatDuration(value, assumesMs);
    }
    if (Math.abs(value) >= 1000) return value.toLocaleString();
    if (Number.isInteger(value)) return value.toString();
    const precision = Math.abs(value) < 1 ? 3 : 2;
    return value.toFixed(precision);
  }
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    const preview = value.slice(0, 3).map((v) => formatMetricValue(v, key, depth + 1)).join(", ");
    return value.length > 3 ? `[${preview}, … +${value.length - 3}]` : `[${preview}]`;
  }
  if (typeof value === "object") {
    if (depth >= 2) return JSON.stringify(value);
    return summarizeObject(value, depth);
  }
  return String(value);
}

function extractPrimaryMetric(obj) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null;
  for (const key of METRIC_PRIMARY_KEYS) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      return [key, obj[key]];
    }
  }
  const numericEntry = Object.entries(obj).find(([, value]) => typeof value === "number");
  if (numericEntry) return numericEntry;
  const firstEntry = Object.entries(obj)[0];
  return firstEntry || null;
}

function buildMetricCards(section = {}) {
  if (!section || typeof section !== "object") return [];
  return Object.entries(section).map(([key, value]) => {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return {
        key,
        label: prettifyLabel(key),
        headline: formatMetricValue(value, key),
        headlineLabel: null,
        details: [],
      };
    }
    const primary = extractPrimaryMetric(value);
    const details = Object.entries(value)
      .filter(([childKey]) => !primary || childKey !== primary[0])
      .map(([childKey, childValue]) => {
        const normalized = typeof childKey === "string" ? childKey.toLowerCase() : String(childKey).toLowerCase();
        let label = prettifyLabel(childKey);
        let valueText = formatMetricValue(childValue, childKey);
        if (normalized === "ok" || normalized === "success") {
            label = "Status";
            valueText = childValue ? "OK" : "Failed";
        }
        return {
          label,
          value: valueText,
          rawValue: childValue,
          isComplex: typeof childValue === "object" && childValue !== null,
        };
      });
    return {
      key,
      label: prettifyLabel(key),
      headline: primary ? formatMetricValue(primary[1], primary[0]) : null,
      headlineLabel: primary ? prettifyLabel(primary[0]) : null,
      details,
      rawValue: value,
    };
  });
}

function findMetricByKeywords(section, keywords = [], path = []) {
  if (!section || typeof section !== "object" || Array.isArray(section)) return null;
  for (const [key, value] of Object.entries(section)) {
    const normalized = typeof key === "string" ? key.toLowerCase() : String(key).toLowerCase();
    const nextPath = [...path, key];
    if (typeof value === "number" && keywords.some((kw) => normalized.includes(kw))) {
      return { key, value, path: nextPath };
    }
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const nested = findMetricByKeywords(value, keywords, nextPath);
      if (nested) return nested;
    }
  }
  return null;
}

export {
  formatCell,
  prettifyLabel,
  formatDuration,
  formatMetricValue,
  buildMetricCards,
  findMetricByKeywords,
};
