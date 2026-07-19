import { describe, expect, it } from "vitest";
import type {
  EncounterObservation,
  EventEnvelope
} from "@phenometric/contracts";

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
              illuminationRelative: 0,
              yawDegrees: 0
            }
          }
        }
      ],
      measurements: [
        {
          code: "prototype.speech.voiced_time_fraction",
          label: "Voiced-time fraction",
          value: 0.95,
          unit: "voiced-fraction",
          confidence: 0.67,
          uncertainty: "placeholder",
          algorithmVersion: "speech-acoustic-0.2",
          clinicalValidation: "none",
          contextRef: "speech-0",
          windowStartMs: 0,
          windowEndMs: 1900,
          evidenceSnippetRef: null
        }
      ],
      aggregates: [
        {
          code: "prototype.speech.voiced_time_fraction",
          label: "Voiced-time fraction",
          unit: "ratio",
          contextKind: "spontaneous-speech",
          value: 0.6,
          spread: 0.03,
          confidence: 0.8,
          windowCount: 4,
          algorithmVersion: "speech-acoustic-0.2",
          confounds: {
            snrDb: 20,
            faceFramingFraction: 0,
            observedFrameRate: 0,
            illuminationRelative: 0,
            yawDegrees: 0
          },
          uncertainty: "placeholder",
          clinicalValidation: "none"
        }
      ],
      abstentions: [],
      measurementCount: 1,
      occurredAt: "2026-07-18T16:00:00.000Z",
      captureAdapter: { id: "fixture-replay", version: "0.2.0" },
      qualitySummary: {
        speechWindowCount: 1,
        faceWindowCount: 0,
        abstentionCount: 0,
        qualityTransitionCount: 1,
        audioFrameCount: 20,
        speechActiveFrameCount: 16,
        pitchedFrameCount: 14,
        pitchCoverage: 0.875,
        faceFrameCount: 0,
        usableFaceFrameCount: 0,
        usableFaceFraction: 0,
        faceWithholdingDurationMs: 0,
        faceRecoveryObserved: false,
        postRecoveryFaceWindowCount: 0
      }
    };
    expect(observation.containsPHI).toBe(false);
    expect(observation.windows[0].context.confounds.snrDb).toBe(20);
    expect(observation.measurements[0].contextRef).toBe("speech-0");
    expect(observation.aggregates[0].windowCount).toBe(4);
  });

  it("models an ambient event envelope with lane identity", () => {
    const event: EventEnvelope = {
      schemaVersion: "phenometric.workflow-event.v0.2",
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
