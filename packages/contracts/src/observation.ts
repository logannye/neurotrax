import type { CaptureMode } from "./capture-mode.js";
import type {
  Abstention,
  ConfoundEnvelope,
  Measurement,
  MeasurementContextKind,
  MeasurableWindow
} from "./measurement.js";

export interface CaptureAdapter {
  id: string;
  version: string;
}

export interface EncounterQualitySummary {
  speechWindowCount: number;
  faceWindowCount: number;
  abstentionCount: number;
  qualityTransitionCount: number;
}

export interface BiomarkerAggregate {
  code: string;
  label: string;
  unit: string;
  contextKind: MeasurementContextKind;
  value: number;
  spread: number;
  confidence: number;
  windowCount: number;
  algorithmVersion: string;
  confounds: ConfoundEnvelope;
  uncertainty: "placeholder";
  clinicalValidation: "none";
}

export interface EncounterObservation {
  containsPHI: false;
  captureMode: CaptureMode;
  visitId: string;
  participantId: string;
  occurredAt: string;
  captureAdapter: CaptureAdapter;
  windows: MeasurableWindow[];
  measurements: Measurement[];
  aggregates: BiomarkerAggregate[];
  abstentions: Abstention[];
  measurementCount: number;
  qualitySummary: EncounterQualitySummary;
}
