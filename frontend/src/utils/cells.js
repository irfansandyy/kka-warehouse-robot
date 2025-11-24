function parseCell(cell) {
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

function canonicalKey(cell) {
  const coords = parseCell(cell);
  if (!coords) return null;
  return JSON.stringify([Number(coords[0]), Number(coords[1])]);
}

function cellKey(cell) {
  if (!cell || cell.length < 2) return "";
  return `${cell[0]},${cell[1]}`;
}

function cellsEqual(a, b) {
  if (!a || !b) return false;
  return Number(a[0]) === Number(b[0]) && Number(a[1]) === Number(b[1]);
}

function pathSignature(path) {
  return JSON.stringify((path || []).map((step) => parseCell(step)).filter(Boolean));
}

export { parseCell, canonicalKey, cellKey, cellsEqual, pathSignature };
