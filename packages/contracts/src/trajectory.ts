import type {
  BiomarkerAggregate,
  CaptureAdapter,
  FoundationProtocolId
} from "./observation.js";
import type { CaptureMode } from "./capture-mode.js";
import type { MeasurementContextKind } from "./measurement.js";

export type ReviewStatus = "pending" | "accepted" | "rejected";

export interface TrajectoryHistoryRecord {
  containsPHI: false;
  synthetic: boolean;
  source: "synthetic-fixture" | "accepted-live-session";
  visitId: string;
  participantId: string;
  occurredAt: string;
  captureMode: CaptureMode;
  captureAdapter: CaptureAdapter;
  selectedProtocolId: FoundationProtocolId;
  reviewStatus: ReviewStatus;
  aggregates: BiomarkerAggregate[];
}

export interface TrajectoryPolicy {
  id: string;
  minimumPriorObservations: number;
  speechSnrToleranceDb: number;
  faceFramingTolerance: number;
  frameRateToleranceFraction: number;
  illuminationTolerance: number;
}

export type TrajectoryCompatibilityReasonCode =
  | "history-not-explicitly-non-phi"
  | "history-not-accepted"
  | "protocol-id-mismatch"
  | "participant-mismatch"
  | "same-as-current-encounter"
  | "not-prior-to-current"
  | "invalid-occurred-at"
  | "duplicate-encounter-id"
  | "duplicate-aggregate-identity"
  | "invalid-aggregate-metadata"
  | "nonfinite-aggregate"
  | "negative-aggregate-spread"
  | "aggregate-confidence-out-of-range"
  | "missing-aggregate-evidence"
  | "unit-mismatch"
  | "algorithm-version-mismatch"
  | "voice-processor-mismatch"
  | "visual-processor-mismatch"
  | "confound-envelope-kind-mismatch"
  | "speech-snr-out-of-tolerance"
  | "voice-sample-rate-class-mismatch"
  | "voice-browser-processing-mismatch"
  | "face-framing-out-of-tolerance"
  | "frame-rate-out-of-tolerance"
  | "illumination-out-of-tolerance"
  | "no-compatible-biomarkers"
  | "insufficient-prior-observations";

export interface CompatibilityDecision {
  encounterId: string;
  status: "included" | "excluded";
  reasonCodes: TrajectoryCompatibilityReasonCode[];
}

export type TrajectoryDirection =
  | "within-reference"
  | "above-reference"
  | "below-reference"
  | "not-comparable";

export interface BiomarkerComparison {
  code: string;
  label: string;
  unit: string;
  contextKind: MeasurementContextKind;
  algorithmVersion: string;
  processorRef: string;
  currentValue: number;
  priorValues: Array<{
    encounterId: string;
    occurredAt: string;
    value: number;
    synthetic: boolean;
  }>;
  priorMedian: number;
  priorMinimum: number;
  priorMaximum: number;
  priorMad: number;
  deltaFromMedian: number;
  direction: TrajectoryDirection;
  currentEvidenceRefs: string[];
  referenceMeasurementRefs: string[];
}

export interface TrajectoryComparison {
  containsPHI: false;
  comparisonId: string;
  participantId: string;
  currentVisitId: string;
  policyId: string;
  decisions: CompatibilityDecision[];
  includedEncounterIds: string[];
  excludedEncounters: Array<{
    encounterId: string;
    reasonCodes: TrajectoryCompatibilityReasonCode[];
  }>;
  biomarkers: BiomarkerComparison[];
  status: "provisional" | "not-comparable";
  reasonCodes: TrajectoryCompatibilityReasonCode[];
  claimBoundary: string;
}
