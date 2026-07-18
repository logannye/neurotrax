import type { CaptureMode } from "./capture-mode.js";
import type { Abstention, MeasurementContextKind } from "./measurement.js";

export interface BiomarkerAggregate {
  code: string;
  label: string;
  unit: string;
  contextKind: MeasurementContextKind;
  value: number;
  spread: number;
  windowCount: number;
  algorithmVersion: string;
  uncertainty: "placeholder";
  clinicalValidation: "none";
}

export interface EncounterObservation {
  containsPHI: false;
  captureMode: CaptureMode;
  visitId: string;
  participantId: string;
  aggregates: BiomarkerAggregate[];
  abstentions: Abstention[];
  measurementCount: number;
}
