export type Modality = "speech" | "face";

export type MeasurementContextKind =
  | "spontaneous-speech"
  | "sustained-vowel"
  | "reading-aloud"
  | "listening-expressive"
  | "neutral-face"
  | "smile"
  | "eye-closure";

export interface SpeechConfoundEnvelope {
  kind: "speech";
  snrDb: number;
  clippingFraction: number;
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
