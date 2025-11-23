import { FORKLIFT_MAX_STEPS, FORKLIFT_MIN_STEPS } from "../constants";
import { cellsEqual, randomInt } from "./cellUtils";

export function buildRandomForkliftPath(grid, start, options = {}) {
  if (!Array.isArray(start) || start.length < 2) return [];
  const height = grid?.length || 0;
  const width = height ? grid[0].length : 0;
  if (!height || !width) return [];
  const minLen = Math.max(2, options.minLen ?? FORKLIFT_MIN_STEPS);
  const maxLen = Math.max(minLen, options.maxLen ?? FORKLIFT_MAX_STEPS);
  const targetLen = randomInt(minLen, maxLen);
  const path = [[start[0], start[1]]];
  let current = [start[0], start[1]];
  let prev = null;

  for (let step = 1; step < targetLen; step += 1) {
    const neighbors = [];
    const directions = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ];
    directions.forEach(([dr, dc]) => {
      const nr = current[0] + dr;
      const nc = current[1] + dc;
      if (nr < 0 || nc < 0 || nr >= height || nc >= width) return;
      if (grid[nr][nc] !== 0) return;
      neighbors.push([nr, nc]);
    });
    let candidates = neighbors;
    if (prev && candidates.length > 1) {
      const filtered = candidates.filter((cell) => !cellsEqual(cell, prev));
      if (filtered.length) {
        candidates = filtered;
      }
    }
    if (!candidates.length) break;
    const next = candidates[randomInt(0, candidates.length - 1)];
    path.push(next);
    prev = current;
    current = next;
  }
  return path;
}
