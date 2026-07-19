import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createConductorSession, runConductor } from "./conductor.js";
import type { FrameStream } from "./primitives.js";

function loadFixture(): FrameStream {
  const path = fileURLToPath(new URL("../fixtures/synthetic-visit.frames.json", import.meta.url));
  return JSON.parse(readFileSync(path, "utf8")) as FrameStream;
}

describe("runConductor", () => {
  it("produces a per-visit observation and a lane-tagged event stream from the fixture", () => {
    const stream = loadFixture();
    const { observation, events } = runConductor(stream, { baseTimeMs: Date.parse("2026-07-18T16:00:00.000Z") });

    expect(observation.containsPHI).toBe(false);
    expect(observation.visitId).toBe(stream.visitId);
    expect(observation.aggregates).toHaveLength(6);
    expect(observation.measurementCount).toBe(6);
    expect(observation.windows).toHaveLength(2);
    expect(observation.measurements).toHaveLength(6);
    expect(observation.abstentions).toEqual([]);
    expect(observation.aggregates.map((aggregate) => aggregate.code)).toEqual([
      "prototype.face.blink_rate",
      "prototype.face.brow_amplitude",
      "prototype.face.expressivity",
      "prototype.speech.pause_rate",
      "prototype.speech.pitch_variability",
      "prototype.speech.voiced_time_fraction"
    ]);
    const aggregateByCode = new Map(
      observation.aggregates.map((aggregate) => [aggregate.code, aggregate])
    );
    expect(
      aggregateByCode.get("prototype.speech.voiced_time_fraction")!.value
    ).toBeCloseTo(0.95, 5);
    expect(
      aggregateByCode.get("prototype.speech.pause_rate")!.value
    ).toBe(0);
    expect(observation.windows[0].context.confounds.snrDb).toBeGreaterThan(0);

    expect(events[0].type).toBe("consent.recorded");
    expect(events[1].type).toBe("analysis.started");
    expect(
      events.some((event) => event.type === "capture.window.detected")
    ).toBe(true);
    expect(events.at(-1)!.type).toBe("encounter-observation.created");
    expect(events.length).toBeGreaterThan(9);
    const lanes = new Set(events.map((e) => e.actor.lane));
    expect(lanes.has("capture-conductor")).toBe(true);
    expect(lanes.has("speech-acoustic")).toBe(true);
    expect(lanes.has("facial-expressivity")).toBe(true);

    // sequences are monotonic 1..N
    events.forEach((event, index) => expect(event.sequence).toBe(index + 1));
  });

  it("is deterministic: identical input yields identical output", () => {
    const opts = { baseTimeMs: Date.parse("2026-07-18T16:00:00.000Z") };
    const a = runConductor(loadFixture(), opts);
    const b = runConductor(loadFixture(), opts);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("emits an abstention when a window is unmeasurable", () => {
    const stream = loadFixture();
    // Force the face frames low-framing so the facial agent abstains.
    const degraded: FrameStream = {
      ...stream,
      face: stream.face.map((f) => ({ ...f, framingFraction: 0.2, faceVisible: true }))
    };
    const { observation, events } = runConductor(degraded, { baseTimeMs: 0 });
    expect(observation.abstentions).toEqual([
      expect.objectContaining({ modality: "face", reasonCode: "face-not-framed" })
    ]);
    expect(
      events.some(
        (event) =>
          event.type === "measurement.abstained" &&
          event.actor.lane === "facial-expressivity" &&
          event.payload.reasonCode === "face-not-framed"
      )
    ).toBe(true);
    expect(
      events.some(
        (event) =>
          event.type === "measurement.recorded" &&
          event.actor.lane === "speech-acoustic"
      )
    ).toBe(true);
  });

  it("rejects input that is not explicitly marked non-PHI", () => {
    const unsafe = {
      ...loadFixture(),
      containsPHI: true
    } as unknown as FrameStream;

    expect(() => runConductor(unsafe)).toThrow(
      /explicitly marked containsPHI: false/
    );
  });

  it("withholds the facial lane during a turn-away while speech continues, then recovers", () => {
    const emitted: ReturnType<ReturnType<typeof createConductorSession>["getEvents"]> = [];
    const session = createConductorSession(
      {
        containsPHI: false,
        visitId: "visit-turn-away",
        participantId: "developer-self-demo",
        captureMode: "fixture-playback",
        occurredAt: "2026-07-18T16:00:00.000Z",
        captureAdapter: { id: "turn-away-fixture", version: "0.2.0" }
      },
      {
        baseTimeMs: Date.parse("2026-07-18T16:00:00.000Z"),
        onEvent: (event) => emitted.push(event)
      }
    );

    for (let tMs = 0; tMs <= 5200; tMs += 100) {
      session.ingestAudio({
        tMs,
        voiced: true,
        rms: 0.08,
        pitchHz: 125 + (tMs % 400) / 20,
        clipped: false,
        snrDb: 21
      });
      const turnedAway = tMs >= 1800 && tMs <= 2800;
      session.ingestFace({
        tMs,
        faceVisible: !turnedAway,
        framingFraction: turnedAway ? 0 : 0.88,
        illumination: 0.58,
        yawDegrees: turnedAway ? 48 : 4,
        eyeAspectRatio: 0.3,
        browRaise: 0.15 + (tMs % 300) / 3000,
        mouthOpen: 0.1,
        landmarkMotion: 0.03,
        observedFrameRate: 10
      });
    }

    const { observation } = session.complete();
    const faceQuality = emitted.filter(
      (event) =>
        event.type === "capture.quality.changed" &&
        event.actor.id === "facial-expressivity"
    );
    const withheldIndex = faceQuality.findIndex(
      (event) => event.payload.quality === "withheld"
    );
    const recoveredIndex = faceQuality.findIndex(
      (event, index) =>
        index > withheldIndex && event.payload.quality === "measurable"
    );

    expect(withheldIndex).toBeGreaterThanOrEqual(0);
    expect(recoveredIndex).toBeGreaterThan(withheldIndex);
    expect(
      emitted.some(
        (event) =>
          event.type === "measurement.recorded" &&
          event.actor.id === "speech-acoustic"
      )
    ).toBe(true);
    expect(
      observation.abstentions.some(
        (abstention) =>
          abstention.modality === "face" &&
          abstention.windowStartMs <= 1800 &&
          abstention.windowEndMs >= 2800
      )
    ).toBe(true);
    expect(
      observation.measurements.some(
        (measurement) =>
          measurement.code.startsWith("prototype.face.") &&
          measurement.windowStartMs < 2800 &&
          measurement.windowEndMs > 1800
      )
    ).toBe(false);
    expect(observation.windows.filter((window) => window.modality === "face")).toHaveLength(2);
    expect(new Set(emitted.map((event) => event.eventId)).size).toBe(
      emitted.length
    );
    emitted.forEach((event, index) =>
      expect(event.sequence).toBe(index + 1)
    );
  });

  it("emits a specific facial quality reason after calibration", () => {
    const session = createConductorSession({
      containsPHI: false,
      visitId: "visit-position-quality",
      participantId: "developer-self-demo",
      captureMode: "fixture-playback",
      calibration: {
        profileId: "macbook-timed-v0.2",
        calibratedAt: "2026-07-18T16:00:00.000Z",
        audio: {
          medianNoiseRms: 0.002,
          noiseP90Rms: 0.0024,
          entryThresholdRms: 0.008,
          exitThresholdRms: 0.006
        },
        audioQuality: "strong",
        face: {
          baselineBoxWidth: 0.24,
          baselineBoxHeight: 0.4,
          baselineIllumination: 0.58
        },
        faceQuality: "strong"
      }
    });

    for (let tMs = 0; tMs <= 1700; tMs += 100) {
      const offCenter = tMs >= 900;
      session.ingestFace({
        tMs,
        faceVisible: true,
        framingFraction: offCenter ? 0 : 0.9,
        illumination: 0.58,
        yawDegrees: 3,
        eyeAspectRatio: 0.3,
        browRaise: 0.15,
        mouthOpen: 0.1,
        landmarkMotion: 0.02,
        observedFrameRate: 10,
        faceBoxWidth: 0.24,
        faceBoxHeight: 0.4,
        edgeMargin: offCenter ? 0.005 : 0.08
      });
    }

    expect(
      session
        .getEvents()
        .some(
          (event) =>
            event.type === "capture.quality.changed" &&
            event.payload.reasonCode === "face-off-center"
        )
    ).toBe(true);
  });
});
