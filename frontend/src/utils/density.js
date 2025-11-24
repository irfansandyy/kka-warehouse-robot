import { clampNumber } from "./numbers";

function averageDensity(range) {
  if (!range) return 0.08;
  const lo = Number(range.min ?? range[0] ?? 0.02);
  const hi = Number(range.max ?? range[1] ?? lo);
  return clampNumber((lo + hi) / 2, 0.02, 0.45);
}

function estimateWalkableCells(width, height, wallRange) {
  const avg = averageDensity(wallRange);
  const area = Math.max(1, Number(width) * Number(height));
  return Math.max(1, Math.floor(area * (1 - avg)));
}

function computeTaskCap(width, height, wallRange) {
  const walkable = estimateWalkableCells(width, height, wallRange);
  return Math.max(3, Math.min(width * height, Math.floor(walkable * 0.9)));
}

function computeMovingCap(width, height, wallRange) {
  const walkable = estimateWalkableCells(width, height, wallRange);
  return Math.max(10, Math.min(width * height, Math.floor(walkable / 60)));
}

export { averageDensity, estimateWalkableCells, computeTaskCap, computeMovingCap };
