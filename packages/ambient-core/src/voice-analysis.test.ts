import { describe, expect, it } from "vitest";
import type {
  MeasurementContextKind,
  MeasurableWindow
} from "@phenometric/contracts";
import { syntheticSpeechConfounds, syntheticVoiceFrame } from "./test-helpers.js";
import { extractVoiceMeasurements } from "./voice-analysis.js";

function frames(
  taskContext:
    | "sustained-vowel-1"
    | "rapid-syllables"
    | "spontaneous-response",
  durationMs: number
) {
  return Array.from(
    { length: Math.floor(durationMs / 10) + 1 },
    (_, index) =>
      syntheticVoiceFrame(index * 10, {
        taskContext,
        f0Hz: 180 + Math.sin(index / 20) * 4,
        intensityDbfs: -22 + Math.sin(index / 15),
        cppsDb: 14 + Math.sin(index / 25),
        hnrDb: 22 + Math.sin(index / 30),
        jitterLocal: 0.008 + (index % 3) * 0.001,
        shimmerLocal: 0.025 + (index % 4) * 0.001,
        syllabicNucleus:
          taskContext === "rapid-syllables" && index % 35 === 0
      })
  );
}

function windowFor(
  kind: MeasurementContextKind,
  durationMs: number
): MeasurableWindow {
  return {
    windowId: `speech-${kind}`,
    modality: "speech",
    startMs: 0,
    endMs: durationMs,
    context: {
      kind,
      confounds: syntheticSpeechConfounds()
    }
  };
}

describe("extractVoiceMeasurements", () => {
  it("emits shared and sustained-vowel measurements independently", () => {
    const result = extractVoiceMeasurements(
      windowFor("sustained-vowel", 3_000),
      frames("sustained-vowel-1", 3_000)
    );
    const codes = new Set(
      result.measurements.map((measurement) => measurement.code)
    );
    expect(codes).toContain("prototype.voice.f0.median");
    expect(codes).toContain("prototype.voice.cpps");
    expect(codes).toContain("prototype.voice.jitter.local");
    expect(codes).toContain("prototype.voice.shimmer.local");
    expect(codes).toContain("prototype.voice.formant.f1_median");
    expect(
      result.measurements.every(
        (measurement) =>
          measurement.algorithmVersion === "voice-analysis-1.0" &&
          measurement.clinicalValidation === "none"
      )
    ).toBe(true);
  });

  it("emits DDK estimates only for rapid syllables", () => {
    const result = extractVoiceMeasurements(
      windowFor("rapid-syllables", 4_000),
      frames("rapid-syllables", 4_000)
    );
    expect(
      result.measurements.find(
        (measurement) => measurement.code === "prototype.voice.ddk.rate"
      )?.value
    ).toBeGreaterThan(2);
    expect(
      result.measurements.find(
        (measurement) =>
          measurement.code ===
          "prototype.voice.ddk.interval_variability"
      )?.value
    ).toBeGreaterThanOrEqual(0);
    expect(
      result.measurements.find(
        (measurement) =>
          measurement.code ===
          "prototype.voice.ddk.interval_variability"
      )?.uncertainty
    ).toEqual(
      expect.objectContaining({
        kind: "not-estimated",
        reason: expect.stringContaining("500 ms")
      })
    );
    expect(
      result.measurements.some(
        (measurement) =>
          measurement.code === "prototype.voice.jitter.local"
      )
    ).toBe(false);
  });

  it("computes spontaneous onset from task start and marks it not estimated", () => {
    const source = frames("spontaneous-response", 8_000).map(
      (frame, index) =>
        index < 50
          ? {
              ...frame,
              voiced: false,
              f0Hz: null,
              f0Confidence: 0
            }
          : frame
    );
    const result = extractVoiceMeasurements(
      windowFor("spontaneous-speech", 8_000),
      source,
      0
    );
    const onset = result.measurements.find(
      (measurement) =>
        measurement.code === "prototype.voice.onset_latency"
    );
    expect(onset?.value).toBeCloseTo(0.5, 2);
    expect(onset?.uncertainty.kind).toBe("not-estimated");
  });

  it("withholds fine acoustic metrics without suppressing timing metrics", () => {
    const processed = frames("sustained-vowel-1", 3_000).map(
      (frame) => ({
        ...frame,
        browserProcessing: {
          echoCancellation: true,
          noiseSuppression: false,
          autoGainControl: false
        },
        qualityReasons: ["audio-processing-enabled" as const]
      })
    );
    const result = extractVoiceMeasurements(
      windowFor("sustained-vowel", 3_000),
      processed
    );
    expect(
      result.measurements.some(
        (measurement) =>
          measurement.code === "prototype.voice.voiced_fraction"
      )
    ).toBe(true);
    expect(
      result.abstentions.map((item) => item.measurementCodes?.[0])
    ).toEqual(
      expect.arrayContaining([
        "prototype.voice.cpps",
        "prototype.voice.hnr",
        "prototype.voice.intensity.variability",
        "prototype.voice.jitter.local",
        "prototype.voice.shimmer.local"
      ])
    );
  });

  it("contains no PCM or native audio arrays in extractor output", () => {
    const serialized = JSON.stringify(
      extractVoiceMeasurements(
        windowFor("sustained-vowel", 3_000),
        frames("sustained-vowel-1", 3_000)
      )
    );
    expect(serialized).not.toMatch(
      /pcm|waveform|pitchCycle|fft|cepstr|mfcc|spectrogram|embedding|voiceprint|deviceId|deviceLabel/
    );
  });
});
