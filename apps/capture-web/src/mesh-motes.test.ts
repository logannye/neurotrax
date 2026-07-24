import { describe, expect, it } from "vitest";
import { MoteField } from "./mesh-motes.js";

describe("MoteField", () => {
  it("spawns, drifts upward, and fades deterministically", () => {
    const field = new MoteField(32);
    const spawn = (i: number) => ({ x: (i % 8) / 8, y: 0.5, depth: 0.5 });
    field.update(16, spawn, 100);
    const y0 = field.positions()[1];
    field.update(200, spawn, 100);
    // clip-space y increases upward; drifting up means y grows
    expect(field.positions()[1]).toBeGreaterThan(y0);
    // alphas stay within 0..1
    for (const a of field.alphas()) {
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThanOrEqual(1);
    }
  });

  it("is deterministic across instances", () => {
    const a = new MoteField(16);
    const b = new MoteField(16);
    const spawn = (i: number) => ({ x: i / 16, y: 0, depth: 0.5 });
    a.update(16, spawn, 50);
    b.update(16, spawn, 50);
    expect([...a.positions()]).toEqual([...b.positions()]);
  });
});
