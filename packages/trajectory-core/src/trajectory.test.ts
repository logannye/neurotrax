import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type {
  BiomarkerAggregate,
  EncounterObservation,
  SpeechConfoundEnvelope,
  TrajectoryHistoryRecord,
  VisualConfoundEnvelope
} from "@phenometric/contracts";
import {
  compareTrajectory,
  DEFAULT_TRAJECTORY_POLICY
} from "./trajectory.js";

const SINGLE_PRIOR_POLICY = {
  ...DEFAULT_TRAJECTORY_POLICY,
  minimumPriorObservations: 1
};

function history(): TrajectoryHistoryRecord[] {
  const path = fileURLToPath(
    new URL("../fixtures/synthetic-history.json", import.meta.url)
  );
  return JSON.parse(readFileSync(path, "utf8")) as TrajectoryHistoryRecord[];
}

function currentObservation(): EncounterObservation {
  const source = history()[2];
  const aggregate = {
    ...source.aggregates[0],
    value: 0.022,
    sourceWindowRefs: ["live-current:neutral", "live-current:smile"]
  };
  return {
    schemaVersion: "phenometric.encounter-observation.v2",
    containsPHI: false,
    rawMediaRetained: false,
    rawAudioRetained: false,
    nativeAudioObservationsRetained: false,
    transcriptRetained: false,
    voiceEmbeddingsRetained: false,
    nativeVisualObservationsRetained: false,
    selectedProtocolId: source.selectedProtocolId,
    captureMode: "live",
    visitId: "live-current",
    participantId: "developer-self-demo",
    occurredAt: "2026-07-18T16:00:00.000Z",
    captureAdapter: { id: "macbook-browser", version: "0.3.0" },
    audioPipeline: null,
    audioCaptureSettings: null,
    voiceModel: null,
    audioStreamDiagnostics: null,
    visualPipeline: null,
    videoCaptureSettings: null,
    windows: [],
    measurements: [],
    aggregates: [aggregate],
    abstentions: [],
    measurementCount: 0,
    qualitySummary: {
      speechWindowCount: 0,
      faceWindowCount: 0,
      abstentionCount: 0,
      qualityTransitionCount: 0,
      audioFrameCount: 0,
      speechActiveFrameCount: 0,
      pitchedFrameCount: 0,
      pitchCoverage: 0,
      audioLostBlockFraction: 0,
      maximumAudioBlockGapMs: 0,
      medianAudioSnrDb: 0,
      faceFrameCount: 0,
      usableFaceFrameCount: 0,
      usableFaceFraction: 0,
      faceWithholdingDurationMs: 0,
      faceRecoveryObserved: false,
      postRecoveryFaceWindowCount: 0
    }
  };
}

function faceOnly(current = currentObservation()): EncounterObservation {
  return {
    ...current,
    aggregates: current.aggregates.filter(
      (aggregate) =>
        aggregate.code === "prototype.face.smile_excursion.asymmetry"
    )
  };
}

function voiceConfounds(
  overrides: Partial<SpeechConfoundEnvelope> = {}
): SpeechConfoundEnvelope {
  return {
    kind: "speech",
    sampleRateHz: 48_000,
    sampleRateClass: "48khz-or-higher",
    browserProcessing: {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false
    },
    snrDb: 26,
    clippingFraction: 0,
    dcOffset: 0,
    lostBlockFraction: 0,
    maximumBlockGapMs: 20,
    usableCoverage: 1,
    periodicityCoverage: 0.9,
    ...overrides
  };
}

function voiceAggregate(
  overrides: Partial<BiomarkerAggregate> = {}
): BiomarkerAggregate {
  return {
    code: "prototype.voice.cpps",
    label: "Smoothed cepstral peak prominence",
    unit: "dB",
    contextKind: "sustained-vowel",
    value: 14,
    spread: 0.4,
    confidence: 0.92,
    windowCount: 2,
    algorithmVersion: "voice-analysis-1.0",
    processorRef: "browser-voice-dsp@1.0",
    sourceWindowRefs: ["speech-vowel-1", "speech-vowel-2"],
    confounds: voiceConfounds(),
    uncertainty: {
      kind: "estimated",
      method: "median-absolute-deviation",
      value: 0.3,
      unit: "dB"
    },
    clinicalValidation: "none",
    ...overrides
  };
}

