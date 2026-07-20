import type {
  VideoCaptureSettings,
  SpeechConfoundEnvelope,
  VisualPipelineProvenance,
  VisualTaskContext
} from "@phenometric/contracts";
import type {
  FacialKinematicsFrameV1,
  FrameStream,
  VoiceSignalFrameV1
} from "./primitives.js";

export const SYNTHETIC_VISUAL_PIPELINE: VisualPipelineProvenance = {
  processorRef: "mediapipe-face-landmarker@0.10.35+synthetic-model",
  runtime: "mediapipe-tasks-vision",
  mediaPipeVersion: "0.10.35",
  modelAsset: "face_landmarker.task",
  modelSha256: "synthetic-model",
  delegate: "CPU",
  geometryVersion: "facial-kinematics-v1"
};

export const SYNTHETIC_VIDEO_SETTINGS: VideoCaptureSettings = {
  requested: { width: 1280, height: 720, frameRate: 30 },
  actual: { width: 1280, height: 720, frameRate: 30 },
  facingMode: "user",
  coordinateSpace: "normalized-unmirrored-image",
  displayMirrored: true,
  lateralityConvention: "subject-anatomical"
};

export function syntheticSpeechConfounds(
  overrides: Partial<SpeechConfoundEnvelope> = {}
): SpeechConfoundEnvelope {
  return {
    kind: "speech",
    sampleRateHz: 48_000,
    sampleRateClass: "48khz-or-higher",
    browserProcessing: {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false
    },
    snrDb: 26,
    clippingFraction: 0,
    dcOffset: 0.001,
    lostBlockFraction: 0,
    maximumBlockGapMs: 20,
    usableCoverage: 1,
    periodicityCoverage: 0.9,
    ...overrides
  };
}

export function syntheticVoiceFrame(
  tMs: number,
  overrides: Partial<VoiceSignalFrameV1> = {}
): VoiceSignalFrameV1 {
  return {
    schemaVersion: "phenometric.voice-signal-frame.v1",
    tMs,
    acquiredAtMs: tMs,
    captureEpoch: 1,
    sequence: Math.floor(tMs / 10) + 1,
    absoluteSampleIndex: Math.round(tMs * 48),
    taskContext: "spontaneous-response",
    voiced: true,
    voicingProbability: 0.94,
    rms: 0.08,
    intensityDbfs: -21.9,
    f0Hz: 140 + Math.sin(tMs / 200) * 5,
    f0Confidence: 0.92,
    estimatorAgreement: 0.95,
    periodicity: 0.9,
    cppsDb: 14,
    hnrDb: 21,
    jitterLocal: 0.009,
    shimmerLocal: 0.03,
    formantF1Hz: 730,
    formantF2Hz: 1_090,
    spectralFlux: 0.06,
    syllabicNucleus: tMs % 400 < 10,
    clippedSampleFraction: 0,
    dcOffset: 0.001,
    snrDb: 26,
    sampleRateHz: 48_000,
    blockGapMs: 10,
    lostBlockFraction: 0,
    browserProcessing: {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false
    },
    qualityReasons: [],
    processorRef: "browser-voice-dsp@1.0",
    ...overrides
  };
}

export function syntheticFacialFrame(
  tMs: number,
  taskContext: VisualTaskContext,
  overrides: Partial<FacialKinematicsFrameV1> = {}
): FacialKinematicsFrameV1 {
  return {
    schemaVersion: "phenometric.facial-kinematics-frame.v1",
    tMs,
    acquiredAtMs: tMs,
    sequence: Math.round(tMs / 50),
    captureEpoch: 1,
    taskContext,
    faceVisible: true,
    boundingBox: {
      x: 0.35,
      y: 0.2,
      width: 0.3,
      height: 0.5,
      widthPixels: 384,
      heightPixels: 360,
      edgeMarginFraction: 0.1
    },
    anatomicalLaterality: "subject-anatomical",
    pose: { yawDegrees: 0, pitchDegrees: 0, rollDegrees: 0 },
    eyeAperture: { left: 0.3, right: 0.3 },
    mouthCorners: {
      left: { x: 0.3, y: 0.1 },
      right: { x: -0.3, y: 0.1 }
    },
    mouthApertureRatio: 0.08,
    regionalMovementSpeed: 0.02,
    imageQuality: {
      illuminationMean: 0.55,
      darkClippingFraction: 0.02,
      brightClippingFraction: 0.02,
      sharpness: 0.002
    },
    analyzedFrameRate: 30,
    interResultGapMs: tMs === 0 ? null : 50,
    skippedFrameFraction: 0,
    processingLatencyMs: 8,
    qualityReasons: [],
    processorRef: SYNTHETIC_VISUAL_PIPELINE.processorRef,
    ...overrides
  };
}

export function syntheticTaskFrames(
  taskContext: VisualTaskContext,
  startMs: number,
  overrides: (
    frame: FacialKinematicsFrameV1,
    index: number
  ) => Partial<FacialKinematicsFrameV1> = () => ({})
): FacialKinematicsFrameV1[] {
  return Array.from({ length: 33 }, (_, index) => {
    const tMs = startMs + index * 50;
    const base = syntheticFacialFrame(tMs, taskContext);
    return { ...base, ...overrides(base, index) };
  });
}

export function syntheticFrameStream(
  partial: Partial<FrameStream> = {}
): FrameStream {
  return {
    schemaVersion: "phenometric.frame-stream.v2",
    containsPHI: false,
    visitId: "synthetic-visit",
    participantId: "synthetic-participant",
    captureMode: "fixture-playback",
    selectedProtocolId: "facial-foundation.v1",
    occurredAt: "2026-07-18T16:00:00.000Z",
    captureAdapter: { id: "fixture-replay", version: "1.0.0" },
    audioPipeline: null,
    audioCaptureSettings: null,
    voiceModel: null,
    audioStreamDiagnostics: null,
    visualPipeline: SYNTHETIC_VISUAL_PIPELINE,
    videoCaptureSettings: SYNTHETIC_VIDEO_SETTINGS,
    audio: [],
    face: [],
    ...partial
  };
}
