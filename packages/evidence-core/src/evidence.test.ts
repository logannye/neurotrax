import { describe, expect, it } from "vitest";
import type {
  EncounterObservation,
  EvidenceCardDraft,
  EvidenceClaimFact,
  EventEnvelope
} from "@phenometric/contracts";
import {
  assembleEvidenceCardDraft,
  createEncounterClaimFacts,
  createModalityOutcomes,
  EVIDENCE_BOUNDARY,
  validateEvidenceCardDraft
} from "./evidence.js";

const facts: EvidenceClaimFact[] = [
  {
    claimId: "claim-pitch",
    measurementCode: "prototype.voice.cpps",
    label: "Cepstral peak prominence",
    modality: "speech",
    statement:
      "Cepstral peak prominence was measured from a technically usable voice interval.",
    currentValue: 14.2,
    unit: "decibels",
    supportRefs: ["speech-0"],
    eventIds: ["measurement-pitch"],
    allowedNumbers: ["14.2"]
  },
  {
    claimId: "claim-face",
    measurementCode: "prototype.face.smile_excursion.asymmetry",
    label: "Smile excursion asymmetry",
    modality: "face",
    statement:
      "Smile excursion asymmetry was measured across accepted facial task windows.",
    currentValue: 0.04,
    unit: "inter-eye-normalized-distance",
    supportRefs: ["face-0", "face-1"],
    eventIds: ["measurement-face", "measurement-smile"],
    allowedNumbers: ["0.04"]
  }
];

function validDraft(): EvidenceCardDraft {
  return {
    headline: "Two encounter signals are ready for review",
    summary:
      "Cepstral peak prominence and smile excursion asymmetry were measured during technically usable portions of the encounter.",
    claims: facts.map((fact) => ({
      claimId: fact.claimId,
      statement: fact.statement
    })),
    boundaryStatement: EVIDENCE_BOUNDARY
  };
}

function visualConfounds() {
  return {
    kind: "visual" as const,
    faceBoxWidthPixels: 320,
    faceBoxHeightPixels: 360,
    faceWidthFraction: 0.25,
    faceHeightFraction: 0.5,
    edgeMarginFraction: 0.1,
    analyzedFrameRate: 30,
    skippedFrameFraction: 0,
    meanInterResultGapMs: 33,
    illuminationMean: 0.5,
    darkClippingFraction: 0,
    brightClippingFraction: 0,
    sharpness: 0.002,
    yawDegrees: 0,
    pitchDegrees: 0,
    rollDegrees: 0
  };
}

function createObservation(): EncounterObservation {
  return {
    schemaVersion: "phenometric.encounter-observation.v2",
    containsPHI: false,
    rawMediaRetained: false,
    rawAudioRetained: false,
    nativeAudioObservationsRetained: false,
    transcriptRetained: false,
    voiceEmbeddingsRetained: false,
    nativeVisualObservationsRetained: false,
    selectedProtocolId: "voice-foundation.v1",
    captureMode: "live",
    visitId: "visit-outcomes",
    participantId: "participant",
    occurredAt: "2026-07-18T18:00:00.000Z",
    captureAdapter: { id: "browser", version: "1" },
    audioPipeline: null,
    audioCaptureSettings: null,
    voiceModel: null,
    audioStreamDiagnostics: null,
    visualPipeline: {
      processorRef:
        "mediapipe-face-landmarker@visual-foundation-v1",
      runtime: "mediapipe-tasks-vision",
      mediaPipeVersion: "0.10.35",
      modelAsset: "/models/face_landmarker.task",
      modelSha256: "0".repeat(64),
      delegate: "GPU",
      geometryVersion: "facial-kinematics-v1"
    },
    videoCaptureSettings: {
      requested: { width: 1280, height: 720, frameRate: 30 },
      actual: { width: 1280, height: 720, frameRate: 30 },
      facingMode: "user",
      coordinateSpace: "normalized-unmirrored-image",
      displayMirrored: true,
      lateralityConvention: "subject-anatomical"
    },
    windows: [],
    measurements: [],
    aggregates: [
      {
        code: "prototype.voice.cpps",
        label: "Cepstral peak prominence",
        unit: "decibels",
        contextKind: "spontaneous-speech",
        value: 14.2,
        spread: 0,
        confidence: 0.9,
        windowCount: 1,
        algorithmVersion: "voice-analysis-1.0",
        processorRef: "browser-voice-dsp@1.0",
        sourceWindowRefs: ["speech-0"],
        confounds: {
          kind: "speech",
          sampleRateHz: 48000,
          sampleRateClass: "48khz-or-higher",
          browserProcessing: {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false
          },
          snrDb: 20,
          clippingFraction: 0,
          dcOffset: 0,
          lostBlockFraction: 0,
          maximumBlockGapMs: 20,
          usableCoverage: 1,
          periodicityCoverage: 0.9
        },
        uncertainty: {
          kind: "not-estimated",
          reason:
            "Single-encounter speech uncertainty is not estimated."
        },
        clinicalValidation: "none"
      }
    ],
    abstentions: [],
    measurementCount: 0,
    qualitySummary: {
      speechWindowCount: 1,
      faceWindowCount: 0,
      abstentionCount: 0,
      qualityTransitionCount: 2,
      audioFrameCount: 140,
      speechActiveFrameCount: 100,
      pitchedFrameCount: 80,
      pitchCoverage: 0.8,
      audioLostBlockFraction: 0,
      maximumAudioBlockGapMs: 20,
      medianAudioSnrDb: 20,
      faceFrameCount: 140,
      usableFaceFrameCount: 0,
      usableFaceFraction: 0,
      faceWithholdingDurationMs: 10_000,
      faceRecoveryObserved: false,
      postRecoveryFaceWindowCount: 0
    }
  };
}

