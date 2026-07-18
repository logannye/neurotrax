import { describe, expect, it } from "vitest";
import type {
  EncounterObservation,
  EventEnvelope
} from "@neurotrax/contracts";

describe("observation and event contracts", () => {
  it("models a per-visit aggregate observation", () => {
    const observation: EncounterObservation = {
      containsPHI: false,
      captureMode: "fixture-playback",
      visitId: "visit-001",
      participantId: "synthetic-participant-001",
      windows: [
        {
          windowId: "speech-0",
          modality: "speech",
          startMs: 0,
          endMs: 1900,
          context: {
            kind: "spontaneous-speech",
            confounds: {
              snrDb: 20,
              faceFramingFraction: 0,
              observedFrameRate: 0,
              illuminationRelative: 0
            }
          }
        }
      ],
      measurements: [
        {
          code: "prototype.speech.articulation_rate",
          label: "Articulation rate",
          value: 0.95,
          unit: "voiced-fraction",
          confidence: 0.67,
          uncertainty: "placeholder",
          algorithmVersion: "speech-acoustic-0.1",
          clinicalValidation: "none",
          contextRef: "speech-0",
          windowStartMs: 0,
          windowEndMs: 1900,
          evidenceSnippetRef: null
        }
      ],
      aggregates: [
        {
          code: "prototype.speech.articulation_rate",
          label: "Articulation rate",
          unit: "voiced-fraction",
          contextKind: "spontaneous-speech",
          value: 0.6,
          spread: 0.03,
          windowCount: 4,
          algorithmVersion: "speech-acoustic-0.1",
          uncertainty: "placeholder",
          clinicalValidation: "none"
        }
      ],
      abstentions: [],
      measurementCount: 1
    };
    expect(observation.containsPHI).toBe(false);
    expect(observation.windows[0].context.confounds.snrDb).toBe(20);
    expect(observation.measurements[0].contextRef).toBe("speech-0");
    expect(observation.aggregates[0].windowCount).toBe(4);
  });

  it("models an ambient event envelope with lane identity", () => {
    const event: EventEnvelope = {
      schemaVersion: "neurotrax.ambient-event.v0.1",
      eventId: "1-capture.window.detected",
      sequence: 1,
      occurredAt: "2026-07-18T16:00:00.000Z",
      visitId: "visit-001",
      participantId: "synthetic-participant-001",
      actor: {
        kind: "agent",
        id: "capture-conductor",
        lane: "capture-conductor",
        version: "0.1.0"
      },
      type: "capture.window.detected",
      stage: "ambient-capture",
      summary: "Detected a candidate speech window.",
      payload: {},
      evidenceRefs: []
    };
    expect(event.stage).toBe("ambient-capture");
    expect(event.actor.lane).toBe(event.actor.id);
  });
});
