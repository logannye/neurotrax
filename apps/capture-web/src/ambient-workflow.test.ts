import { describe, expect, it } from "vitest";
import {
  createAmbientWorkflowState,
  reduceAmbientWorkflow
} from "./ambient-workflow.js";

describe("ambient workflow", () => {
  it("requires consent and ignores stale async completions", () => {
    let state = createAmbientWorkflowState();
    expect(reduceAmbientWorkflow(state, { type: "start-requested", atMs: 0 }).state.phase)
      .toBe("idle");
    state = reduceAmbientWorkflow(state, {
      type: "consent-changed",
      consented: true
    }).state;
    const started = reduceAmbientWorkflow(state, { type: "start-requested", atMs: 0 });
    expect(started.state.phase).toBe("requesting-permission");
    expect(started.effects).toEqual([
      { type: "request-media", generation: 1 }
    ]);
    expect(
      reduceAmbientWorkflow(started.state, {
        type: "permission-resolved",
        generation: 0,
        lane: "audio",
        available: true,
        atMs: 1
      }).state
    ).toEqual(started.state);
  });

  it("calibrates lanes independently and observes with one usable lane", () => {
    let state = createAmbientWorkflowState();
    state = reduceAmbientWorkflow(state, {
      type: "consent-changed",
      consented: true
    }).state;
    state = reduceAmbientWorkflow(state, { type: "start-requested", atMs: 0 }).state;
    state = reduceAmbientWorkflow(state, {
      type: "permission-resolved",
      generation: 1,
      lane: "audio",
      available: false,
      atMs: 50
    }).state;
    const calibration = reduceAmbientWorkflow(state, {
      type: "permission-resolved",
      generation: 1,
      lane: "face",
      available: true,
      atMs: 100
    });
    expect(calibration.state.phase).toBe("calibrating");
    expect(calibration.effects[0]?.type).toBe("begin-calibration");
    const observing = reduceAmbientWorkflow(calibration.state, {
      type: "calibration-resolved",
      generation: 1,
      lane: "face",
      measurable: true,
      atMs: 1_700
    });
    expect(observing.state.phase).toBe("observing");
    expect(observing.state.audioLane).toBe("not-measurable");
  });

  it("terminalizes pending lanes at setup timeout", () => {
    let state = createAmbientWorkflowState();
    state = reduceAmbientWorkflow(state, {
      type: "consent-changed",
      consented: true
    }).state;
    state = reduceAmbientWorkflow(state, { type: "start-requested", atMs: 0 }).state;
    state = reduceAmbientWorkflow(state, {
      type: "permission-resolved",
      generation: 1,
      lane: "audio",
      available: true,
      atMs: 50
    }).state;
    state = reduceAmbientWorkflow(state, {
      type: "permission-resolved",
      generation: 1,
      lane: "face",
      available: true,
      atMs: 100
    }).state;
    state = reduceAmbientWorkflow(state, {
      type: "calibration-resolved",
      generation: 1,
      lane: "audio",
      measurable: true,
      atMs: 2_100
    }).state;
    const timedOut = reduceAmbientWorkflow(state, {
      type: "setup-timeout",
      generation: 1,
      atMs: 15_100
    });
    expect(timedOut.state.phase).toBe("observing");
    expect(timedOut.state.faceLane).toBe("not-measurable");
  });

  it("allows a capture-capable lane to continue when technical calibration times out", () => {
    const state = {
      ...createAmbientWorkflowState(),
      phase: "calibrating" as const,
      generation: 3,
      consented: true,
      audioLane: "not-measurable" as const,
      faceLane: "calibrating" as const,
      setupStartedAtMs: 0
    };
    const result = reduceAmbientWorkflow(state, {
      type: "setup-timeout",
      generation: 3,
      atMs: 15_000
    });
    expect(result.state).toMatchObject({
      phase: "observing",
      audioLane: "not-measurable",
      faceLane: "not-measurable"
    });
    expect(result.effects).toEqual([
      { type: "begin-observation", generation: 3 }
    ]);
  });

  it.each([
    "requesting-permission",
    "calibrating",
    "observing",
    "finalizing"
  ] as const)("visibility loss discards during %s", (phase) => {
    const state = {
      ...createAmbientWorkflowState(),
      phase,
      generation: 4,
      consented: true
    };
    const result = reduceAmbientWorkflow(state, { type: "visibility-lost" });
    expect(result.state.phase).toBe("discarded");
    expect(result.state.generation).toBe(5);
    expect(result.effects).toEqual([
      { type: "dispose", generation: 5, discard: true }
    ]);
  });

  it("finalizes manually or at the five-minute cap", () => {
    const state = {
      ...createAmbientWorkflowState(),
      phase: "observing" as const,
      generation: 2,
      consented: true,
      audioLane: "measurable" as const,
      faceLane: "not-measurable" as const
    };
    for (const type of ["finish-requested", "capture-limit-reached"] as const) {
      const result = reduceAmbientWorkflow(state, { type, generation: 2 });
      expect(result.state.phase).toBe("finalizing");
      expect(result.effects).toEqual([{ type: "finalize", generation: 2 }]);
    }
  });

  it("withdrawal invalidates the generation and reset clears session state", () => {
    const state = {
      ...createAmbientWorkflowState(),
      phase: "observing" as const,
      generation: 7,
      consented: true,
      audioLane: "measurable" as const
    };
    const discarded = reduceAmbientWorkflow(state, {
      type: "consent-changed",
      consented: false
    });
    expect(discarded.state.generation).toBe(8);
    const reset = reduceAmbientWorkflow(discarded.state, { type: "reset" });
    expect(reset.state).toMatchObject({
      phase: "idle",
      generation: 9,
      consented: false,
      audioLane: "off",
      faceLane: "off"
    });
  });
});
