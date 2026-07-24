import { describe, expect, it } from "vitest";
import {
  syntheticFacialFrame,
  syntheticVoiceFrame
} from "./test-helpers.js";

describe("primitive frame types", () => {
  it("models compact ambient signal frames without native media", () => {
    const face = syntheticFacialFrame(0, "ambient-frontal", {
      faceCount: 1,
      trackSegmentId: "face-track-1"
    });
    const voice = syntheticVoiceFrame(0, {
      speechActive: true,
      periodic: true,
      trackSegmentId: "audio-track-1"
    });

    expect(face.schemaVersion).toBe(
      "phenometric.facial-kinematics-frame.v1"
    );
    expect(voice.schemaVersion).toBe("phenometric.voice-signal-frame.v1");
    expect(face.anatomicalLaterality).toBe("subject-anatomical");
    expect(face.eyeAperture?.left).toBe(0.3);
    expect(voice.speechActive).toBe(true);
    expect(voice.periodic).toBe(true);
    expect(JSON.stringify({ face, voice })).not.toMatch(
      /faceLandmarks|meshConnections|overlayPixels|offscreenCanvas|screenshot|blendshapes|transformationMatrix|deviceId|deviceLabel/
    );
  });
});
