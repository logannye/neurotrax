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

export interface CaptureCalibration {
  profileId: "macbook-guided-v0.1";
  calibratedAt: string;
  audio: AudioCalibration;
  face: FaceCalibration;
}

export interface CaptureQualityPolicy {
  id: string;
  speechOpenDebounceMs: number;
  maximumSpeechPauseMs: number;
  faceQualityDebounceMs: number;
  faceFramingFloor: number;
  maximumFaceYawDegrees: number;
}
