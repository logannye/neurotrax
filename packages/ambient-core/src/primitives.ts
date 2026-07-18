import type { CaptureAdapter, CaptureMode } from "@neurotrax/contracts";

export interface AudioFeatureFrame {
  tMs: number;
  voiced: boolean;
  rms: number;
  pitchHz: number | null;
  clipped: boolean;
  snrDb: number;
}

export interface FaceLandmarkFrame {
  tMs: number;
  faceVisible: boolean;
  framingFraction: number;
  illumination: number;
  yawDegrees?: number;
  eyeAspectRatio: number;
  browRaise: number;
  mouthOpen: number;
  landmarkMotion: number;
  observedFrameRate: number;
}

export interface FrameStream {
  containsPHI: false;
  visitId: string;
  participantId: string;
  captureMode: CaptureMode;
  occurredAt?: string;
  captureAdapter?: CaptureAdapter;
  audio: AudioFeatureFrame[];
  face: FaceLandmarkFrame[];
}
