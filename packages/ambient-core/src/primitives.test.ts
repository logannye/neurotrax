import { describe, expect, it } from "vitest";
import type { FrameStream } from "./primitives.js";

describe("primitive frame types", () => {
  it("models a frame stream with synchronized audio and face frames", () => {
    const stream: FrameStream = {
      visitId: "visit-001",
      participantId: "synthetic-participant-001",
      captureMode: "fixture-playback",
      audio: [
        { tMs: 0, voiced: true, rms: 0.4, pitchHz: 120, clipped: false, snrDb: 20 }
      ],
      face: [
        {
          tMs: 0,
          faceVisible: true,
          framingFraction: 0.95,
          illumination: 0.8,
          eyeAspectRatio: 0.3,
          browRaise: 0.2,
          mouthOpen: 0.1,
          landmarkMotion: 0.05,
          observedFrameRate: 30
        }
      ]
    };
    expect(stream.audio[0].voiced).toBe(true);
    expect(stream.face[0].framingFraction).toBeGreaterThan(0.9);
  });
});
