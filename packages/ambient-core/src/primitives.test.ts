import { describe, expect, it } from "vitest";
import { syntheticFacialFrame, syntheticFrameStream } from "./test-helpers.js";

describe("primitive frame types", () => {
  it("models a versioned stream of compact, anatomical facial kinematics", () => {
    const frame = syntheticFacialFrame(0, "neutral-face");
    const stream = syntheticFrameStream({
      audio: [
        {
          tMs: 0,
          voiced: true,
          rms: 0.4,
          pitchHz: 120,
          clipped: false,
          snrDb: 20
        }
      ],
      face: [frame]
    });

    expect(stream.schemaVersion).toBe("phenometric.frame-stream.v1");
    expect(frame.schemaVersion).toBe(
      "phenometric.facial-kinematics-frame.v1"
    );
    expect(frame.anatomicalLaterality).toBe("subject-anatomical");
    expect(frame.eyeAperture?.left).toBe(0.3);
    expect(JSON.stringify(stream)).not.toMatch(
      /faceLandmarks|meshConnections|overlayPixels|offscreenCanvas|screenshot|blendshapes|transformationMatrix|deviceId|deviceLabel/
    );
  });
});
