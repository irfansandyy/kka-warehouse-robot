export function lightenColor(hex, amount = 0.35) {
  if (!hex || hex[0] !== "#") return hex;
  const num = parseInt(hex.slice(1), 16);
  const r = Math.min(255, Math.floor((num >> 16) * (1 - amount) + 255 * amount));
  const g = Math.min(255, Math.floor(((num >> 8) & 0xff) * (1 - amount) + 255 * amount));
  const b = Math.min(255, Math.floor((num & 0xff) * (1 - amount) + 255 * amount));
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b
    .toString(16)
    .padStart(2, "0")}`;
}
