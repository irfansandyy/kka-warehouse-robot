export function parseCell(cell) {
  if (Array.isArray(cell) && cell.length === 2) {
    return [Number(cell[0]), Number(cell[1])];
  }
  if (typeof cell === "string") {
    try {
      const parsed = JSON.parse(cell);
      if (Array.isArray(parsed) && parsed.length === 2) {
        return [Number(parsed[0]), Number(parsed[1])];
      }
    } catch (error) {
      try {
        const fallback = cell.trim().replace(/[()\[\]]/g, "");
        const parts = fallback.split(",").map((p) => p.trim());
        if (parts.length === 2) {
          return [Number(parts[0]), Number(parts[1])];
        }
      } catch (ignored) {
        return null;
      }
    }
  }
  return null;
}

export function canonicalKey(cell) {
  const coords = parseCell(cell);
  if (!coords) return null;
  return JSON.stringify([Number(coords[0]), Number(coords[1])]);
}

export function cellKey(cell) {
  if (!cell || cell.length < 2) return "";
  return `${cell[0]},${cell[1]}`;
}

export function cellsEqual(a, b) {
  if (!a || !b) return false;
  return Number(a[0]) === Number(b[0]) && Number(a[1]) === Number(b[1]);
}

export function clampNumber(value, min, max) {
  const num = Number(value);
  if (!Number.isFinite(num)) return min;
  return Math.max(min, Math.min(max, num));
}

export function randomInt(min, max) {
  const lo = Math.ceil(min);
  const hi = Math.floor(max);
  return Math.floor(Math.random() * (hi - lo + 1)) + lo;
}

export function averageDensity(range) {
  if (!range) return 0.08;
  const lo = Number(range.min ?? range[0] ?? 0.02);
  const hi = Number(range.max ?? range[1] ?? lo);
  return clampNumber((lo + hi) / 2, 0.02, 0.45);
}

export function estimateWalkableCells(width, height, wallRange) {
  const avg = averageDensity(wallRange);
  const area = Math.max(1, Number(width) * Number(height));
  return Math.max(1, Math.floor(area * (1 - avg)));
}

export function computeTaskCap(width, height, wallRange) {
  const walkable = estimateWalkableCells(width, height, wallRange);
  return Math.max(3, Math.min(width * height, Math.floor(walkable * 0.9)));
}

export function computeMovingCap(width, height, wallRange) {
  const walkable = estimateWalkableCells(width, height, wallRange);
  return Math.max(10, Math.min(width * height, Math.floor(walkable / 60)));
}

export function pathSignature(path) {
  return JSON.stringify((path || []).map((step) => parseCell(step)).filter(Boolean));
}

export function createEmptyManualEdits() {
  return {
    robots: { add: [], remove: [] },
    tasks: { add: [], remove: [] },
    walls: { add: [], remove: [] },
    forklifts: { add: [], remove: [] },
  };
}
