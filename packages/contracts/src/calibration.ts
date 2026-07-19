export interface AudioCalibration {
  medianNoiseRms: number;
  noiseP90Rms: number;
  entryThresholdRms: number;
  exitThresholdRms: number;
}

export interface FaceCalibration {
  baselineBoxWidth: number;
  baselineBoxHeight: number;
  baselineIllumination: number;
}

export type CalibrationQuality = "strong" | "limited" | "unavailable";

export interface CaptureCalibration {
  profileId: "macbook-timed-v0.2";
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
  faceFramingFloor: number;
  maximumFaceYawDegrees: number;
}

export type TimedEncounterPhase =
  | "establishing"
  | "turn-away"
  | "return"
  | "post-recovery";

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
  id: "judge-ready-timed-v0.1";
  systemCheckMaximumMs: number;
  quietCalibrationMs: number;
  reliablePitchFramesForStrong: number;
  minimumSpeechEnergyFrames: number;
  faceFramesForStrong: number;
  faceFramesForLimited: number;
  phases: readonly TimedEncounterPhasePolicy[];
}
