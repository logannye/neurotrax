import { describe, expect, it } from "vitest";
import { depthToColor, normalizeDepth } from "./mesh-depth.js";

describe("mesh depth", () => {
  it("maps nearest z (most negative) to 1 and farthest to 0", () => {
    const out = normalizeDepth([-0.1, 0, 0.1]);
    expect(out[0]).toBeCloseTo(1);
    expect(out[1]).toBeCloseTo(0.5);
    expect(out[2]).toBeCloseTo(0);
  });

  it("returns 0.5 for empty, all-equal, or non-finite input", () => {
    expect(normalizeDepth([])).toEqual([]);
    expect(normalizeDepth([2, 2, 2])).toEqual([0.5, 0.5, 0.5]);
    expect(normalizeDepth([Number.NaN, 0])[0]).toBeCloseTo(0.5);
  });

  it("produces channels in [0,1] and shifts hue deterministically", () => {
    const c = depthToColor(0.5, 0);
    for (const v of [c.r, c.g, c.b]) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
    expect(depthToColor(0.5, 40)).not.toEqual(depthToColor(0.5, 0));
    expect(depthToColor(2, 0)).toEqual(depthToColor(1, 0)); // clamped
  });
});
