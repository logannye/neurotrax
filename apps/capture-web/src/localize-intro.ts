export const INTRO_DURATION_MS = 1_100;

export function smoothstep(t: number): number {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
}

// After the intro settles the mesh "breathes": every PERIOD it eases off (to 0)
// then back on over DIP, replaying the come-into-focus ripple.
export const MESH_PULSE_PERIOD_MS = 6_000;
export const MESH_PULSE_DIP_MS = 3_600;

/**
 * Recurring mesh presence (0..1) for the post-intro breathe. Fully on (1) for
 * most of each period, then eases 1->0 (ripple off) and 0->1 (ripple back on).
 * `tMs` is time since the intro settled; negative or large values wrap cleanly.
 */
export function meshPulse(tMs: number): number {
  const period = MESH_PULSE_PERIOD_MS;
  const t = ((tMs % period) + period) % period;
  const onMs = period - MESH_PULSE_DIP_MS;
  if (t <= onMs) return 1;
  const d = (t - onMs) / MESH_PULSE_DIP_MS; // 0..1 across the dip
  return d < 0.5 ? 1 - smoothstep(d * 2) : smoothstep((d - 0.5) * 2);
}

/**
 * Tracks the one-shot "come-into-focus" intro that plays when the mesh first
 * localizes to a face. Time is injected (no wall-clock inside) so it is
 * deterministic and testable, and so the worker can drive it from its own clock.
 */
export class LocalizeIntro {
  private startedAtMs: number | null = null;

  start(nowMs: number): void {
    if (this.startedAtMs !== null) return;
    this.startedAtMs = nowMs;
  }

  progress(nowMs: number): number {
    if (this.startedAtMs === null) return 0;
    return smoothstep((nowMs - this.startedAtMs) / INTRO_DURATION_MS);
  }

  isActive(nowMs: number): boolean {
    return this.startedAtMs !== null && this.progress(nowMs) < 1;
  }

  /**
   * Mesh presence (0..1) driving the same fade/scale/bloom as the intro: the
   * one-shot come-into-focus ramp, then the recurring breathe (meshPulse).
   */
  presence(nowMs: number): number {
    if (this.startedAtMs === null) return 0;
    const elapsed = nowMs - this.startedAtMs;
    if (elapsed < INTRO_DURATION_MS) {
      return smoothstep(elapsed / INTRO_DURATION_MS);
    }
    return meshPulse(elapsed - INTRO_DURATION_MS);
  }

  reset(): void {
    this.startedAtMs = null;
  }
}
