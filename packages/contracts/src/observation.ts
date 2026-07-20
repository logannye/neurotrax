import type { CaptureMode } from "./capture-mode.js";
import type {
  Abstention,
  BrowserAudioProcessingState,
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

export interface AudioCaptureSettings {
  requested: {
    channelCount: 1;
    sampleRate: 48000;
    echoCancellation: false;
    noiseSuppression: false;
    autoGainControl: false;
  };
  actual: {
    channelCount: number;
    sampleRate: number;
    browserProcessing: BrowserAudioProcessingState;
  };
}

export interface AudioPipelineProvenance {
  processorRef: string;
  runtime: "audio-worklet-voice-worker";
  workletSchemaVersion: "phenometric.voice-worklet-message.v1";
  workerSchemaVersion: "phenometric.voice-worker-message.v1";
  signalFrameSchemaVersion: "phenometric.voice-signal-frame.v1";
  analysisWindowMs: 40;
  analysisHopMs: 10;
  ringBufferSeconds: 30;
  algorithmVersion: string;
}

export interface VoiceModelProvenance {
  processorType: "speech-representation";
  processorRef: string;
  modelId: "microsoft/wavlm-large";
  revision: string;
  weightSha256: string;
  requestedLayers: readonly [6, 12, 18, 24];
  runtime: string;
  device: string;
}

export interface AudioStreamDiagnostics {
  receivedBlockCount: number;
  processedFrameCount: number;
  lostBlockCount: number;
  lostBlockFraction: number;
  maximumBlockGapMs: number;
  p95FeatureLatencyMs: number;
  timestampRegressionCount: number;
  ringBufferCapacitySamples: number;
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
  audioLostBlockFraction: number;
  maximumAudioBlockGapMs: number;
  medianAudioSnrDb: number;
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
  schemaVersion: "phenometric.encounter-observation.v2";
  containsPHI: false;
  rawMediaRetained: false;
  rawAudioRetained: false;
  nativeAudioObservationsRetained: false;
  transcriptRetained: false;
  voiceEmbeddingsRetained: false;
  nativeVisualObservationsRetained: false;
  selectedProtocolId:
    | "facial-foundation.v1"
    | "voice-foundation.v1";
  captureMode: CaptureMode;
  visitId: string;
  participantId: string;
  occurredAt: string;
  captureAdapter: CaptureAdapter;
  audioPipeline: AudioPipelineProvenance | null;
  audioCaptureSettings: AudioCaptureSettings | null;
  voiceModel: VoiceModelProvenance | null;
  audioStreamDiagnostics: AudioStreamDiagnostics | null;
  visualPipeline: VisualPipelineProvenance | null;
  videoCaptureSettings: VideoCaptureSettings | null;
  windows: MeasurableWindow[];
  measurements: Measurement[];
  aggregates: BiomarkerAggregate[];
  abstentions: Abstention[];
  measurementCount: number;
  qualitySummary: EncounterQualitySummary;
}
