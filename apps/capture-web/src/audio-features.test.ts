import { describe, expect, it } from "vitest";
import {
  calculateRms,
  createVoiceActivityTracker,
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

  it("uses hysteresis so a borderline voice frame does not chatter", () => {
    const tracker = createVoiceActivityTracker(0.005);
    const clearVoice = tracker.derive(
      sineWave(140, 48_000, 4096, 0.04),
      48_000
    );
    const softerContinuation = tracker.derive(
      sineWave(140, 48_000, 4096, 0.014),
      48_000
    );
    expect(clearVoice.voiced).toBe(true);
    expect(softerContinuation.voiced).toBe(true);
  });

  it("calibrates entry and exit thresholds from quiet-room samples", () => {
    const tracker = createVoiceActivityTracker();
    const calibration = tracker.calibrate([
      0.002,
      0.0022,
      0.0021,
      0.0024,
      0.0023
    ]);
    expect(calibration.entryThresholdRms).toBeGreaterThanOrEqual(0.008);
    expect(calibration.exitThresholdRms).toBeLessThan(
      calibration.entryThresholdRms
    );
    expect(tracker.getCalibration()).toEqual(calibration);
  });

  it("does not classify unpitched room energy as speech onset", () => {
    const tracker = createVoiceActivityTracker();
    tracker.calibrate([0.002, 0.002, 0.002]);
    const noise = Float32Array.from(
      { length: 4096 },
      (_, index) => Math.sin(index * index * 0.071) * 0.025
    );
    expect(tracker.derive(noise, 48_000).voiced).toBe(false);
  });

  it("does not treat mains-frequency hum as speech onset", () => {
    const tracker = createVoiceActivityTracker();
    tracker.calibrate([0.002, 0.002, 0.002]);
    const hum = sineWave(60, 48_000, 4096, 0.03);

    expect(tracker.derive(hum, 48_000).voiced).toBe(false);
  });
});
