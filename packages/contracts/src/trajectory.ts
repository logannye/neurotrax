import type { BiomarkerAggregate, CaptureAdapter } from "./observation.js";
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
  reviewStatus: ReviewStatus;
  aggregates: BiomarkerAggregate[];
}

export interface TrajectoryPolicy {
  id: string;
  speechSnrToleranceDb: number;
  faceFramingTolerance: number;
  frameRateToleranceFraction: number;
  illuminationTolerance: number;
}

export interface CompatibilityDecision {
  encounterId: string;
  status: "included" | "excluded";
  reasonCodes: string[];
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
    reasonCodes: string[];
  }>;
  biomarkers: BiomarkerComparison[];
  status: "provisional";
  claimBoundary: string;
}
