import { describe, expect, it } from "vitest";
import type {
  EncounterObservation,
  EvidenceCardDraft,
  EvidenceClaimFact,
  EventEnvelope
} from "@phenometric/contracts";
import {
  assembleEvidenceCardDraft,
  createModalityOutcomes,
  EVIDENCE_BOUNDARY,
  validateEvidenceCardDraft
} from "./evidence.js";

const facts: EvidenceClaimFact[] = [
  {
    claimId: "claim-pitch",
    measurementCode: "prototype.speech.pitch_variability",
    label: "Pitch variability",
    modality: "speech",
    statement:
      "Pitch variability was measured from a technically usable speech interval.",
    currentValue: 1.9,
    unit: "semitone-stddev",
    supportRefs: ["speech-0"],
    eventIds: ["measurement-pitch"],
    allowedNumbers: ["1.9"]
  },
  {
    claimId: "claim-face",
    measurementCode: "prototype.face.expressivity",
    label: "Facial movement",
    modality: "face",
    statement:
      "Facial movement was measured before and after a quality-withheld interval.",
    currentValue: 0.04,
    unit: "motion-index",
    supportRefs: ["face-0", "face-1"],
    eventIds: ["measurement-face", "face-recovered"],
    allowedNumbers: ["0.04"]
  }
];

function validDraft(): EvidenceCardDraft {
  return {
    headline: "Two encounter signals are ready for review",
    summary:
      "Pitch variability and facial movement were measured during technically usable portions of the encounter.",
    claims: facts.map((fact) => ({
      claimId: fact.claimId,
      statement: fact.statement
    })),
    boundaryStatement: EVIDENCE_BOUNDARY
  };
}

describe("validateEvidenceCardDraft", () => {
  it("attaches exact grounded claims and the review boundary in code", () => {
    const draft = assembleEvidenceCardDraft(
      {
        headline: "Two encounter signals are ready for review",
        summary:
          "Pitch variability and facial movement were measured during technically usable portions of the encounter."
      },
      facts
    );

    expect(draft.claims).toEqual(
      facts.map((fact) => ({
        claimId: fact.claimId,
        modality: fact.modality,
        status: "measured",
        statement: fact.statement
      }))
    );
    expect(draft.boundaryStatement).toBe(EVIDENCE_BOUNDARY);
  });

  it("passes one speech claim and one face claim", () => {
    expect(validateEvidenceCardDraft(validDraft(), facts)).toEqual({
      status: "pass",
      errors: [],
      groundedClaimIds: ["claim-pitch", "claim-face"]
    });
  });

  it("rejects an unknown claim", () => {
    const draft = validDraft();
    draft.claims[0].claimId = "claim-invented";
    expect(validateEvidenceCardDraft(draft, facts).status).toBe("fail");
  });

  it("rejects unsupported numbers and clinical interpretation", () => {
    const draft = validDraft();
    draft.summary =
      "Pitch variability shows 72 percent risk of disease progression.";
    const result = validateEvidenceCardDraft(draft, facts);
    expect(result.status).toBe("fail");
    expect(result.errors.join(" ")).toMatch(/prohibited|numeric/i);
  });

  it("rejects a paraphrased claim that could drift from its support", () => {
    const draft = validDraft();
    draft.claims[0].statement = "Pitch was normal.";
    expect(validateEvidenceCardDraft(draft, facts).status).toBe("fail");
  });

  it("requires both modalities", () => {
    const draft = validDraft();
    draft.claims[1] = { ...draft.claims[0] };
    expect(validateEvidenceCardDraft(draft, facts).status).toBe("fail");
  });

  it("creates a traceable withheld outcome when one modality is unavailable", () => {
    const observation = {
      containsPHI: false,
      captureMode: "live",
      visitId: "visit-outcomes",
      participantId: "participant",
      occurredAt: "2026-07-18T18:00:00.000Z",
      captureAdapter: { id: "browser", version: "1" },
      windows: [],
      measurements: [],
      aggregates: [
        {
          code: "prototype.speech.pitch_variability",
          label: "Pitch variability",
          unit: "semitone-stddev",
          contextKind: "spontaneous-speech",
          value: 1.9,
          spread: 0,
          confidence: 0.9,
          windowCount: 1,
          algorithmVersion: "speech-acoustic-0.3",
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
      abstentions: [
        {
          modality: "face",
          windowStartMs: 4_000,
          windowEndMs: 14_000,
          reasonCode: "face-not-visible",
          detail: "No facial value was produced."
        }
      ],
      measurementCount: 1,
      qualitySummary: {
        speechWindowCount: 1,
        faceWindowCount: 0,
        abstentionCount: 1,
        qualityTransitionCount: 2,
        audioFrameCount: 140,
        speechActiveFrameCount: 100,
        pitchedFrameCount: 80,
        pitchCoverage: 0.8,
        faceFrameCount: 140,
        usableFaceFrameCount: 0,
        usableFaceFraction: 0,
        faceWithholdingDurationMs: 10_000,
        faceRecoveryObserved: false,
        postRecoveryFaceWindowCount: 0
      }
    } satisfies EncounterObservation;
    const events = [
      {
        schemaVersion: "phenometric.workflow-event.v0.2",
        eventId: "1-encounter-observation.created",
        sequence: 1,
        occurredAt: observation.occurredAt,
        visitId: observation.visitId,
        participantId: observation.participantId,
        actor: {
          kind: "agent",
          id: "capture-conductor",
          lane: "capture-conductor",
          version: "0.2.0"
        },
        type: "encounter-observation.created",
        stage: "ambient-capture",
        summary: "Created the encounter observation.",
        payload: {},
        evidenceRefs: []
      }
    ] satisfies EventEnvelope[];

    const outcomes = createModalityOutcomes(observation, events);
    expect(outcomes.map((outcome) => outcome.status)).toEqual([
      "measured",
      "withheld"
    ]);
    expect(outcomes[1]).toMatchObject({
      modality: "face",
      reasonCode: "face-not-visible"
    });
  });
});