function voiceObservation(): EncounterObservation {
  return {
    ...currentObservation(),
    selectedProtocolId: "voice-foundation.v1",
    visualPipeline: null,
    videoCaptureSettings: null,
    aggregates: [voiceAggregate()]
  };
}

describe("compareTrajectory", () => {
  it("includes three compatible synthetic encounters and excludes old algorithms", () => {
    const result = compareTrajectory(
      currentObservation(),
      history(),
      DEFAULT_TRAJECTORY_POLICY,
      { baseTimeMs: Date.parse("2026-07-18T16:00:00.000Z") }
    );

    expect(result.comparison.includedEncounterIds).toHaveLength(3);
    expect(result.comparison.excludedEncounters).toEqual([
      expect.objectContaining({
        encounterId: "synthetic-history-2026-03-incompatible",
        reasonCodes: expect.arrayContaining(["algorithm-version-mismatch"])
      })
    ]);
    expect(
      result.comparison.biomarkers.map((biomarker) => biomarker.code)
    ).toEqual(["prototype.face.smile_excursion.asymmetry"]);
    expect(
      result.comparison.biomarkers.find((biomarker) =>
        biomarker.code.startsWith("prototype.face.")
      )?.processorRef
    ).toContain("mediapipe-face-landmarker");
    expect(result.events.map((event) => event.type)).toEqual([
      "trajectory.compatibility.assessed",
      "trajectory.comparison.completed"
    ]);
  });

  it.each([
    {
      name: "processor",
      reason: "voice-processor-mismatch",
      current: voiceAggregate({ processorRef: "browser-voice-dsp@2.0" })
    },
    {
      name: "sample-rate class",
      reason: "voice-sample-rate-class-mismatch",
      current: voiceAggregate({
        confounds: voiceConfounds({
          sampleRateHz: 44_100,
          sampleRateClass: "44.1khz"
        })
      })
    },
    {
      name: "browser processing",
      reason: "voice-browser-processing-mismatch",
      current: voiceAggregate({
        confounds: voiceConfounds({
          browserProcessing: {
            echoCancellation: true,
            noiseSuppression: false,
            autoGainControl: false
          }
        })
      })
    },
    {
      name: "SNR",
      reason: "speech-snr-out-of-tolerance",
      current: voiceAggregate({
        confounds: voiceConfounds({ snrDb: 2 })
      })
    }
  ])("requires exact compatible voice $name", ({ current, reason }) => {
    const prior: TrajectoryHistoryRecord = {
      ...history()[0],
      selectedProtocolId: "voice-foundation.v1",
      aggregates: [voiceAggregate()]
    };
    const observation = {
      ...voiceObservation(),
      aggregates: [current]
    };
    const comparison = compareTrajectory(
      observation,
      [prior],
      DEFAULT_TRAJECTORY_POLICY
    ).comparison;
    expect(comparison.biomarkers).toEqual([]);
    expect(comparison.excludedEncounters[0].reasonCodes).toContain(reason);
  });

  it("uses an explicit nonclinical direction vocabulary", () => {
    const comparison = compareTrajectory(
      currentObservation(),
      history(),
      DEFAULT_TRAJECTORY_POLICY
    ).comparison;
    expect(
      comparison.biomarkers.every((biomarker) =>
        [
          "within-reference",
          "above-reference",
          "below-reference",
          "not-comparable"
        ].includes(biomarker.direction)
      )
    ).toBe(true);
  });

  it("never mixes the same voice measurement across task contexts", () => {
    const sustained = voiceAggregate({
      contextKind: "sustained-vowel",
      value: 14
    });
    const reading = voiceAggregate({
      contextKind: "reading-aloud",
      value: 9,
      sourceWindowRefs: ["speech-reading"]
    });
    const observation = {
      ...voiceObservation(),
      aggregates: [sustained, reading]
    };
    const prior: TrajectoryHistoryRecord = {
      ...history()[0],
      selectedProtocolId: "voice-foundation.v1",
      aggregates: [
        { ...sustained, value: 13 },
        { ...reading, value: 8 }
      ]
    };

    const comparison = compareTrajectory(
      observation,
      [prior],
      SINGLE_PRIOR_POLICY
    ).comparison;
    expect(comparison.biomarkers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          contextKind: "sustained-vowel",
          priorValues: [
            expect.objectContaining({ value: 13 })
          ]
        }),
        expect.objectContaining({
          contextKind: "reading-aloud",
          priorValues: [
            expect.objectContaining({ value: 8 })
          ]
        })
      ])
    );
  });

  it.each([
    {
      name: "review state",
      reason: "history-not-accepted",
      mutate: (record: TrajectoryHistoryRecord) => ({
        ...record,
        reviewStatus: "rejected" as const
      })
    },
    {
      name: "participant identity",
      reason: "participant-mismatch",
      mutate: (record: TrajectoryHistoryRecord) => ({
        ...record,
        participantId: "different-synthetic-participant"
      })
    },
    {
      name: "detected context",
      reason: "no-compatible-biomarkers",
      mutate: (record: TrajectoryHistoryRecord) => ({
        ...record,
        aggregates: record.aggregates.map((aggregate) => ({
          ...aggregate,
          contextKind:
            aggregate.contextKind === "spontaneous-speech"
              ? ("sustained-vowel" as const)
              : ("listening-expressive" as const)
        }))
      })
    },
    {
      name: "algorithm version",
      reason: "algorithm-version-mismatch",
      mutate: (record: TrajectoryHistoryRecord) => ({
        ...record,
        aggregates: record.aggregates.map((aggregate) => ({
          ...aggregate,
          algorithmVersion: "old-algorithm"
        }))
      })
    }
  ])("excludes a prior encounter that fails $name", ({ reason, mutate }) => {
    const prior = mutate(history()[0]);
    const comparison = compareTrajectory(
      currentObservation(),
      [prior],
      DEFAULT_TRAJECTORY_POLICY
    ).comparison;
    expect(comparison.excludedEncounters).toEqual([
      {
        encounterId: prior.visitId,
        reasonCodes: expect.arrayContaining([reason])
      }
    ]);
  });

  it("requires an exact visual processor reference", () => {
    const prior: TrajectoryHistoryRecord = {
      ...history()[0],
      aggregates: history()[0].aggregates
        .filter((aggregate) => aggregate.code.startsWith("prototype.face."))
        .map((aggregate) => ({
          ...aggregate,
          processorRef: "different-visual-processor"
        }))
    };

    const comparison = compareTrajectory(
      faceOnly(),
      [prior],
      DEFAULT_TRAJECTORY_POLICY
    ).comparison;
    expect(comparison.biomarkers).toEqual([]);
    expect(comparison.excludedEncounters[0].reasonCodes).toContain(
      "visual-processor-mismatch"
    );
  });

  it("starts a fresh baseline when the unified protocol replaces a legacy protocol", () => {
    const unified = {
      ...faceOnly(),
      selectedProtocolId: "unified-foundation.v1" as const
    };
    const comparison = compareTrajectory(
      unified,
      history().slice(0, 1),
      DEFAULT_TRAJECTORY_POLICY
    ).comparison;

    expect(comparison.biomarkers).toEqual([]);
    expect(comparison.excludedEncounters[0].reasonCodes).toContain(
      "protocol-id-mismatch"
    );
  });

  it.each([
    {
      name: "face framing",
      reason: "face-framing-out-of-tolerance",
      confounds: { faceWidthFraction: 0.1 }
    },
    {
      name: "frame rate",
      reason: "frame-rate-out-of-tolerance",
      confounds: { analyzedFrameRate: 15 }
    },
    {
      name: "illumination",
      reason: "illumination-out-of-tolerance",
      confounds: { illuminationMean: 0.2 }
    }
  ])("applies the $name tolerance per face metric", ({ reason, confounds }) => {
    const prior: TrajectoryHistoryRecord = {
      ...history()[0],
      aggregates: history()[0].aggregates
        .filter((aggregate) => aggregate.code.startsWith("prototype.face."))
        .map((aggregate) => ({
          ...aggregate,
          confounds: {
            ...(aggregate.confounds as VisualConfoundEnvelope),
            ...confounds
          }
        }))
    };

    const comparison = compareTrajectory(
      faceOnly(),
      [prior],
      DEFAULT_TRAJECTORY_POLICY
    ).comparison;
    expect(comparison.excludedEncounters[0].reasonCodes).toContain(reason);
    expect(comparison.biomarkers).toEqual([]);
  });

  it("uses both neutral and active windows as current evidence references", () => {
    const comparison = compareTrajectory(
      faceOnly(),
      history().slice(0, 1),
      SINGLE_PRIOR_POLICY
    ).comparison;
    expect(comparison.biomarkers[0].currentEvidenceRefs).toHaveLength(2);
  });

  it("fails closed for self, future, and duplicate history", () => {
    const current = currentObservation();
    const compatible = history()[0];
    const self = {
      ...compatible,
      visitId: current.visitId,
      occurredAt: "2026-06-01T16:00:00.000Z"
    };
    const future = {
      ...compatible,
      visitId: "future-visit",
      occurredAt: "2026-08-01T16:00:00.000Z"
    };
    const duplicate = {
      ...compatible,
      visitId: "duplicate-visit"
    };

    const comparison = compareTrajectory(
      current,
      [self, future, duplicate, structuredClone(duplicate)],
      DEFAULT_TRAJECTORY_POLICY
    ).comparison;

    expect(comparison.biomarkers).toEqual([]);
    expect(comparison.status).toBe("not-comparable");
    expect(
      comparison.excludedEncounters.find(
        (encounter) => encounter.encounterId === current.visitId
      )?.reasonCodes
    ).toContain("same-as-current-encounter");
    expect(
      comparison.excludedEncounters.find(
        (encounter) => encounter.encounterId === "future-visit"
      )?.reasonCodes
    ).toContain("not-prior-to-current");
    expect(
      comparison.excludedEncounters.filter(
        (encounter) => encounter.encounterId === "duplicate-visit"
      )
    ).toHaveLength(2);
    expect(
      comparison.excludedEncounters.find(
        (encounter) => encounter.encounterId === "duplicate-visit"
      )?.reasonCodes
    ).toContain("duplicate-encounter-id");
  });

  it("requires exact units and the policy minimum prior count", () => {
    const prior = history()[0];
    const unitMismatch: TrajectoryHistoryRecord = {
      ...prior,
      aggregates: prior.aggregates.map((aggregate) => ({
        ...aggregate,
        unit: "different-unit"
      }))
    };
    const incompatible = compareTrajectory(
      currentObservation(),
      [unitMismatch],
      SINGLE_PRIOR_POLICY
    ).comparison;
    expect(incompatible.excludedEncounters[0].reasonCodes).toContain(
      "unit-mismatch"
    );

    const insufficient = compareTrajectory(
      currentObservation(),
      [prior],
      DEFAULT_TRAJECTORY_POLICY
    ).comparison;
    expect(insufficient.status).toBe("not-comparable");
    expect(insufficient.reasonCodes).toContain(
      "insufficient-prior-observations"
    );
  });

  it("rejects nonfinite current values and excludes nonfinite history", () => {
    const current = currentObservation();
    current.aggregates[0].value = Number.NaN;
    expect(() =>
      compareTrajectory(current, history(), DEFAULT_TRAJECTORY_POLICY)
    ).toThrow(/invalid aggregates/);

    const invalidPrior = history()[0];
    invalidPrior.aggregates[0].value = Number.POSITIVE_INFINITY;
    const comparison = compareTrajectory(
      currentObservation(),
      [invalidPrior],
      SINGLE_PRIOR_POLICY
    ).comparison;
    expect(comparison.excludedEncounters[0].reasonCodes).toContain(
      "nonfinite-aggregate"
    );
  });
});
