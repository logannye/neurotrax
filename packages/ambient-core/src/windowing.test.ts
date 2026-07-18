import { describe, expect, it } from "vitest";
import { detectMeasurableWindows } from "./windowing.js";
import type { FrameStream } from "./primitives.js";

function stream(partial: Partial<FrameStream>): FrameStream {
  return {
    visitId: "visit-001",
    participantId: "synthetic-participant-001",
    captureMode: "fixture-playback",
    audio: [],
    face: [],
    ...partial
  };
}

describe("detectMeasurableWindows", () => {
  it("finds one speech window from a contiguous voiced run", () => {
    const audio = Array.from({ length: 20 }, (_, i) => ({
      tMs: i * 100, voiced: true, rms: 0.4, pitchHz: 120, clipped: false, snrDb: 20
    }));
    const windows = detectMeasurableWindows(stream({ audio }));
    expect(windows).toHaveLength(1);
    expect(windows[0].modality).toBe("speech");
    expect(windows[0].context.kind).toBe("spontaneous-speech");
    expect(windows[0].endMs - windows[0].startMs).toBeGreaterThanOrEqual(1500);
    expect(windows[0].context.confounds.snrDb).toBeCloseTo(20, 5);
  });

  it("ignores a voiced run shorter than the minimum window", () => {
    const audio = Array.from({ length: 5 }, (_, i) => ({
      tMs: i * 100, voiced: true, rms: 0.4, pitchHz: 120, clipped: false, snrDb: 20
    }));
    expect(detectMeasurableWindows(stream({ audio }))).toHaveLength(0);
  });

  it("finds a face window from a contiguous visible run", () => {
    const face = Array.from({ length: 20 }, (_, i) => ({
      tMs: i * 100, faceVisible: true, framingFraction: 0.9, illumination: 0.8,
      eyeAspectRatio: 0.3, browRaise: 0.2, mouthOpen: 0.1, landmarkMotion: 0.05, observedFrameRate: 30
    }));
    const windows = detectMeasurableWindows(stream({ face }));
    expect(windows).toHaveLength(1);
    expect(windows[0].modality).toBe("face");
    expect(windows[0].context.kind).toBe("listening-expressive");
  });
});
