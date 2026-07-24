import type {
  BiomarkerAggregate,
  BiomarkerComparison,
  CompatibilityDecision,
  EncounterObservation,
  EventEnvelope,
  TrajectoryComparison,
  TrajectoryCompatibilityReasonCode,
  TrajectoryDirection,
  TrajectoryHistoryRecord,
  TrajectoryPolicy
} from "@phenometric/contracts";
import { createEventFactory } from "@phenometric/ambient-core";

export const DEFAULT_TRAJECTORY_POLICY: TrajectoryPolicy = {
  id: "ambient-context-and-confounds.v0.1",
  minimumPriorObservations: 3,
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
): TrajectoryCompatibilityReasonCode[] {
  const reasons: TrajectoryCompatibilityReasonCode[] = [];
  if (current.code.includes(".voice.")) {
    if (
      current.confounds.kind !== "speech" ||
      prior.confounds.kind !== "speech"
    ) {
      return ["confound-envelope-kind-mismatch"];
    }
    if (
      Math.abs(current.confounds.snrDb - prior.confounds.snrDb) >
      policy.speechSnrToleranceDb
    ) {
      reasons.push("speech-snr-out-of-tolerance");
    }
    if (
      current.confounds.sampleRateClass !==
      prior.confounds.sampleRateClass
    ) {
      reasons.push("voice-sample-rate-class-mismatch");
    }
    if (
      JSON.stringify(current.confounds.browserProcessing) !==
      JSON.stringify(prior.confounds.browserProcessing)
    ) {
      reasons.push("voice-browser-processing-mismatch");
    }
  }
  if (current.code.includes(".face.")) {
    if (
      current.confounds.kind !== "visual" ||
      prior.confounds.kind !== "visual"
    ) {
      return ["confound-envelope-kind-mismatch"];
    }
    if (
      Math.max(
        Math.abs(
          current.confounds.faceWidthFraction -
            prior.confounds.faceWidthFraction
        ),
        Math.abs(
          current.confounds.faceHeightFraction -
            prior.confounds.faceHeightFraction
        )
      ) > policy.faceFramingTolerance
    ) {
      reasons.push("face-framing-out-of-tolerance");
    }
    const baselineFrameRate = Math.max(
      1,
      prior.confounds.analyzedFrameRate
    );
    if (
      Math.abs(
        current.confounds.analyzedFrameRate -
          prior.confounds.analyzedFrameRate
      ) /
        baselineFrameRate >
      policy.frameRateToleranceFraction
    ) {
      reasons.push("frame-rate-out-of-tolerance");
    }
    if (
      Math.abs(
        current.confounds.illuminationMean -
          prior.confounds.illuminationMean
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
): {
  aggregate: BiomarkerAggregate | null;
  reasons: TrajectoryCompatibilityReasonCode[];
} {
  const sameCode = record.aggregates.find(
    (aggregate) =>
      aggregate.code === current.code &&
      aggregate.contextKind === current.contextKind
  );
  if (!sameCode) return { aggregate: null, reasons: [] };
  if (sameCode.unit !== current.unit) {
    return { aggregate: null, reasons: ["unit-mismatch"] };
  }
  if (sameCode.algorithmVersion !== current.algorithmVersion) {
    return { aggregate: null, reasons: ["algorithm-version-mismatch"] };
  }
  if (
    current.code.includes(".voice.") &&
    sameCode.processorRef !== current.processorRef
  ) {
    return { aggregate: null, reasons: ["voice-processor-mismatch"] };
  }
  if (
    current.code.includes(".face.") &&
    sameCode.processorRef !== current.processorRef
  ) {
    return { aggregate: null, reasons: ["visual-processor-mismatch"] };
  }
  const reasons = confoundReasons(current, sameCode, policy);
  return { aggregate: reasons.length === 0 ? sameCode : null, reasons };
}

function aggregateKey(
  aggregate: Pick<BiomarkerAggregate, "code" | "contextKind">
): string {
  return `${aggregate.code}\u0000${aggregate.contextKind}`;
}

function validatePolicy(policy: TrajectoryPolicy): void {
  if (!policy || policy.id.trim().length === 0) {
    throw new Error("Trajectory comparison requires an explicit policy.");
  }
  if (
    !Number.isSafeInteger(policy.minimumPriorObservations) ||
    policy.minimumPriorObservations < 1
  ) {
    throw new Error("Trajectory policy minimumPriorObservations must be positive.");
  }
  for (const [name, value] of Object.entries(policy)) {
    if (
      name !== "id" &&
      (!Number.isFinite(value) || (value as number) < 0)
    ) {
      throw new Error(`Trajectory policy ${name} must be finite and non-negative.`);
    }
  }
}

function aggregateValidationReasons(
  aggregate: BiomarkerAggregate
): TrajectoryCompatibilityReasonCode[] {
  const reasons: TrajectoryCompatibilityReasonCode[] = [];
  if (
    !Number.isFinite(aggregate.value) ||
    !Number.isFinite(aggregate.spread) ||
    !Number.isFinite(aggregate.confidence) ||
    Object.values(aggregate.confounds).some(
      (value) => typeof value === "number" && !Number.isFinite(value)
    )
  ) {
    reasons.push("nonfinite-aggregate");
  }
  if (aggregate.spread < 0) reasons.push("negative-aggregate-spread");
  if (aggregate.confidence < 0 || aggregate.confidence > 1) {
    reasons.push("aggregate-confidence-out-of-range");
  }
  if (aggregate.sourceWindowRefs.length === 0) {
    reasons.push("missing-aggregate-evidence");
  }
  if (
    aggregate.code.trim().length === 0 ||
    aggregate.label.trim().length === 0 ||
    aggregate.unit.trim().length === 0 ||
    aggregate.algorithmVersion.trim().length === 0 ||
    aggregate.processorRef.trim().length === 0 ||
    aggregate.windowCount < 1 ||
    aggregate.sourceWindowRefs.some((reference) => reference.trim().length === 0)
  ) {
    reasons.push("invalid-aggregate-metadata");
  }
  return reasons;
}

function duplicateAggregateIdentities(
  aggregates: BiomarkerAggregate[]
): boolean {
  const keys = aggregates.map((aggregate) => aggregateKey(aggregate));
  return new Set(keys).size !== keys.length;
}

export function compareTrajectory(
  current: EncounterObservation,
  history: TrajectoryHistoryRecord[],
  policy: TrajectoryPolicy,
  options: TrajectoryOptions = {}
): { comparison: TrajectoryComparison; events: EventEnvelope[] } {
  if (current.containsPHI !== false) {
    throw new Error("Trajectory comparison requires containsPHI: false.");
  }
  validatePolicy(policy);
  const currentTime = Date.parse(current.occurredAt);
  if (!Number.isFinite(currentTime)) {
    throw new Error("Current observation occurredAt must be a valid timestamp.");
  }
  if (current.aggregates.length === 0) {
    throw new Error("Current observation requires at least one aggregate.");
  }
  if (duplicateAggregateIdentities(current.aggregates)) {
    throw new Error("Current observation contains duplicate aggregate identities.");
  }
  const currentAggregateReasons = current.aggregates.flatMap(
    aggregateValidationReasons
  );
  if (currentAggregateReasons.length > 0) {
    throw new Error(
      `Current observation contains invalid aggregates: ${[
        ...new Set(currentAggregateReasons)
      ].join(", ")}.`
    );
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
  const compatibleByCodeAndContext = new Map<
    string,
    Array<{ record: TrajectoryHistoryRecord; aggregate: BiomarkerAggregate }>
  >();

  const encounterIdCounts = new Map<string, number>();
  for (const record of history) {
    encounterIdCounts.set(
      record.visitId,
      (encounterIdCounts.get(record.visitId) ?? 0) + 1
    );
  }

  for (const record of history) {
    const recordReasons = new Set<TrajectoryCompatibilityReasonCode>();
    if (record.containsPHI !== false) {
      recordReasons.add("history-not-explicitly-non-phi");
    }
    if (record.reviewStatus !== "accepted") {
      recordReasons.add("history-not-accepted");
    }
    if (record.selectedProtocolId !== current.selectedProtocolId) {
      recordReasons.add("protocol-id-mismatch");
    }
    if (record.participantId !== current.participantId) {
      recordReasons.add("participant-mismatch");
    }
    if (record.visitId === current.visitId) {
      recordReasons.add("same-as-current-encounter");
    }
    const recordTime = Date.parse(record.occurredAt);
    if (!Number.isFinite(recordTime)) {
      recordReasons.add("invalid-occurred-at");
    } else if (recordTime >= currentTime) {
      recordReasons.add("not-prior-to-current");
    }
    if ((encounterIdCounts.get(record.visitId) ?? 0) > 1) {
      recordReasons.add("duplicate-encounter-id");
    }
    if (duplicateAggregateIdentities(record.aggregates)) {
      recordReasons.add("duplicate-aggregate-identity");
    }
    for (const aggregate of record.aggregates) {
      for (const reason of aggregateValidationReasons(aggregate)) {
        recordReasons.add(reason);
      }
    }
    let matchedCount = 0;
    if (recordReasons.size === 0) {
      for (const aggregate of current.aggregates) {
        const result = compatibleAggregate(aggregate, record, policy);
        if (result.aggregate) {
          matchedCount += 1;
          const key = aggregateKey(aggregate);
          const bucket =
            compatibleByCodeAndContext.get(key) ?? [];
          bucket.push({ record, aggregate: result.aggregate });
          compatibleByCodeAndContext.set(key, bucket);
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
    const matches =
      compatibleByCodeAndContext.get(
        aggregateKey(currentAggregate)
      ) ?? [];
    if (matches.length < policy.minimumPriorObservations) continue;
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
      processorRef: currentAggregate.processorRef,
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
      currentEvidenceRefs: [...currentAggregate.sourceWindowRefs],
      referenceMeasurementRefs: matches.map(
        ({ record }) =>
          `${record.visitId}:${currentAggregate.code}:${currentAggregate.contextKind}:${currentAggregate.unit}`
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
    biomarkers: biomarkers.sort(
      (left, right) =>
        left.code.localeCompare(right.code) ||
        left.contextKind.localeCompare(right.contextKind)
    ),
    status: biomarkers.length > 0 ? "provisional" : "not-comparable",
    reasonCodes:
      biomarkers.length > 0 ? [] : ["insufficient-prior-observations"],
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
