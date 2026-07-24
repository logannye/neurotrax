/** HSL→RGB with h in degrees, s/l in 0..1. Returns channels in 0..1. */
function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
  const hue = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (hue < 60) [r, g, b] = [c, x, 0];
  else if (hue < 120) [r, g, b] = [x, c, 0];
  else if (hue < 180) [r, g, b] = [0, c, x];
  else if (hue < 240) [r, g, b] = [0, x, c];
  else if (hue < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return { r: r + m, g: g + m, b: b + m };
}

/**
 * Map raw MediaPipe landmark z-values to a 0..1 depth where 1 is nearest the
 * camera (most-negative z) and 0 is farthest. Non-finite, empty, or all-equal
 * inputs collapse to 0.5 so shading stays neutral rather than NaN.
 */
export function normalizeDepth(zValues: readonly number[]): number[] {
  const finite = zValues.filter((z) => Number.isFinite(z));
  if (finite.length === 0) {
    return zValues.map(() => (zValues.length ? 0.5 : 0.5)).slice(0, zValues.length);
  }
  let min = Infinity;
  let max = -Infinity;
  for (const z of finite) {
    if (z < min) min = z;
    if (z > max) max = z;
  }
  const span = max - min;
  return zValues.map((z) => {
    if (!Number.isFinite(z) || span <= 1e-9) return 0.5;
    // most-negative z (min) -> nearest -> 1
    return 1 - (z - min) / span;
  });
}

/** Iridescent cyan(≈190°)→violet(≈275°) ramp by depth, rotated by hueShiftDeg. */
export function depthToColor(
  depth: number,
  hueShiftDeg: number
): { r: number; g: number; b: number } {
  const d = Math.max(0, Math.min(1, depth));
  const hue = 190 + d * 85 + hueShiftDeg;
  const lightness = 0.42 + d * 0.28;
  return hslToRgb(hue, 0.92, lightness);
}
