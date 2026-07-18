import { describe, expect, it } from "vitest";
import {
  calculateRms,
  deriveAudioFeature,
  estimatePitchHz
} from "./audio-features.js";

function sineWave(
  frequencyHz: number,
  sampleRate: number,
  length: number,
  amplitude = 0.2
): Float32Array {
  return Float32Array.from(
    { length },
    (_, index) =>
      amplitude * Math.sin((2 * Math.PI * frequencyHz * index) / sampleRate)
  );
}

describe("browser audio feature derivation", () => {
  it("calculates RMS amplitude", () => {
    const samples = Float32Array.from([1, -1, 1, -1]);
    expect(calculateRms(samples)).toBe(1);
  });

  it("estimates pitch for a clean synthetic voice-range tone", () => {
    const samples = sineWave(120, 48_000, 4096);
    expect(estimatePitchHz(samples, 48_000)).toBeCloseTo(120, 0);
  });

  it("returns no pitch for silence", () => {
    expect(estimatePitchHz(new Float32Array(4096), 48_000)).toBeNull();
  });

  it("derives voiced, SNR, and clipping state from a frame", () => {
    const voiced = deriveAudioFeature(
      sineWave(140, 48_000, 4096),
      48_000,
      0.005
    );
    expect(voiced.voiced).toBe(true);
    expect(voiced.pitchHz).toBeCloseTo(140, 0);
    expect(voiced.snrDb).toBeGreaterThan(12);
    expect(voiced.clipped).toBe(false);

    const clipped = deriveAudioFeature(
      Float32Array.from([0, 0.99, -0.99, 0]),
      48_000,
      0.005
    );
    expect(clipped.clipped).toBe(true);
  });
});
