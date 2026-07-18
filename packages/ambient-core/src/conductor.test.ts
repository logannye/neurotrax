import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { runConductor } from "./conductor.js";
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
      "prototype.speech.articulation_rate",
      "prototype.speech.pause_count",
      "prototype.speech.pitch_variability"
    ]);
    const aggregateByCode = new Map(
      observation.aggregates.map((aggregate) => [aggregate.code, aggregate])
    );
    expect(
      aggregateByCode.get("prototype.speech.articulation_rate")!.value
    ).toBeCloseTo(0.95, 5);
    expect(
      aggregateByCode.get("prototype.speech.pause_count")!.value
    ).toBe(1);
    expect(observation.windows[0].context.confounds.snrDb).toBeGreaterThan(0);

    expect(events[0].type).toBe("capture.window.detected");
    expect(events.at(-1)!.type).toBe("encounter-observation.created");
    expect(events).toHaveLength(9);
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
      /only explicitly non-PHI synthetic streams/
    );
  });
});
