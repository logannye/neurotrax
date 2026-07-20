import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createConductorSession, runConductor } from "./conductor.js";
import type { FrameStream } from "./primitives.js";
import {
  syntheticFacialFrame,
  syntheticFrameStream,
  syntheticVoiceFrame,
  syntheticTaskFrames
} from "./test-helpers.js";

function loadFixture(): FrameStream {
  const path = fileURLToPath(
    new URL("../fixtures/synthetic-visit.frames.json", import.meta.url)
  );
  return JSON.parse(readFileSync(path, "utf8")) as FrameStream;
}

describe("runConductor", () => {
  it("produces only the six corrected facial measurements for the facial protocol", () => {
    const stream = loadFixture();
    const { observation, events } = runConductor(stream, {
      baseTimeMs: Date.parse("2026-07-18T16:00:00.000Z")
    });

    expect(observation).toMatchObject({
      schemaVersion: "phenometric.encounter-observation.v2",
      containsPHI: false,
      rawMediaRetained: false,
      nativeVisualObservationsRetained: false,
      measurementCount: 6
    });
    expect(observation.measurements).toHaveLength(6);
    expect(observation.aggregates.map((aggregate) => aggregate.code)).toEqual([
      "prototype.face.eye_closure_fraction.asymmetry",
      "prototype.face.eye_closure_fraction.left",
      "prototype.face.eye_closure_fraction.right",
      "prototype.face.smile_excursion.asymmetry",
      "prototype.face.smile_excursion.left",
      "prototype.face.smile_excursion.right"
    ]);
    expect(
      observation.measurements.filter((measurement) =>
        measurement.code.startsWith("prototype.face.")
      )
    ).toSatisfy((measurements: typeof observation.measurements) =>
      measurements.every(
        (measurement) =>
          measurement.sourceWindowRefs.length === 2 &&
          measurement.uncertainty.kind === "estimated"
      )
    );
    expect(observation.visualPipeline?.processorRef).toContain("mediapipe");
    expect(JSON.stringify({ observation, events })).not.toMatch(
      /faceLandmarks|meshConnections|overlayPixels|offscreenCanvas|screenshot|blendshapes|transformationMatrix|deviceId|deviceLabel/
    );

    expect(events[0].type).toBe("consent.recorded");
    expect(events.at(-1)?.type).toBe("encounter-observation.created");
    events.forEach((event, index) =>
      expect(event.sequence).toBe(index + 1)
    );
  });

  it("is deterministic for identical input and clock", () => {
    const options = {
      baseTimeMs: Date.parse("2026-07-18T16:00:00.000Z")
    };
    expect(JSON.stringify(runConductor(loadFixture(), options))).toBe(
      JSON.stringify(runConductor(loadFixture(), options))
    );
  });

  it("abstains only a poor-quality visual task while voice gating remains non-measuring", () => {
    const stream = loadFixture();
    const degraded = {
      ...stream,
      face: stream.face.map((frame) =>
        frame.taskContext === "smile"
          ? { ...frame, analyzedFrameRate: 10 }
          : frame
      )
    };
    const { observation, events } = runConductor(degraded, {
      baseTimeMs: 0
    });

    expect(
      observation.measurements.some(
        (measurement) =>
          measurement.code === "prototype.face.smile_excursion.left"
      )
    ).toBe(false);
    expect(
      observation.measurements.some((measurement) =>
        measurement.code.startsWith(
          "prototype.face.eye_closure_fraction."
        )
      )
    ).toBe(true);
    expect(
      observation.measurements.some((measurement) =>
        measurement.code.startsWith("prototype.voice.")
      )
    ).toBe(false);
    expect(observation.abstentions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          modality: "face",
          contextKind: "smile",
          reasonCode: "insufficient-task-evidence"
        })
      ])
    );
    expect(
      events.some(
        (event) =>
          event.type === "measurement.abstained" &&
          event.actor.id === "facial-expressivity"
      )
    ).toBe(true);
  });

  it("rejects a stream that is not explicitly non-PHI", () => {
    const unsafe = {
      ...loadFixture(),
      containsPHI: true
    } as unknown as FrameStream;
    expect(() => runConductor(unsafe)).toThrow(
      /explicitly marked containsPHI: false/
    );
  });

  it("immediately withholds an unavailable visual lane without stopping speech", () => {
    const { audio: _audio, face: _face, ...identity } =
      syntheticFrameStream();
    const session = createConductorSession(identity, { baseTimeMs: 0 });

    for (let tMs = 0; tMs <= 5_000; tMs += 100) {
      session.ingestAudio(
        syntheticVoiceFrame(tMs, {
          taskContext: "natural-speech-check",
          f0Hz: 120 + (tMs % 400) / 100
        })
      );
    }
    for (const frame of syntheticTaskFrames("neutral-face", 0)) {
      session.ingestFace(frame);
    }
    session.ingestVisualWithholding({
      tMs: 1_625,
      reasonCode: "worker-unavailable",
      taskContext: "turn-away"
    });
    session.ingestVisualWithholding({
      tMs: 1_630,
      reasonCode: "worker-unavailable",
      taskContext: "turn-away"
    });
    for (const frame of syntheticTaskFrames("neutral-face", 1_650)) {
      session.ingestFace(frame);
    }

    const { observation, events } = session.complete();
    const faceWithheldEvents = events.filter(
      (event) =>
        event.type === "capture.quality.changed" &&
        event.payload.modality === "face" &&
        event.payload.quality === "withheld"
    );
    expect(faceWithheldEvents).toHaveLength(1);
    expect(faceWithheldEvents[0].payload.reasonCode).toBe(
      "worker-unavailable"
    );
    expect(
      observation.windows.filter((window) => window.modality === "face")
    ).toHaveLength(2);
    expect(observation.qualitySummary.audioFrameCount).toBeGreaterThan(0);
    expect(
      events.some(
        (event) =>
          event.type === "measurement.recorded" &&
          event.actor.id === "voice-analysis"
      )
    ).toBe(false);
    expect(observation.abstentions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          modality: "face",
          reasonCode: "worker-unavailable"
        })
      ])
    );
  });

  it("debounces sustained frame quality failures into one transition", () => {
    const { audio: _audio, face: _face, ...identity } =
      syntheticFrameStream();
    const session = createConductorSession(identity, { baseTimeMs: 0 });
    for (const frame of syntheticTaskFrames("neutral-face", 0)) {
      session.ingestFace(frame);
    }
    for (let index = 0; index < 20; index += 1) {
      const tMs = 1_650 + index * 50;
      session.ingestFace(
        syntheticFacialFrame(tMs, "neutral-face", {
          pose: { yawDegrees: 16, pitchDegrees: 0, rollDegrees: 0 }
        })
      );
    }
    const changes = session
      .getEvents()
      .filter(
        (event) =>
          event.type === "capture.quality.changed" &&
          event.payload.modality === "face"
      );
    expect(
      changes.filter((event) => event.payload.quality === "withheld")
    ).toHaveLength(1);
    expect(changes.at(-1)?.payload.reasonCode).toBe("pose-out-of-range");
  });

  it("replaces guided evidence snapshots and excludes failed task attempts", () => {
    const { audio: _audio, face: _face, ...identity } =
      syntheticFrameStream();
    const session = createConductorSession(identity, { baseTimeMs: 0 });
    const attempts = [
      ...syntheticTaskFrames("neutral-face", 0, () => ({
        mouthCorners: {
          left: { x: 0.7, y: 0.1 },
          right: { x: -0.7, y: 0.1 }
        }
      })),
      ...syntheticTaskFrames("neutral-face", 2_000),
      ...syntheticTaskFrames("smile", 4_000, () => ({
        mouthCorners: {
          left: { x: 0.8, y: 0.1 },
          right: { x: -0.8, y: 0.1 }
        }
      })),
      ...syntheticTaskFrames("smile", 6_000, () => ({
        mouthCorners: {
          left: { x: 0.34, y: 0.1 },
          right: { x: -0.34, y: 0.1 }
        }
      })),
      ...syntheticTaskFrames("eye-closure", 8_000, () => ({
        eyeAperture: { left: 0.29, right: 0.29 }
      })),
      ...syntheticTaskFrames("eye-closure", 10_000, () => ({
        eyeAperture: { left: 0.15, right: 0.15 }
      }))
    ];
    attempts.forEach((frame) => session.ingestFace(frame));

    session.setGuidedTaskEvidenceIntervals([
      { taskContext: "neutral-face", startMs: 2_000, endMs: 3_600 },
      { taskContext: "smile", startMs: 4_000, endMs: 5_600 }
    ]);
    session.setGuidedTaskEvidenceIntervals([
      { taskContext: "neutral-face", startMs: 2_000, endMs: 3_600 },
      { taskContext: "smile", startMs: 6_000, endMs: 7_600 },
      {
        taskContext: "eye-closure",
        startMs: 10_000,
        endMs: 11_600
      }
    ]);

    const { observation } = session.complete();
    expect(
      observation.windows
        .filter((window) => window.modality === "face")
        .map((window) => [window.context.kind, window.startMs, window.endMs])
    ).toEqual([
      ["neutral-face", 2_000, 3_600],
      ["smile", 6_000, 7_600],
      ["eye-closure", 10_000, 11_600]
    ]);
    const smileLeft = observation.measurements.find(
      (measurement) =>
        measurement.code === "prototype.face.smile_excursion.left"
    );
    expect(smileLeft).toMatchObject({
      windowStartMs: 6_000,
      windowEndMs: 7_600
    });
    expect(smileLeft?.value).toBeCloseTo(0.04);
    expect(
      observation.measurements.find(
        (measurement) =>
          measurement.code ===
          "prototype.face.eye_closure_fraction.left"
      )
    ).toMatchObject({
      value: 0.5,
      windowStartMs: 10_000,
      windowEndMs: 11_600
    });
  });

  it("serializes the visual processor used after an in-session restart", () => {
    const { audio: _audio, face: _face, ...identity } =
      syntheticFrameStream();
    const session = createConductorSession(identity, { baseTimeMs: 0 });
    const restartedPipeline = {
      ...identity.visualPipeline!,
      processorRef: "mediapipe-face-landmarker:restart:cpu",
      delegate: "CPU" as const
    };

    session.setVisualPipeline(restartedPipeline);
    for (const frame of syntheticTaskFrames("neutral-face", 0, () => ({
      processorRef: restartedPipeline.processorRef
    }))) {
      session.ingestFace(frame);
    }

    expect(session.complete().observation.visualPipeline).toEqual(
      restartedPipeline
    );
  });
});
