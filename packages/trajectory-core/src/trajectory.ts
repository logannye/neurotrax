import type {
  BiomarkerAggregate,
  BiomarkerComparison,
  CompatibilityDecision,
  EncounterObservation,
  EventEnvelope,
  TrajectoryComparison,
  TrajectoryDirection,
  TrajectoryHistoryRecord,
  TrajectoryPolicy
} from "@phenometric/contracts";
import { createEventFactory } from "@phenometric/ambient-core";

export const DEFAULT_TRAJECTORY_POLICY: TrajectoryPolicy = {
  id: "ambient-context-and-confounds.v0.1",
  speechSnrToleranceDb: 6,
  faceFramingTolerance: 0.15,
  frameRateToleranceFraction: 0.25,
  illuminationTolerance: 0.2
};

export interface TrajectoryOptions {
  baseTimeMs?: number;
  initialSequence?: number;
  occurredAtOffsetMs?: number;
  onEvent?: (event: EventEnvelope) => void;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function mad(values: number[]): number {
  const center = median(values);
  return median(values.map((value) => Math.abs(value - center)));
}

function directionFor(
  currentValue: number,
  minimum: number,
  maximum: number,
  priorMad: number
): TrajectoryDirection {
  const margin = priorMad * 2;
  if (currentValue < minimum - margin) return "below-reference";
  if (currentValue > maximum + margin) return "above-reference";
  return "within-reference";
}

function confoundReasons(
  current: BiomarkerAggregate,
  prior: BiomarkerAggregate,
  policy: TrajectoryPolicy
): string[] {
  const reasons: string[] = [];
  if (current.code.startsWith("prototype.speech.")) {
    if (
      Math.abs(current.confounds.snrDb - prior.confounds.snrDb) >
      policy.speechSnrToleranceDb
    ) {
      reasons.push("speech-snr-out-of-tolerance");
    }
  }
  if (current.code.startsWith("prototype.face.")) {
    if (
      Math.abs(
        current.confounds.faceFramingFraction -
          prior.confounds.faceFramingFraction
      ) > policy.faceFramingTolerance
    ) {
      reasons.push("face-framing-out-of-tolerance");
    }
    const baselineFrameRate = Math.max(
      1,
      prior.confounds.observedFrameRate
    );
    if (
      Math.abs(
        current.confounds.observedFrameRate -
          prior.confounds.observedFrameRate
      ) /
        baselineFrameRate >
      policy.frameRateToleranceFraction
    ) {
      reasons.push("frame-rate-out-of-tolerance");
    }
    if (
      Math.abs(
        current.confounds.illuminationRelative -
          prior.confounds.illuminationRelative
      ) > policy.illuminationTolerance
    ) {
      reasons.push("illumination-out-of-tolerance");
    }
  }
  return reasons;
}

function compatibleAggregate(
  current: BiomarkerAggregate,
  record: TrajectoryHistoryRecord,
  policy: TrajectoryPolicy
): { aggregate: BiomarkerAggregate | null; reasons: string[] } {
  const sameCode = record.aggregates.find(
    (aggregate) =>
      aggregate.code === current.code &&
      aggregate.contextKind === current.contextKind
  );
  if (!sameCode) return { aggregate: null, reasons: [] };
  if (sameCode.algorithmVersion !== current.algorithmVersion) {
    return { aggregate: null, reasons: ["algorithm-version-mismatch"] };
  }
  const reasons = confoundReasons(current, sameCode, policy);
  return { aggregate: reasons.length === 0 ? sameCode : null, reasons };
}

export function compareTrajectory(
  current: EncounterObservation,
  history: TrajectoryHistoryRecord[],
  policy: TrajectoryPolicy = DEFAULT_TRAJECTORY_POLICY,
  options: TrajectoryOptions = {}
): { comparison: TrajectoryComparison; events: EventEnvelope[] } {
  if (current.containsPHI !== false) {
    throw new Error("Trajectory comparison requires containsPHI: false.");
  }

  const baseTimeMs =
    options.baseTimeMs ?? Date.parse(current.occurredAt);
  const offsetMs = options.occurredAtOffsetMs ?? 0;
  const factory = createEventFactory({
    visitId: current.visitId,
    participantId: current.participantId,
    baseTimeMs,
    initialSequence: options.initialSequence
  });
  const events: EventEnvelope[] = [];
  const emit = (event: EventEnvelope): void => {
    events.push(event);
    options.onEvent?.(event);
  };

  const decisions: CompatibilityDecision[] = [];
  const compatibleByCode = new Map<
    string,
    Array<{ record: TrajectoryHistoryRecord; aggregate: BiomarkerAggregate }>
  >();

  for (const record of history) {
    const recordReasons = new Set<string>();
    if (record.containsPHI !== false) {
      recordReasons.add("history-not-explicitly-non-phi");
    }
    if (record.reviewStatus !== "accepted") {
      recordReasons.add("history-not-accepted");
    }
    if (record.participantId !== current.participantId) {
      recordReasons.add("participant-mismatch");
    }
    let matchedCount = 0;
    if (recordReasons.size === 0) {
      for (const aggregate of current.aggregates) {
        const result = compatibleAggregate(aggregate, record, policy);
        if (result.aggregate) {
          matchedCount += 1;
          const bucket = compatibleByCode.get(aggregate.code) ?? [];
          bucket.push({ record, aggregate: result.aggregate });
          compatibleByCode.set(aggregate.code, bucket);
        } else {
          result.reasons.forEach((reason) => recordReasons.add(reason));
        }
      }
    }

    const included = matchedCount > 0;
    if (!included && recordReasons.size === 0) {
      recordReasons.add("no-compatible-biomarkers");
    }
    decisions.push({
      encounterId: record.visitId,
      status: included ? "included" : "excluded",
      reasonCodes: included ? [] : [...recordReasons].sort()
    });
  }

  emit(
    factory.next(
      "personal-trajectory",
      "trajectory.compatibility.assessed",
      "personal-trajectory",
      `Assessed ${history.length} prior encounters for compatibility.`,
      offsetMs,
      {
        syntheticEncounterCount: history.filter((record) => record.synthetic)
          .length,
        acceptedSessionEncounterCount: history.filter(
          (record) => record.source === "accepted-live-session"
        ).length,
        includedEncounterIds: decisions
          .filter((decision) => decision.status === "included")
          .map((decision) => decision.encounterId),
        excludedEncounters: decisions.filter(
          (decision) => decision.status === "excluded"
        )
      }
    )
  );

  const biomarkers: BiomarkerComparison[] = [];
  for (const currentAggregate of current.aggregates) {
    const matches = compatibleByCode.get(currentAggregate.code) ?? [];
    if (matches.length === 0) continue;
    const values = matches.map((match) => match.aggregate.value);
    const priorMedian = median(values);
    const priorMinimum = Math.min(...values);
    const priorMaximum = Math.max(...values);
    const priorMad = mad(values);
    biomarkers.push({
      code: currentAggregate.code,
      label: currentAggregate.label,
      unit: currentAggregate.unit,
      contextKind: currentAggregate.contextKind,
      algorithmVersion: currentAggregate.algorithmVersion,
      currentValue: currentAggregate.value,
      priorValues: matches.map(({ record, aggregate }) => ({
        encounterId: record.visitId,
        occurredAt: record.occurredAt,
        value: aggregate.value,
        synthetic: record.synthetic
      })),
      priorMedian,
      priorMinimum,
      priorMaximum,
      priorMad,
      deltaFromMedian: currentAggregate.value - priorMedian,
      direction: directionFor(
        currentAggregate.value,
        priorMinimum,
        priorMaximum,
        priorMad
      ),
      currentEvidenceRefs: current.measurements
        .filter((measurement) => measurement.code === currentAggregate.code)
        .map((measurement) => measurement.contextRef),
      referenceMeasurementRefs: matches.map(
        ({ record }) => `${record.visitId}:${currentAggregate.code}`
      )
    });
  }

  const includedEncounterIds = decisions
    .filter((decision) => decision.status === "included")
    .map((decision) => decision.encounterId);
  const excludedEncounters = decisions
    .filter((decision) => decision.status === "excluded")
    .map((decision) => ({
      encounterId: decision.encounterId,
      reasonCodes: decision.reasonCodes
    }));
  const comparison: TrajectoryComparison = {
    containsPHI: false,
    comparisonId: `comparison-${current.visitId}`,
    participantId: current.participantId,
    currentVisitId: current.visitId,
    policyId: policy.id,
    decisions,
    includedEncounterIds,
    excludedEncounters,
    biomarkers: biomarkers.sort((left, right) =>
      left.code.localeCompare(right.code)
    ),
    status: "provisional",
    claimBoundary:
      "No disease progression, diagnosis, cause, or treatment inference."
  };

  emit(
    factory.next(
      "personal-trajectory",
      "trajectory.comparison.completed",
      "personal-trajectory",
      `Created ${biomarkers.length} provisional personal comparisons.`,
      offsetMs + 1,
      {
        comparisonId: comparison.comparisonId,
        biomarkerCount: biomarkers.length
      },
      biomarkers.flatMap((biomarker) => biomarker.currentEvidenceRefs)
    )
  );

  return { comparison, events };
}
