import { describe, expect, it } from "vitest";
import { INTRO_DURATION_MS, LocalizeIntro, smoothstep } from "./localize-intro.js";

describe("localize intro", () => {
  it("smoothstep is clamped and eased", () => {
    expect(smoothstep(-1)).toBe(0);
    expect(smoothstep(0)).toBe(0);
    expect(smoothstep(0.5)).toBeCloseTo(0.5);
    expect(smoothstep(1)).toBe(1);
    expect(smoothstep(2)).toBe(1);
  });

  it("returns 0 before start, eases to 1, then holds", () => {
    const intro = new LocalizeIntro();
    expect(intro.progress(1_000)).toBe(0);
    intro.start(1_000);
    expect(intro.progress(1_000)).toBe(0);
    expect(intro.progress(1_000 + INTRO_DURATION_MS / 2)).toBeGreaterThan(0);
    expect(intro.progress(1_000 + INTRO_DURATION_MS / 2)).toBeLessThan(1);
    expect(intro.progress(1_000 + INTRO_DURATION_MS)).toBe(1);
    expect(intro.progress(9_999_999)).toBe(1);
  });

  it("ignores re-start until reset, and reset re-arms it", () => {
    const intro = new LocalizeIntro();
    intro.start(0);
    intro.start(500); // ignored while running
    expect(intro.progress(INTRO_DURATION_MS)).toBe(1);
    expect(intro.isActive(INTRO_DURATION_MS + 1)).toBe(false);
    intro.reset();
    expect(intro.progress(10)).toBe(0);
    intro.start(10);
    expect(intro.progress(10)).toBe(0);
  });
});
