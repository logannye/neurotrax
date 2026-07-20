import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { runConductor, type FrameStream } from "@phenometric/ambient-core";
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

function history(): TrajectoryHistoryRecord[] {
  const path = fileURLToPath(
    new URL("../fixtures/synthetic-history.json", import.meta.url)
  );
  return JSON.parse(readFileSync(path, "utf8")) as TrajectoryHistoryRecord[];
}

function currentObservation(): EncounterObservation {
  const path = fileURLToPath(
    new URL(
      "../../ambient-core/fixtures/synthetic-visit.frames.json",
      import.meta.url
    )
  );
  const stream = JSON.parse(readFileSync(path, "utf8")) as FrameStream;
  return runConductor(
    {
      ...stream,
      visitId: "live-current",
      participantId: "developer-self-demo",
      captureMode: "live",
      occurredAt: "2026-07-18T16:00:00.000Z",
      captureAdapter: { id: "macbook-browser", version: "0.3.0" }
    },
    { baseTimeMs: Date.parse("2026-07-18T16:00:00.000Z") }
  ).observation;
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
      aggregates: [voiceAggregate()]
    };
    const observation = {
      ...voiceObservation(),
      aggregates: [current]
    };
    const comparison = compareTrajectory(observation, [prior]).comparison;
    expect(comparison.biomarkers).toEqual([]);
    expect(comparison.excludedEncounters[0].reasonCodes).toContain(reason);
  });

  it("uses an explicit nonclinical direction vocabulary", () => {
    const comparison = compareTrajectory(
      currentObservation(),
      history()
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
      aggregates: [
        { ...sustained, value: 13 },
        { ...reading, value: 8 }
      ]
    };

    const comparison = compareTrajectory(observation, [prior]).comparison;
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
    const comparison = compareTrajectory(currentObservation(), [prior])
      .comparison;
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

    const comparison = compareTrajectory(faceOnly(), [prior]).comparison;
    expect(comparison.biomarkers).toEqual([]);
    expect(comparison.excludedEncounters[0].reasonCodes).toContain(
      "visual-processor-mismatch"
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

    const comparison = compareTrajectory(faceOnly(), [prior]).comparison;
    expect(comparison.excludedEncounters[0].reasonCodes).toContain(reason);
    expect(comparison.biomarkers).toEqual([]);
  });

  it("uses both neutral and active windows as current evidence references", () => {
    const comparison = compareTrajectory(
      faceOnly(),
      history().slice(0, 1)
    ).comparison;
    expect(comparison.biomarkers[0].currentEvidenceRefs).toHaveLength(2);
  });
});
