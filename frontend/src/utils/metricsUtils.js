import { METRIC_PRIMARY_KEYS } from "../constants";
import { formatMetricValue, prettifyLabel } from "./formatting";

export function extractPrimaryMetric(obj) {
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

export function buildMetricCards(section = {}) {
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

export function findMetricByKeywords(section, keywords = [], path = []) {
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
