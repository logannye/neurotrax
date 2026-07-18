import { describe, expect, it } from "vitest";
import { createEventFactory } from "./events.js";

describe("createEventFactory", () => {
  it("produces monotonic sequences, lane identity, and non-decreasing timestamps", () => {
    const factory = createEventFactory({
      visitId: "visit-001",
      participantId: "synthetic-participant-001",
      baseTimeMs: Date.parse("2026-07-18T16:00:00.000Z")
    });
    const first = factory.next("capture-conductor", "capture.window.detected", "Detected a window.", 0);
    const second = factory.next("speech-acoustic", "measurement.recorded", "Recorded a measurement.", -500);

    expect(first.sequence).toBe(1);
    expect(first.eventId).toBe("1-capture.window.detected");
    expect(first.actor.lane).toBe("capture-conductor");
    expect(first.stage).toBe("ambient-capture");
    expect(second.sequence).toBe(2);
    expect(Date.parse(second.occurredAt)).toBeGreaterThanOrEqual(Date.parse(first.occurredAt));
  });
});