describe("validateEvidenceCardDraft", () => {
  it("attaches exact grounded claims and the review boundary in code", () => {
    const draft = assembleEvidenceCardDraft(
      {
        headline: "Two encounter signals are ready for review",
        summary:
          "Pitch variability and smile excursion asymmetry were measured during technically usable portions of the encounter."
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

  it("rejects duplicate modality claims", () => {
    const draft = validDraft();
    draft.claims[1] = { ...draft.claims[0] };
    expect(validateEvidenceCardDraft(draft, facts).status).toBe("fail");
  });

  it("prioritizes smile asymmetry and falls back to eye-closure asymmetry", () => {
    const observation = createObservation();
    observation.selectedProtocolId = "facial-foundation.v1";
    observation.aggregates.push(
      {
        code: "prototype.face.eye_closure_fraction.asymmetry",
        label: "Eye-closure fraction asymmetry",
        unit: "fraction",
        contextKind: "eye-closure",
        value: 0.08,
        spread: 0.01,
        confidence: 0.99,
        windowCount: 2,
        algorithmVersion: "facial-kinematics-1.0",
        processorRef: "mediapipe-face-landmarker@visual-foundation-v1",
        sourceWindowRefs: ["face-neutral", "face-eye-closure"],
        confounds: visualConfounds(),
        uncertainty: {
          kind: "estimated",
          method: "median-absolute-deviation",
          value: 0.01,
          unit: "fraction"
        },
        clinicalValidation: "none"
      },
      {
        code: "prototype.face.smile_excursion.asymmetry",
        label: "Smile excursion asymmetry",
        unit: "inter-eye-normalized-distance",
        contextKind: "smile",
        value: 0.04,
        spread: 0.02,
        confidence: 0.6,
        windowCount: 2,
        algorithmVersion: "facial-kinematics-1.0",
        processorRef: "mediapipe-face-landmarker@visual-foundation-v1",
        sourceWindowRefs: ["face-neutral", "face-smile"],
        confounds: visualConfounds(),
        uncertainty: {
          kind: "estimated",
          method: "median-absolute-deviation",
          value: 0.02,
          unit: "inter-eye-normalized-distance"
        },
        clinicalValidation: "none"
      }
    );

    const facts = createEncounterClaimFacts(observation, []);
    const outcomes = createModalityOutcomes(observation, []);
    expect(facts.find((fact) => fact.modality === "face")).toMatchObject(
      {
        measurementCode: "prototype.face.smile_excursion.asymmetry",
        supportRefs: ["face-neutral", "face-smile"]
      }
    );
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]).toMatchObject({
      status: "measured",
      modality: "face",
      measurementCode: "prototype.face.smile_excursion.asymmetry",
      supportRefs: ["face-neutral", "face-smile"],
      qualityFacts: {
        processorRef:
          "mediapipe-face-landmarker@visual-foundation-v1"
      }
    });

    observation.aggregates = observation.aggregates.filter(
      (aggregate) =>
        aggregate.code !==
        "prototype.face.smile_excursion.asymmetry"
    );
    expect(createModalityOutcomes(observation, [])[0]).toMatchObject({
      status: "measured",
      measurementCode:
        "prototype.face.eye_closure_fraction.asymmetry",
      supportRefs: ["face-neutral", "face-eye-closure"]
    });

    observation.aggregates = observation.aggregates.filter(
      (aggregate) =>
        aggregate.code !==
        "prototype.face.eye_closure_fraction.asymmetry"
    );
    observation.aggregates.push({
      code: "prototype.face.smile_excursion.left",
      label: "Left smile excursion",
      unit: "inter-eye-normalized-distance",
      contextKind: "smile",
      value: 0.2,
      spread: 0.01,
      confidence: 1,
      windowCount: 2,
      algorithmVersion: "facial-kinematics-1.0",
      processorRef:
        "mediapipe-face-landmarker@visual-foundation-v1",
      sourceWindowRefs: ["face-neutral", "face-smile"],
      confounds: visualConfounds(),
      uncertainty: {
        kind: "estimated",
        method: "median-absolute-deviation",
        value: 0.01,
        unit: "inter-eye-normalized-distance"
      },
      clinicalValidation: "none"
    });
    expect(createModalityOutcomes(observation, [])[0]).toMatchObject({
      status: "withheld",
      modality: "face"
    });
  });

  it("creates a traceable withheld outcome when one modality is unavailable", () => {
    const observation = createObservation();
    observation.selectedProtocolId = "facial-foundation.v1";
    observation.aggregates = [];
    observation.abstentions.push({
      modality: "face",
      windowStartMs: 4_000,
      windowEndMs: 14_000,
      reasonCode: "face-not-visible",
      detail: "No facial value was produced."
    });
    observation.qualitySummary.abstentionCount = 1;
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
      "withheld"
    ]);
    expect(outcomes[0]).toMatchObject({
      modality: "face",
      reasonCode: "face-not-visible"
    });
  });
});
