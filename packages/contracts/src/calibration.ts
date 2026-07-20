export interface AudioCalibration {
  medianNoiseRms: number;
  noiseP90Rms: number;
  entryThresholdRms: number;
  exitThresholdRms: number;
  durationMs?: number;
  usableFraction?: number;
  sampleRateHz?: number;
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
  schemaVersion: "phenometric.capture-calibration.v2";
  profileId: "visual-foundation-v1" | "voice-foundation-v1";
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

export type CompletionGatedEncounterPhase = VisualTaskContext;

export type ConfirmationState =
  | "pending"
  | "confirmed";

export interface CompletionGatedPhasePolicy {
  phase: CompletionGatedEncounterPhase;
  evidenceDurationMs: number;
  adherenceHoldMs: number;
  assistanceAfterMs: number;
  successCondition: string;
}

export interface CompletionGatedEncounterPolicy {
  id: "completion-gated-v0.3";
  systemCheckMaximumMs: number;
  quietCalibrationMs: number;
  maximumContinuousSignalGapMs: number;
  reliablePitchFramesForStrong: number;
  minimumSpeechEnergyFrames: number;
  faceFramesForStrong: number;
  faceFramesForLimited: number;
  phases: readonly CompletionGatedPhasePolicy[];
}

export interface CompletionGateProgress {
  evidenceMs: number;
  evidenceRequiredMs: number;
  adherenceMs: number;
  adherenceRequiredMs: number;
  fraction: number;
}

export interface GuidedTaskEvidenceInterval {
  taskContext: VisualTaskContext;
  startMs: number;
  endMs: number;
  processorRef?: string;
}

export type VoiceTaskContext =
  | "quiet-calibration"
  | "natural-speech-check"
  | "sustained-vowel-1"
  | "sustained-vowel-2"
  | "standardized-reading"
  | "rapid-syllables"
  | "spontaneous-response";

export type GuidedVoiceTaskContext = Exclude<
  VoiceTaskContext,
  "quiet-calibration" | "natural-speech-check"
>;

export interface GuidedVoiceTaskEvidenceInterval {
  taskContext: GuidedVoiceTaskContext;
  startMs: number;
  endMs: number;
  taskStartedAtMs: number;
  processorRef: string;
}

export interface VoiceCompletionGateProgress {
  usableEvidenceMs: number;
  evidenceRequiredMs: number;
  voicedEvidenceMs: number;
  periodicityCoverage: number;
  syllabicNuclei: number;
  requiredSyllabicNuclei: number;
  fraction: number;
}

export interface CompletionGatedVoicePhasePolicy {
  phase: GuidedVoiceTaskContext;
  evidenceDurationMs: number;
  assistanceAfterMs: number;
  requiredPeriodicityCoverage?: number;
  requiredSyllabicNuclei?: number;
  permitsNaturalPauses: boolean;
  successCondition: string;
}

export interface CompletionGatedVoicePolicy {
  id: "voice-completion-gated-v1";
  maximumContinuousSignalGapMs: number;
  assistanceAfterMs: number;
  phases: readonly CompletionGatedVoicePhasePolicy[];
}
