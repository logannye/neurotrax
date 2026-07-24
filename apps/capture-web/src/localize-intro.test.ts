import { describe, expect, it } from "vitest";
import {
  INTRO_DURATION_MS,
  LocalizeIntro,
  MESH_PULSE_DIP_MS,
  MESH_PULSE_PERIOD_MS,
  meshPulse,
  smoothstep
} from "./localize-intro.js";

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

  it("meshPulse: on for most of the period, fully off at the dip midpoint", () => {
    const onMs = MESH_PULSE_PERIOD_MS - MESH_PULSE_DIP_MS;
    expect(meshPulse(0)).toBe(1);
    expect(meshPulse(onMs - 1)).toBe(1);
    expect(meshPulse(onMs + MESH_PULSE_DIP_MS / 2)).toBeCloseTo(0);
    expect(meshPulse(MESH_PULSE_PERIOD_MS)).toBe(1);
    expect(meshPulse(MESH_PULSE_PERIOD_MS * 3 + 123)).toBeCloseTo(meshPulse(123));
    const neg = meshPulse(-500);
    expect(neg).toBeGreaterThanOrEqual(0);
    expect(neg).toBeLessThanOrEqual(1);
  });

  it("presence: intro ramp, settles to 1, then breathes off and on", () => {
    const intro = new LocalizeIntro();
    expect(intro.presence(0)).toBe(0);
    intro.start(0);
    expect(intro.presence(0)).toBe(0);
    expect(intro.presence(INTRO_DURATION_MS / 2)).toBeGreaterThan(0);
    expect(intro.presence(INTRO_DURATION_MS)).toBe(1);
    expect(intro.presence(INTRO_DURATION_MS + 100)).toBe(1);
    const onMs = MESH_PULSE_PERIOD_MS - MESH_PULSE_DIP_MS;
    const dipMid = INTRO_DURATION_MS + onMs + MESH_PULSE_DIP_MS / 2;
    expect(intro.presence(dipMid)).toBeCloseTo(0);
  });
});
