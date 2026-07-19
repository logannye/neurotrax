export interface AudioCalibration {
  medianNoiseRms: number;
  noiseP90Rms: number;
  entryThresholdRms: number;
  exitThresholdRms: number;
}

export interface FaceCalibration {
  durationMs: number;
  totalFrameCount: number;
  usableFrameCount: number;
  usableFraction: number;
  analyzedFrameRate: number;
  baselineBoxWidthPixels: number;
  baselineBoxHeightPixels: number;
  baselineIlluminationMean: number;
  baselineSharpness: number;
}

export type CalibrationQuality = "strong" | "limited" | "unavailable";

export interface CaptureCalibration {
  schemaVersion: "phenometric.capture-calibration.v1";
  profileId: "visual-foundation-v1";
  calibratedAt: string;
  audio: AudioCalibration;
  audioQuality: CalibrationQuality;
  face: FaceCalibration | null;
  faceQuality: CalibrationQuality;
}

export interface CaptureQualityPolicy {
  id: string;
  speechOpenDebounceMs: number;
  maximumSpeechPauseMs: number;
  faceQualityDebounceMs: number;
  minimumAnalyzedFrameRate: number;
  maximumVisualFrameGapMs: number;
  maximumSkippedFrameFraction: number;
  rollingVisualQualityWindowMs: number;
  minimumFaceWidthPixels: number;
  minimumFaceHeightPixels: number;
  maximumFaceWidthFraction: number;
  maximumFaceHeightFraction: number;
  minimumEdgeMarginFraction: number;
  maximumFaceYawDegrees: number;
  maximumFacePitchDegrees: number;
  maximumFaceRollDegrees: number;
  minimumIlluminationMean: number;
  maximumIlluminationMean: number;
  maximumDarkClippingFraction: number;
  maximumBrightClippingFraction: number;
  minimumSharpness: number;
  calibrationSharpnessFraction: number;
  minimumFaceCalibrationDurationMs: number;
  minimumFaceCalibrationUsableFraction: number;
}

export type VisualTaskContext =
  | "establishing"
  | "turn-away"
  | "neutral-face"
  | "smile"
  | "eye-closure";

export type VisualQualityReasonCode =
  | "face-not-visible"
  | "face-too-small"
  | "face-too-large"
  | "face-edge-margin"
  | "pose-out-of-range"
  | "blur"
  | "illumination-out-of-range"
  | "frame-rate-below-minimum"
  | "visual-frame-gap"
  | "too-many-skipped-frames"
  | "worker-unavailable"
  | "camera-unavailable"
  | "document-hidden";

export interface VisualQualityAssessment {
  usable: boolean;
  reasonCodes: VisualQualityReasonCode[];
  sharpnessFloor: number;
}

export type TimedEncounterPhase =
  VisualTaskContext;

export type ConfirmationState =
  | "pending"
  | "confirmed"
  | "not-confirmed";

export interface TimedEncounterPhasePolicy {
  phase: TimedEncounterPhase;
  minimumDurationMs: number;
  maximumDurationMs: number;
  successCondition: string;
  timeoutBehavior: "advance-and-record-not-confirmed";
}

export interface TimedEncounterPolicy {
  id: "judge-ready-timed-v0.2";
  systemCheckMaximumMs: number;
  quietCalibrationMs: number;
  reliablePitchFramesForStrong: number;
  minimumSpeechEnergyFrames: number;
  faceFramesForStrong: number;
  faceFramesForLimited: number;
  phases: readonly TimedEncounterPhasePolicy[];
}
