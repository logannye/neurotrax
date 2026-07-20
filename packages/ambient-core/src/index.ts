export const AMBIENT_CORE_VERSION = "0.1.0";
export type {
  VoiceSignalFrameV1,
  NormalizedPoint,
  FacialBoundingBox,
  FacialPose,
  BilateralValue,
  FacialKinematicsFrameV1,
  FrameStream
} from "./primitives.js";
export {
  extractVoiceMeasurements,
  VOICE_ANALYSIS_PROCESSOR_REF,
  VOICE_ANALYSIS_VERSION,
  VOICE_MEASUREMENT_LABELS
} from "./voice-analysis.js";
export type { VoiceExtractionResult } from "./voice-analysis.js";
export {
  browserAudioProcessingEnabled,
  evaluateVoiceQuality,
  VOICE_FINE_ACOUSTIC_SNR_FLOOR_DB,
  VOICE_GENERAL_SNR_FLOOR_DB,
  VOICE_MAXIMUM_ABSOLUTE_DC_OFFSET,
  VOICE_MAXIMUM_BLOCK_GAP_MS,
  VOICE_MAXIMUM_CLIPPED_SAMPLE_FRACTION,
  VOICE_MAXIMUM_LOST_BLOCK_FRACTION,
  VOICE_MINIMUM_SAMPLE_RATE_HZ,
  VOICE_MINIMUM_SIGNAL_RMS
} from "./voice-quality.js";
export type { VoiceQualityAssessment } from "./voice-quality.js";
export {
  createNeutralFacialBaseline,
  evaluateEyeClosureAdherence,
  evaluateSmileAdherence,
  extractFacialTaskMeasurements,
  FACIAL_KINEMATICS_VERSION,
  SMILE_ADHERENCE_FLOOR,
  EYE_CLOSURE_ADHERENCE_FLOOR
} from "./facial-task.js";
export type {
  EyeClosureAdherenceEvaluation,
  FacialExtractionResult,
  FacialSide,
  NeutralFacialBaseline,
  SmileAdherenceEvaluation
} from "./facial-task.js";
export {
  evaluateVisualQuality
} from "./visual-quality.js";
export {
  detectMeasurableWindows,
  MAX_FACE_WINDOW_YAW_DEGREES,
  MAX_SPEECH_PAUSE_MS,
  MIN_WINDOW_MS
} from "./windowing.js";
export type { WindowDetectionOptions } from "./windowing.js";
export { aggregateMeasurements } from "./aggregate.js";
export { createEventFactory } from "./events.js";
export type { EventFactory } from "./events.js";
export {
  createConductorSession,
  DEFAULT_CAPTURE_QUALITY_POLICY,
  MAX_FACE_YAW_DEGREES,
  runConductor
} from "./conductor.js";
export type {
  ConductorSession,
  ConductorSessionOptions
} from "./conductor.js";
export {
  SYNTHETIC_VISUAL_PIPELINE,
  SYNTHETIC_VIDEO_SETTINGS,
  syntheticVoiceFrame,
  syntheticSpeechConfounds,
  syntheticFacialFrame,
  syntheticTaskFrames,
  syntheticFrameStream
} from "./test-helpers.js";
