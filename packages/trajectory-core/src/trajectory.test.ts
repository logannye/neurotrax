import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { runConductor, type FrameStream } from "@phenometric/ambient-core";
import type {
  EncounterObservation,
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
    ).toEqual([
      "prototype.face.smile_excursion.asymmetry",
      "prototype.speech.pitch_variability"
    ]);
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

  it("excludes speech values outside the SNR tolerance", () => {
    const current = currentObservation();
    const degraded: EncounterObservation = {
      ...current,
      aggregates: current.aggregates.map((aggregate) =>
        aggregate.confounds.kind === "speech"
          ? {
              ...aggregate,
              confounds: { ...aggregate.confounds, snrDb: 2 }
            }
          : aggregate
      )
    };

    const comparison = compareTrajectory(degraded, history()).comparison;
    expect(
      comparison.biomarkers.some(
        (biomarker) =>
          biomarker.code === "prototype.speech.pitch_variability"
      )
    ).toBe(false);
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
