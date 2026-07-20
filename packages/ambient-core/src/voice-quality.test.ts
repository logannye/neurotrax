import { describe, expect, it } from "vitest";
import { syntheticVoiceFrame } from "./test-helpers.js";
import {
  browserAudioProcessingEnabled,
  evaluateVoiceQuality
} from "./voice-quality.js";

describe("evaluateVoiceQuality", () => {
  it("accepts a continuous 48 kHz unprocessed signal", () => {
    expect(evaluateVoiceQuality(syntheticVoiceFrame(0))).toEqual({
      timingUsable: true,
      generalMeasurementUsable: true,
      fineAcousticUsable: true,
      reasonCodes: []
    });
  });

  it.each([
    ["audio-frame-gap", { blockGapMs: 40.1 }],
    ["audio-frame-gap", { lostBlockFraction: 0.051 }],
    ["sample-rate-below-minimum", { sampleRateHz: 44_099 }],
    ["snr-below-minimum", { snrDb: 14.99 }],
    ["signal-too-quiet", { rms: 0.00299 }],
    ["audio-clipping", { clippedSampleFraction: 0.0101 }],
    ["dc-offset", { dcOffset: -0.0201 }]
  ] as const)("reports %s at its strict boundary", (reason, overrides) => {
    expect(
      evaluateVoiceQuality(
        syntheticVoiceFrame(0, overrides)
      ).reasonCodes
    ).toContain(reason);
  });

  it("allows timing but withholds fine acoustics when browser processing is active", () => {
    const result = evaluateVoiceQuality(
      syntheticVoiceFrame(0, {
        browserProcessing: {
          echoCancellation: true,
          noiseSuppression: false,
          autoGainControl: false
        }
      })
    );
    expect(result.timingUsable).toBe(true);
    expect(result.generalMeasurementUsable).toBe(true);
    expect(result.fineAcousticUsable).toBe(false);
    expect(result.reasonCodes).toContain("audio-processing-enabled");
  });

  it("recognizes every browser processing control", () => {
    expect(
      browserAudioProcessingEnabled({
        echoCancellation: false,
        noiseSuppression: true,
        autoGainControl: false
      })
    ).toBe(true);
    expect(
      browserAudioProcessingEnabled({
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: true
      })
    ).toBe(true);
  });
});
