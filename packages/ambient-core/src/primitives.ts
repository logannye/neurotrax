import type { CaptureMode } from "@neurotrax/contracts";

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
  eyeAspectRatio: number;
  browRaise: number;
  mouthOpen: number;
  landmarkMotion: number;
  observedFrameRate: number;
}

export interface FrameStream {
  visitId: string;
  participantId: string;
  captureMode: CaptureMode;
  audio: AudioFeatureFrame[];
  face: FaceLandmarkFrame[];
}
