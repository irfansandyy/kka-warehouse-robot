export function formatCell(cell) {
  if (!cell || cell.length < 2) return "(?, ?)";
  return `(${cell[0]}, ${cell[1]})`;
}

export function prettifyLabel(label) {
  if (!label) return "";
  return label
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function formatDuration(value, assumesMilliseconds = false) {
  if (!Number.isFinite(value)) return "—";
  const ms = assumesMilliseconds ? value : value * 1000;
  if (ms < 1) {
    return `${ms.toFixed(3)} ms`;
  }
  if (ms < 1000) {
    return `${ms.toFixed(ms < 100 ? 2 : 1)} ms`;
  }
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

export function formatMetricValue(value, key = "", depth = 0) {
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
    if (depth >= 2) {
      return JSON.stringify(value);
    }
    return summarizeObject(value, depth);
  }
  return String(value);
}
