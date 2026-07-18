export const AMBIENT_CORE_VERSION = "0.1.0";
export type { AudioFeatureFrame, FaceLandmarkFrame, FrameStream } from "./primitives.js";
export {
  countBoundedPauses,
  extractSpeechAcoustic,
  pitchVariabilitySemitones,
  MAX_PAUSE_MS,
  MIN_PAUSE_MS,
  SPEECH_ACOUSTIC_VERSION,
  SPEECH_SNR_FLOOR_DB
} from "./speech-acoustic.js";
export { extractFacialExpressivity, FACIAL_EXPRESSIVITY_VERSION, FACE_FRAMING_FLOOR, BLINK_EAR_THRESHOLD } from "./facial-expressivity.js";
export {
  detectMeasurableWindows,
  MAX_FACE_WINDOW_YAW_DEGREES,
  MAX_SPEECH_PAUSE_MS,
  MIN_WINDOW_MS
} from "./windowing.js";
export { aggregateMeasurements } from "./aggregate.js";
export { createEventFactory } from "./events.js";
export type { EventFactory } from "./events.js";
export {
  createConductorSession,
  MAX_FACE_YAW_DEGREES,
  runConductor
} from "./conductor.js";
export type {
  ConductorSession,
  ConductorSessionOptions
} from "./conductor.js";
