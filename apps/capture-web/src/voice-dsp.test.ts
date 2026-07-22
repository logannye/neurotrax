import { describe, expect, it } from "vitest";
import {
  BoundedPcmRingBuffer,
  analyzeVoiceWindow
} from "./voice-dsp.js";

function sine(
  frequencyHz: number,
  sampleRateHz: number,
  durationMs = 40,
  amplitude = 0.1
): Float32Array {
  return Float32Array.from(
    { length: Math.round((sampleRateHz * durationMs) / 1000) },
    (_, index) =>
      amplitude *
      Math.sin((2 * Math.PI * frequencyHz * index) / sampleRateHz)
  );
}

describe("continuous voice DSP", () => {
  it.each([50, 80, 220, 440, 700])(
    "estimates %d Hz inside the supported broad range",
    (frequency) => {
      const result = analyzeVoiceWindow(
        sine(frequency, 48_000),
        48_000,
        null
      );
      expect(result.f0Hz).not.toBeNull();
      expect(
        Math.abs(result.f0Hz! - frequency) / frequency
      ).toBeLessThan(0.06);
      expect(result.f0Confidence).toBeGreaterThan(0.4);
    }
  );

  it("abstains pitch for silence without inventing synthetic speech", () => {
    const result = analyzeVoiceWindow(
      new Float32Array(1_920),
      48_000,
      null
    );
    expect(result.f0Hz).toBeNull();
    expect(result.rms).toBe(0);
  });

  it("detects clipping and DC offset", () => {
    const samples = sine(220, 48_000, 40, 1);
    for (let index = 0; index < samples.length; index += 1) {
      samples[index] += 0.04;
    }
    const result = analyzeVoiceWindow(samples, 48_000, null);
    expect(result.clippedSampleFraction).toBeGreaterThan(0);
    expect(result.dcOffset).toBeGreaterThan(0.03);
  });

  it("matches analytic periodic-signal references within engineering tolerances", () => {
    const result = analyzeVoiceWindow(
      sine(220, 48_000, 40, 0.1),
      48_000,
      null
    );
    expect(result.rms).toBeCloseTo(0.1 / Math.sqrt(2), 2);
    expect(result.f0Hz).toBeCloseTo(220, -1);
    expect(result.estimatorAgreement).toBeGreaterThan(0.7);
  });

  it("retains only bounded pitch, quality, and acoustic-nucleus primitives", () => {
    const first = analyzeVoiceWindow(sine(220, 48_000), 48_000);
    const changed = analyzeVoiceWindow(
      sine(330, 48_000),
      48_000,
      first.bandEnergies
    );
    expect(changed.spectralFlux).toBeGreaterThanOrEqual(0);
    expect(Object.keys(changed).sort()).toEqual([
      "bandEnergies",
      "clippedSampleFraction",
      "dcOffset",
      "estimatorAgreement",
      "f0Confidence",
      "f0Hz",
      "rms",
      "spectralFlux"
    ]);
  });

  it("keeps the PCM ring strictly bounded and ordered", () => {
    const ring = new BoundedPcmRingBuffer(5);
    ring.push(Float32Array.from([1, 2, 3]));
    ring.push(Float32Array.from([4, 5, 6, 7]));
    expect(ring.availableSamples()).toBe(5);
    expect([...ring.latest(5)!]).toEqual([3, 4, 5, 6, 7]);
    expect([...ring.endingBeforeLatest(3, 2)!]).toEqual([3, 4, 5]);
    expect(ring.latest(6)).toBeNull();
    ring.clear();
    expect(ring.availableSamples()).toBe(0);
  });
});
