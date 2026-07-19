import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { runConductor, type FrameStream } from "@phenometric/ambient-core";
import type {
  EncounterObservation,
  TrajectoryHistoryRecord
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
  const observation = runConductor(
    {
      ...stream,
      visitId: "live-current",
      participantId: "developer-self-demo",
      captureMode: "live",
      occurredAt: "2026-07-18T16:00:00.000Z",
      captureAdapter: { id: "macbook-browser", version: "0.2.0" }
    },
    { baseTimeMs: Date.parse("2026-07-18T16:00:00.000Z") }
  ).observation;

  return {
    ...observation,
    aggregates: observation.aggregates.map((aggregate) =>
      aggregate.code.startsWith("prototype.face.")
        ? {
            ...aggregate,
            confounds: {
              ...aggregate.confounds,
              observedFrameRate: 10,
              illuminationRelative: 0.59,
              faceFramingFraction: 0.85
            }
          }
        : aggregate
    )
  };
}

describe("compareTrajectory", () => {
  it("includes three compatible synthetic encounters and excludes the old algorithm", () => {
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
    ).toEqual(
      expect.arrayContaining([
        "prototype.speech.pitch_variability",
        "prototype.face.expressivity"
      ])
    );
    expect(result.events.map((event) => event.type)).toEqual([
      "trajectory.compatibility.assessed",
      "trajectory.comparison.completed"
    ]);
  });

  it("excludes speech values outside the SNR tolerance", () => {
    const current = currentObservation();
    const degraded = {
      ...current,
      aggregates: current.aggregates.map((aggregate) =>
        aggregate.code.startsWith("prototype.speech.")
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
              : ("reading-aloud" as const)
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

  it.each([
    {
      name: "face framing",
      reason: "face-framing-out-of-tolerance",
      confounds: { faceFramingFraction: 0.55 }
    },
    {
      name: "frame rate",
      reason: "frame-rate-out-of-tolerance",
      confounds: { observedFrameRate: 6 }
    },
    {
      name: "illumination",
      reason: "illumination-out-of-tolerance",
      confounds: { illuminationRelative: 0.3 }
    }
  ])("applies the $name tolerance per face biomarker", ({ reason, confounds }) => {
    const current = currentObservation();
    const faceOnly: EncounterObservation = {
      ...current,
      aggregates: current.aggregates.filter(
        (aggregate) => aggregate.code === "prototype.face.expressivity"
      )
    };
    const prior: TrajectoryHistoryRecord = {
      ...history()[0],
      aggregates: history()[0].aggregates
        .filter(
          (aggregate) => aggregate.code === "prototype.face.expressivity"
        )
        .map((aggregate) => ({
          ...aggregate,
          confounds: { ...aggregate.confounds, ...confounds }
        }))
    };

    const comparison = compareTrajectory(faceOnly, [prior]).comparison;
    expect(comparison.excludedEncounters[0].reasonCodes).toContain(reason);
    expect(comparison.biomarkers).toEqual([]);
  });
});
