import { describe, expect, it } from "vitest";
import { detectMeasurableWindows } from "./windowing.js";
import {
  syntheticFrameStream,
  syntheticTaskFrames
} from "./test-helpers.js";

describe("detectMeasurableWindows", () => {
  it("preserves bounded pauses inside a speech window", () => {
    const audio = Array.from({ length: 30 }, (_, index) => ({
      tMs: index * 100,
      voiced: index < 8 || index >= 18,
      rms: index >= 8 && index < 18 ? 0.03 : 0.4,
      pitchHz: index >= 8 && index < 18 ? null : 120,
      clipped: false,
      snrDb: 20
    }));

    const windows = detectMeasurableWindows(
      syntheticFrameStream({ audio })
    );

    expect(windows).toHaveLength(1);
    expect(windows[0]).toMatchObject({
      modality: "speech",
      startMs: 0,
      endMs: 2900,
      context: {
        kind: "spontaneous-speech",
        confounds: { kind: "speech", snrDb: 20 }
      }
    });
  });

  it("splits visual windows at every task transition", () => {
    const face = [
      ...syntheticTaskFrames("neutral-face", 0),
      ...syntheticTaskFrames("smile", 2_000),
      ...syntheticTaskFrames("eye-closure", 4_000)
    ];

    const windows = detectMeasurableWindows(
      syntheticFrameStream({ face })
    );

    expect(windows.map((window) => window.context.kind)).toEqual([
      "neutral-face",
      "smile",
      "eye-closure"
    ]);
    expect(windows[0].context.confounds).toMatchObject({
      kind: "visual",
      analyzedFrameRate: 30,
      faceBoxWidthPixels: 384
    });
  });

  it("splits a task at a visual gap over 200ms", () => {
    const face = [
      ...syntheticTaskFrames("neutral-face", 0),
      ...syntheticTaskFrames("neutral-face", 2_000)
    ];

    const windows = detectMeasurableWindows(
      syntheticFrameStream({ face })
    );

    expect(windows).toHaveLength(2);
  });

  it("withholds only the poor-quality visual run", () => {
    const face = [
      ...syntheticTaskFrames("neutral-face", 0),
      ...syntheticTaskFrames("smile", 2_000, () => ({
        analyzedFrameRate: 10
      }))
    ];

    const windows = detectMeasurableWindows(
      syntheticFrameStream({ face })
    );

    expect(windows.map((window) => window.context.kind)).toEqual([
      "neutral-face"
    ]);
  });
});
