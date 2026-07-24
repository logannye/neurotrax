import { describe, expect, it } from "vitest";
import {
  isCurrentVoiceWorkerResponse,
  VOICE_WORKER_MESSAGE_VERSION
} from "./voice-worker-protocol.js";

describe("voice worker response guard", () => {
  it("accepts only the current capture epoch", () => {
    const response = {
      schemaVersion: VOICE_WORKER_MESSAGE_VERSION,
      type: "disposed",
      captureEpoch: 4,
      diagnostics: {
        receivedBlockCount: 0,
        processedFrameCount: 0,
        lostBlockCount: 0,
        lostBlockFraction: 0,
        maximumBlockGapMs: 0,
        p95FeatureLatencyMs: 0,
        timestampRegressionCount: 0,
        ringBufferCapacitySamples: 0
      }
    };
    expect(isCurrentVoiceWorkerResponse(response, 4)).toBe(true);
    expect(isCurrentVoiceWorkerResponse(response, 5)).toBe(false);
  });

  it("rejects unversioned or malformed messages", () => {
    expect(
      isCurrentVoiceWorkerResponse(
        { captureEpoch: 2, type: "signal-frame" },
        2
      )
    ).toBe(false);
    expect(isCurrentVoiceWorkerResponse(null, 2)).toBe(false);
  });
});
