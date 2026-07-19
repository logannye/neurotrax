import { describe, expect, it } from "vitest";
import {
  FACE_LANDMARKER_MODEL_SHA256,
  MEDIAPIPE_TASKS_VISION_VERSION,
  VISUAL_WORKER_MESSAGE_VERSION,
  createVideoCaptureSettings,
  createVisualWorkerInitializeMessage,
  visualPipelineProvenance
} from "./face-worker-protocol.js";

describe("visual worker protocol", () => {
  it("reports pinned runtime, model, geometry, and delegate provenance", () => {
    const provenance = visualPipelineProvenance("GPU");

    expect(provenance).toMatchObject({
      runtime: "mediapipe-tasks-vision",
      mediaPipeVersion: MEDIAPIPE_TASKS_VISION_VERSION,
      modelAsset: "/models/face_landmarker.task",
      modelSha256: FACE_LANDMARKER_MODEL_SHA256,
      delegate: "GPU",
      geometryVersion: "bilateral-geometry-v1"
    });
    expect(provenance.processorRef).toContain("gpu");
  });

  it("constructs privacy-safe unmirrored capture settings", () => {
    const settings = createVideoCaptureSettings({
      width: 960,
      height: 540,
      frameRate: 29.97,
      facingMode: "user"
    });
    const message = createVisualWorkerInitializeMessage(3, settings);

    expect(message).toEqual({
      schemaVersion: VISUAL_WORKER_MESSAGE_VERSION,
      type: "initialize",
      captureEpoch: 3,
      videoCaptureSettings: {
        requested: { width: 1280, height: 720, frameRate: 30 },
        actual: { width: 960, height: 540, frameRate: 29.97 },
        facingMode: "user",
        coordinateSpace: "normalized-unmirrored-image",
        displayMirrored: true,
        lateralityConvention: "subject-anatomical"
      }
    });
    expect(JSON.stringify(message)).not.toMatch(
      /deviceId|groupId|label/i
    );
  });
});
