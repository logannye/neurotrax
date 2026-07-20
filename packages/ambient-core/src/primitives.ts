import type {
  CaptureAdapter,
  CaptureCalibration,
  CaptureMode,
  AudioCaptureSettings,
  AudioPipelineProvenance,
  AudioQualityReasonCode,
  AudioStreamDiagnostics,
  BrowserAudioProcessingState,
  VoiceModelProvenance,
  VoiceTaskContext,
  VideoCaptureSettings,
  VisualPipelineProvenance,
  VisualQualityReasonCode,
  VisualTaskContext
} from "@phenometric/contracts";

export interface VoiceSignalFrameV1 {
  schemaVersion: "phenometric.voice-signal-frame.v1";
  tMs: number;
  acquiredAtMs: number;
  captureEpoch: number;
  sequence: number;
  absoluteSampleIndex: number;
  taskContext: VoiceTaskContext;
  voiced: boolean;
  voicingProbability: number;
  rms: number;
  intensityDbfs: number;
  f0Hz: number | null;
  f0Confidence: number;
  estimatorAgreement: number;
  periodicity: number;
  cppsDb: number | null;
  hnrDb: number | null;
  jitterLocal: number | null;
  shimmerLocal: number | null;
  formantF1Hz: number | null;
  formantF2Hz: number | null;
  spectralFlux: number;
  syllabicNucleus: boolean;
  clippedSampleFraction: number;
  dcOffset: number;
  snrDb: number;
  sampleRateHz: number;
  blockGapMs: number;
  lostBlockFraction: number;
  browserProcessing: BrowserAudioProcessingState;
  qualityReasons: AudioQualityReasonCode[];
  processorRef: string;
}

export interface NormalizedPoint {
  x: number;
  y: number;
}

export interface FacialBoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
  widthPixels: number;
  heightPixels: number;
  edgeMarginFraction: number;
}

export interface FacialPose {
  yawDegrees: number;
  pitchDegrees: number;
  rollDegrees: number;
}

export interface BilateralValue {
  left: number;
  right: number;
}

export interface FacialKinematicsFrameV1 {
  schemaVersion: "phenometric.facial-kinematics-frame.v1";
  tMs: number;
  acquiredAtMs: number;
  sequence: number;
  captureEpoch: number;
  taskContext: VisualTaskContext;
  faceVisible: boolean;
  boundingBox: FacialBoundingBox | null;
  anatomicalLaterality: "subject-anatomical";
  pose: FacialPose | null;
  eyeAperture: BilateralValue | null;
  mouthCorners: {
    left: NormalizedPoint;
    right: NormalizedPoint;
  } | null;
  mouthApertureRatio: number | null;
  regionalMovementSpeed: number | null;
  imageQuality: {
    illuminationMean: number;
    darkClippingFraction: number;
    brightClippingFraction: number;
    sharpness: number;
  };
  analyzedFrameRate: number;
  interResultGapMs: number | null;
  skippedFrameFraction: number;
  processingLatencyMs: number;
  qualityReasons: VisualQualityReasonCode[];
  processorRef: string;
}

export interface FrameStream {
  schemaVersion: "phenometric.frame-stream.v2";
  containsPHI: false;
  visitId: string;
  participantId: string;
  captureMode: CaptureMode;
  selectedProtocolId:
    | "facial-foundation.v1"
    | "voice-foundation.v1";
  occurredAt?: string;
  captureAdapter?: CaptureAdapter;
  calibration?: CaptureCalibration;
  audioPipeline: AudioPipelineProvenance | null;
  audioCaptureSettings: AudioCaptureSettings | null;
  voiceModel: VoiceModelProvenance | null;
  audioStreamDiagnostics: AudioStreamDiagnostics | null;
  visualPipeline: VisualPipelineProvenance | null;
  videoCaptureSettings: VideoCaptureSettings | null;
  audio: VoiceSignalFrameV1[];
  face: FacialKinematicsFrameV1[];
}
