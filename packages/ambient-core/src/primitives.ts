import type {
  CaptureAdapter,
  CaptureCalibration,
  CaptureMode,
  VideoCaptureSettings,
  VisualPipelineProvenance,
  VisualQualityReasonCode,
  VisualTaskContext
} from "@phenometric/contracts";

export interface AudioFeatureFrame {
  tMs: number;
  voiced: boolean;
  rms: number;
  pitchHz: number | null;
  pitchConfidence?: number;
  clipped: boolean;
  snrDb: number;
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
  schemaVersion: "phenometric.frame-stream.v1";
  containsPHI: false;
  visitId: string;
  participantId: string;
  captureMode: CaptureMode;
  occurredAt?: string;
  captureAdapter?: CaptureAdapter;
  calibration?: CaptureCalibration;
  visualPipeline: VisualPipelineProvenance | null;
  videoCaptureSettings: VideoCaptureSettings | null;
  audio: AudioFeatureFrame[];
  face: FacialKinematicsFrameV1[];
}
