export const INTRO_DURATION_MS = 1_100;

export function smoothstep(t: number): number {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
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

  reset(): void {
    this.startedAtMs = null;
  }
}
