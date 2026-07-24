import { describe, expect, it } from "vitest";
import { createEventFactory } from "./events.js";

describe("createEventFactory", () => {
  it("produces monotonic sequences, lane identity, and non-decreasing timestamps", () => {
    const factory = createEventFactory({
      visitId: "visit-001",
      participantId: "synthetic-participant-001",
      baseTimeMs: Date.parse("2026-07-18T16:00:00.000Z")
    });
    const first = factory.next(
      "personal-trajectory",
      "trajectory.compatibility.assessed",
      "personal-trajectory",
      "Assessed compatibility.",
      0
    );
    const second = factory.next(
      "personal-trajectory",
      "trajectory.comparison.completed",
      "personal-trajectory",
      "Completed comparison.",
      -500
    );

    expect(first.sequence).toBe(1);
    expect(first.eventId).toBe("1-trajectory.compatibility.assessed");
    expect(first.actor.lane).toBe("personal-trajectory");
    expect(first.stage).toBe("personal-trajectory");
    expect(second.sequence).toBe(2);
    expect(Date.parse(second.occurredAt)).toBeGreaterThanOrEqual(Date.parse(first.occurredAt));
  });
});
