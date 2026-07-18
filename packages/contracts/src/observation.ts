import type { CaptureMode } from "./capture-mode.js";
import type {
  Abstention,
  Measurement,
  MeasurementContextKind,
  MeasurableWindow
} from "./measurement.js";

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
  windows: MeasurableWindow[];
  measurements: Measurement[];
  aggregates: BiomarkerAggregate[];
  abstentions: Abstention[];
  measurementCount: number;
}
