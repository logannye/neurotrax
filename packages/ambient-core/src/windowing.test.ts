import { describe, expect, it } from "vitest";
import { detectMeasurableWindows } from "./windowing.js";
import {
  syntheticFacialFrame,
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

  it("clips guided visual windows to only the final accepted intervals", () => {
    const face = [
      ...syntheticTaskFrames("neutral-face", 0),
      ...syntheticTaskFrames("neutral-face", 2_000),
      ...syntheticTaskFrames("smile", 4_000),
      ...syntheticTaskFrames("smile", 6_000),
      ...syntheticTaskFrames("eye-closure", 8_000)
    ];

    const windows = detectMeasurableWindows(syntheticFrameStream({ face }), {
      guidedTaskEvidenceIntervals: [
        {
          taskContext: "neutral-face",
          startMs: 2_050,
          endMs: 3_550
        },
        {
          taskContext: "smile",
          startMs: 6_050,
          endMs: 7_550
        },
        {
          taskContext: "eye-closure",
          startMs: 8_050,
          endMs: 9_550
        }
      ]
    });

    expect(
      windows.map(({ startMs, endMs, context }) => ({
        startMs,
        endMs,
        kind: context.kind
      }))
    ).toEqual([
      { startMs: 2_050, endMs: 3_550, kind: "neutral-face" },
      { startMs: 6_050, endMs: 7_550, kind: "smile" },
      { startMs: 8_050, endMs: 9_550, kind: "eye-closure" }
    ]);
  });

  it("accepts an exact 1500ms guided interval sampled every 34ms", () => {
    const face = Array.from({ length: 45 }, (_, index) => {
      const tMs = index * 34;
      return syntheticFacialFrame(tMs, "neutral-face", {
        sequence: index,
        analyzedFrameRate: 1_000 / 34,
        interResultGapMs: index === 0 ? null : 34
      });
    });

    const windows = detectMeasurableWindows(syntheticFrameStream({ face }), {
      guidedTaskEvidenceIntervals: [
        {
          taskContext: "neutral-face",
          startMs: 0,
          endMs: 1_500
        }
      ]
    });

    expect(face.at(-1)?.tMs).toBe(1_496);
    expect(windows).toEqual([
      expect.objectContaining({
        modality: "face",
        startMs: 0,
        endMs: 1_500,
        context: expect.objectContaining({ kind: "neutral-face" })
      })
    ]);
  });

  it("preserves all usable task runs when guided intervals are omitted", () => {
    const face = [
      ...syntheticTaskFrames("neutral-face", 0),
      ...syntheticTaskFrames("neutral-face", 2_000)
    ];

    expect(
      detectMeasurableWindows(syntheticFrameStream({ face }))
        .filter((window) => window.modality === "face")
        .map((window) => window.startMs)
    ).toEqual([0, 2_000]);
  });
});
