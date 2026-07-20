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
    expect(result.hnrDb).toBeGreaterThan(20);
    expect(result.cppsDb).toBeGreaterThan(10);
    expect(result.jitterLocal).not.toBeNull();
    expect(result.jitterLocal!).toBeLessThan(0.002);
    expect(result.shimmerLocal).not.toBeNull();
    expect(result.shimmerLocal!).toBeLessThan(0.01);
  });

  it("recovers generated vowel-like LPC resonances with broad reference tolerances", () => {
    const sampleRate = 48_000;
    const f0 = 120;
    const samples = Float32Array.from(
      { length: Math.round(sampleRate * 0.04) },
      (_, index) => {
        let value = 0;
        for (let harmonic = 1; harmonic * f0 < 4_000; harmonic += 1) {
          const hz = harmonic * f0;
          const weight =
            Math.exp(-Math.pow((hz - 700) / 180, 2)) +
            0.8 * Math.exp(-Math.pow((hz - 1_200) / 220, 2));
          value +=
            weight *
            Math.sin((2 * Math.PI * hz * index) / sampleRate);
        }
        return value * 0.03;
      }
    );
    const result = analyzeVoiceWindow(samples, sampleRate, null);
    expect(result.f0Hz).toBeCloseTo(120, -1);
    expect(result.formantF1Hz).toBeGreaterThanOrEqual(500);
    expect(result.formantF1Hz).toBeLessThanOrEqual(900);
    expect(result.formantF2Hz).toBeGreaterThanOrEqual(1_000);
    expect(result.formantF2Hz).toBeLessThanOrEqual(1_500);
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
