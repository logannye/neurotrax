import type { CaptureMode } from "./capture-mode.js";
import type {
  Abstention,
  ConfoundEnvelope,
  Measurement,
  MeasurementContextKind,
  MeasurementUncertainty,
  MeasurableWindow
} from "./measurement.js";

export interface CaptureAdapter {
  id: string;
  version: string;
}

export interface VisualPipelineProvenance {
  processorRef: string;
  runtime: "mediapipe-tasks-vision";
  mediaPipeVersion: string;
  modelAsset: string;
  modelSha256: string;
  delegate: "GPU" | "CPU";
  geometryVersion: string;
}

export interface VideoCaptureSettings {
  requested: {
    width: number;
    height: number;
    frameRate: number;
  };
  actual: {
    width: number;
    height: number;
    frameRate: number | null;
  };
  facingMode?: string;
  coordinateSpace: "normalized-unmirrored-image";
  displayMirrored: true;
  lateralityConvention: "subject-anatomical";
}

export interface EncounterQualitySummary {
  speechWindowCount: number;
  faceWindowCount: number;
  abstentionCount: number;
  qualityTransitionCount: number;
  audioFrameCount: number;
  speechActiveFrameCount: number;
  pitchedFrameCount: number;
  pitchCoverage: number;
  faceFrameCount: number;
  usableFaceFrameCount: number;
  usableFaceFraction: number;
  faceWithholdingDurationMs: number;
  faceRecoveryObserved: boolean;
  postRecoveryFaceWindowCount: number;
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
  processorRef: string;
  sourceWindowRefs: string[];
  confounds: ConfoundEnvelope;
  uncertainty: MeasurementUncertainty;
  clinicalValidation: "none";
}

export interface EncounterObservation {
  schemaVersion: "phenometric.encounter-observation.v1";
  containsPHI: false;
  rawMediaRetained: false;
  nativeVisualObservationsRetained: false;
  captureMode: CaptureMode;
  visitId: string;
  participantId: string;
  occurredAt: string;
  captureAdapter: CaptureAdapter;
  visualPipeline: VisualPipelineProvenance | null;
  videoCaptureSettings: VideoCaptureSettings | null;
  windows: MeasurableWindow[];
  measurements: Measurement[];
  aggregates: BiomarkerAggregate[];
  abstentions: Abstention[];
  measurementCount: number;
  qualitySummary: EncounterQualitySummary;
}
