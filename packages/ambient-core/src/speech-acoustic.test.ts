import { describe, expect, it } from "vitest";
import { extractSpeechAcoustic, SPEECH_ACOUSTIC_VERSION } from "./speech-acoustic.js";
import type { AudioFeatureFrame } from "./primitives.js";
import type { Abstention, MeasurableWindow, Measurement } from "@neurotrax/contracts";

const window: MeasurableWindow = {
  windowId: "w-speech-1",
  modality: "speech",
  startMs: 0,
  endMs: 500,
  context: {
    kind: "spontaneous-speech",
    confounds: { snrDb: 20, faceFramingFraction: 1, observedFrameRate: 30, illuminationRelative: 0.8 }
  }
};

function frame(tMs: number, voiced: boolean, pitchHz: number | null, snrDb = 20): AudioFeatureFrame {
  return { tMs, voiced, rms: voiced ? 0.4 : 0.02, pitchHz, clipped: false, snrDb };
}

describe("extractSpeechAcoustic", () => {
  it("emits three measurements over a clean voiced window", () => {
    const frames = [
      frame(0, true, 120), frame(100, true, 130), frame(200, false, null),
      frame(300, true, 110), frame(400, true, 140)
    ];
    const result = extractSpeechAcoustic(window, frames) as Measurement[];
    expect(Array.isArray(result)).toBe(true);
    const byCode = new Map(result.map((m) => [m.code, m]));
    expect(byCode.get("prototype.speech.articulation_rate")!.value).toBeCloseTo(0.8, 5);
    expect(byCode.get("prototype.speech.pause_count")!.value).toBe(1);
    expect(byCode.get("prototype.speech.pitch_variability")!.value).toBeGreaterThan(0);
    for (const m of result) {
      expect(m.algorithmVersion).toBe(SPEECH_ACOUSTIC_VERSION);
      expect(m.uncertainty).toBe("placeholder");
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
});
