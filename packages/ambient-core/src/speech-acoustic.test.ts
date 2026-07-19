import { describe, expect, it } from "vitest";
import {
  countBoundedPauses,
  extractSpeechAcoustic,
  SPEECH_ACOUSTIC_VERSION
} from "./speech-acoustic.js";
import type { AudioFeatureFrame } from "./primitives.js";
import type { Abstention, MeasurableWindow, Measurement } from "@phenometric/contracts";

const window: MeasurableWindow = {
  windowId: "w-speech-1",
  modality: "speech",
  startMs: 0,
  endMs: 500,
  context: {
    kind: "spontaneous-speech",
    confounds: {
      kind: "speech",
      snrDb: 20,
      clippingFraction: 0
    }
  }
};

function frame(tMs: number, voiced: boolean, pitchHz: number | null, snrDb = 20): AudioFeatureFrame {
  return { tMs, voiced, rms: voiced ? 0.4 : 0.02, pitchHz, clipped: false, snrDb };
}

describe("extractSpeechAcoustic", () => {
  it("emits speech timing and pitch measurements over a clean voiced window", () => {
    const frames = Array.from({ length: 12 }, (_, index) =>
      frame(index * 100, index !== 5, 110 + (index % 5) * 8)
    );
    const result = extractSpeechAcoustic(
      { ...window, endMs: 1100 },
      frames
    ) as Measurement[];
    expect(Array.isArray(result)).toBe(true);
    const byCode = new Map(result.map((m) => [m.code, m]));
    expect(byCode.get("prototype.speech.voiced_time_fraction")!.value).toBeCloseTo(11 / 12, 5);
    expect(byCode.get("prototype.speech.pause_rate")!.value).toBe(0);
    expect(byCode.get("prototype.speech.pitch_center")!.value).toBeGreaterThan(
      100
    );
    expect(byCode.get("prototype.speech.pitch_variability")!.value).toBeGreaterThan(0);
    for (const m of result) {
      expect(m.algorithmVersion).toBe(SPEECH_ACOUSTIC_VERSION);
      expect(m.uncertainty.kind).toBe("not-estimated");
      expect(m.processorRef).toBe(SPEECH_ACOUSTIC_VERSION);
      expect(m.sourceWindowRefs).toEqual([window.windowId]);
      expect(m.clinicalValidation).toBe("none");
      expect(m.contextRef).toBe(window.windowId);
    }
  });

  it("abstains on a low-SNR window", () => {
    const frames = [frame(0, true, 120, 4), frame(100, true, 130, 4), frame(200, true, 110, 4)];
    const result = extractSpeechAcoustic(window, frames) as Abstention;
    expect("reasonCode" in result).toBe(true);
    expect(result.reasonCode).toBe("snr-too-low");
  });

  it("abstains when there are too few voiced frames", () => {
    const frames = [frame(0, true, 120), frame(100, false, null)];
    const result = extractSpeechAcoustic(window, frames) as Abstention;
    expect(result.reasonCode).toBe("insufficient-voiced-frames");
  });

  it("counts only pauses lasting between 300 and 2000 milliseconds", () => {
    const frames = [
      frame(0, true, 120),
      frame(100, true, 121),
      frame(200, true, 119),
      frame(300, false, null),
      frame(400, false, null),
      frame(500, false, null),
      frame(600, true, 122),
      frame(700, true, 120)
    ];
    const result = extractSpeechAcoustic(
      { ...window, endMs: 700 },
      frames
    ) as Measurement[];
    expect(
      new Map(result.map((measurement) => [measurement.code, measurement]))
        .get("prototype.speech.pause_rate")!.value
    ).toBeGreaterThan(0);
  });

  it("excludes pauses shorter than 300 ms and longer than 2000 ms", () => {
    const shortPause = [
      frame(0, true, 120),
      frame(100, false, null),
      frame(200, false, null),
      frame(300, true, 121)
    ];
    const longPause = [
      frame(0, true, 120),
      ...Array.from({ length: 21 }, (_, index) =>
        frame((index + 1) * 100, false, null)
      ),
      frame(2200, true, 121)
    ];

    expect(countBoundedPauses(shortPause)).toBe(0);
    expect(countBoundedPauses(longPause)).toBe(0);
  });

  it("reduces confidence when clipping is present", () => {
    const cleanFrames = Array.from({ length: 12 }, (_, index) =>
      frame(index * 100, true, 120 + (index % 3) * 4)
    );
    const clippedFrames = cleanFrames.map((item, index) => ({
      ...item,
      clipped: index < 6
    }));
    const clean = extractSpeechAcoustic(
      { ...window, endMs: 1100 },
      cleanFrames
    ) as Measurement[];
    const clipped = extractSpeechAcoustic(
      { ...window, endMs: 1100 },
      clippedFrames
    ) as Measurement[];
    const confidenceFor = (measurements: Measurement[]) =>
      measurements.find(
        (measurement) =>
          measurement.code ===
          "prototype.speech.pitch_variability"
      )!.confidence;

    expect(confidenceFor(clipped)).toBeLessThan(confidenceFor(clean));
  });
});
