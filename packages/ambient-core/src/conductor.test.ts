import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createConductorSession, runConductor } from "./conductor.js";
import type { FrameStream } from "./primitives.js";
import {
  syntheticFacialFrame,
  syntheticFrameStream,
  syntheticTaskFrames
} from "./test-helpers.js";

function loadFixture(): FrameStream {
  const path = fileURLToPath(
    new URL("../fixtures/synthetic-visit.frames.json", import.meta.url)
  );
  return JSON.parse(readFileSync(path, "utf8")) as FrameStream;
}

describe("runConductor", () => {
  it("produces five speech and six corrected facial measurements", () => {
    const stream = loadFixture();
    const { observation, events } = runConductor(stream, {
      baseTimeMs: Date.parse("2026-07-18T16:00:00.000Z")
    });

    expect(observation).toMatchObject({
      schemaVersion: "phenometric.encounter-observation.v1",
      containsPHI: false,
      rawMediaRetained: false,
      nativeVisualObservationsRetained: false,
      measurementCount: 11
    });
    expect(observation.measurements).toHaveLength(11);
    expect(observation.aggregates.map((aggregate) => aggregate.code)).toEqual([
      "prototype.face.eye_closure_fraction.asymmetry",
      "prototype.face.eye_closure_fraction.left",
      "prototype.face.eye_closure_fraction.right",
      "prototype.face.smile_excursion.asymmetry",
      "prototype.face.smile_excursion.left",
      "prototype.face.smile_excursion.right",
      "prototype.speech.onset_latency",
      "prototype.speech.pause_rate",
      "prototype.speech.pitch_center",
      "prototype.speech.pitch_variability",
      "prototype.speech.voiced_time_fraction"
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
    expect(JSON.stringify(observation)).not.toMatch(
      /faceLandmarks|blendshapes|transformationMatrix|deviceId|deviceLabel/
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

  it("abstains only a poor-quality visual task while speech continues", () => {
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
        measurement.code.startsWith("prototype.speech.")
      )
    ).toBe(true);
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
      session.ingestAudio({
        tMs,
        voiced: true,
        rms: 0.1,
        pitchHz: 120 + (tMs % 400) / 100,
        clipped: false,
        snrDb: 20
      });
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
    expect(
      events.some(
        (event) =>
          event.type === "measurement.recorded" &&
          event.actor.id === "speech-acoustic"
      )
    ).toBe(true);
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
});
