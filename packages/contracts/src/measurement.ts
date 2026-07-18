export type Modality = "speech" | "face";

export type MeasurementContextKind =
  | "spontaneous-speech"
  | "sustained-vowel"
  | "reading-aloud"
  | "listening-expressive";

export interface ConfoundEnvelope {
  snrDb: number;
  faceFramingFraction: number;
  observedFrameRate: number;
  illuminationRelative: number;
}

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

export interface Measurement {
  code: string;
  label: string;
  value: number;
  unit: string;
  confidence: number;
  uncertainty: "placeholder";
  algorithmVersion: string;
  clinicalValidation: "none";
  contextRef: string;
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
}
