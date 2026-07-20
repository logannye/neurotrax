export type Modality = "speech" | "face";

export type MeasurementContextKind =
  | "spontaneous-speech"
  | "sustained-vowel"
  | "reading-aloud"
  | "rapid-syllables"
  | "listening-expressive"
  | "neutral-face"
  | "smile"
  | "eye-closure";

export type AudioQualityReasonCode =
  | "microphone-unavailable"
  | "audio-worklet-unavailable"
  | "audio-frame-gap"
  | "sample-rate-below-minimum"
  | "audio-processing-enabled"
  | "snr-below-minimum"
  | "signal-too-quiet"
  | "audio-clipping"
  | "dc-offset"
  | "task-not-observed"
  | "voice-worker-unavailable";

export interface BrowserAudioProcessingState {
  echoCancellation: boolean;
  noiseSuppression: boolean;
  autoGainControl: boolean;
}

export interface SpeechConfoundEnvelope {
  kind: "speech";
  sampleRateHz: number;
  sampleRateClass: "44.1khz" | "48khz-or-higher" | "below-44.1khz";
  browserProcessing: BrowserAudioProcessingState;
  snrDb: number;
  clippingFraction: number;
  dcOffset: number;
  lostBlockFraction: number;
  maximumBlockGapMs: number;
  usableCoverage: number;
  periodicityCoverage: number;
}

export interface VisualConfoundEnvelope {
  kind: "visual";
  faceBoxWidthPixels: number;
  faceBoxHeightPixels: number;
  faceWidthFraction: number;
  faceHeightFraction: number;
  edgeMarginFraction: number;
  analyzedFrameRate: number;
  skippedFrameFraction: number;
  meanInterResultGapMs: number;
  illuminationMean: number;
  darkClippingFraction: number;
  brightClippingFraction: number;
  sharpness: number;
  yawDegrees: number;
  pitchDegrees: number;
  rollDegrees: number;
}

export type ConfoundEnvelope =
  | SpeechConfoundEnvelope
  | VisualConfoundEnvelope;

export interface MeasurementContext {
  kind: MeasurementContextKind;
  confounds: ConfoundEnvelope;
}

export interface MeasurableWindow {
  windowId: string;
  modality: Modality;
  startMs: number;
  endMs: number;
  context: MeasurementContext;
}

export type MeasurementUncertainty =
  | {
      kind: "estimated";
      method: "median-absolute-deviation";
      value: number;
      unit: string;
    }
  | {
      kind: "not-estimated";
      reason: string;
    };

export interface Measurement {
  code: string;
  label: string;
  value: number;
  unit: string;
  confidence: number;
  uncertainty: MeasurementUncertainty;
  algorithmVersion: string;
  processorRef: string;
  clinicalValidation: "none";
  contextRef: string;
  sourceWindowRefs: string[];
  windowStartMs: number;
  windowEndMs: number;
  evidenceSnippetRef: string | null;
}

export interface Abstention {
  modality: Modality;
  windowStartMs: number;
  windowEndMs: number;
  reasonCode: string;
  detail: string;
  contextKind?: MeasurementContextKind;
  measurementCodes?: string[];
  sourceWindowRefs?: string[];
  processorRef?: string;
}
