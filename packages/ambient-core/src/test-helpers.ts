import type {
  VideoCaptureSettings,
  VisualPipelineProvenance,
  VisualTaskContext
} from "@phenometric/contracts";
import type {
  FacialKinematicsFrameV1,
  FrameStream
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
    schemaVersion: "phenometric.frame-stream.v1",
    containsPHI: false,
    visitId: "synthetic-visit",
    participantId: "synthetic-participant",
    captureMode: "fixture-playback",
    occurredAt: "2026-07-18T16:00:00.000Z",
    captureAdapter: { id: "fixture-replay", version: "1.0.0" },
    visualPipeline: SYNTHETIC_VISUAL_PIPELINE,
    videoCaptureSettings: SYNTHETIC_VIDEO_SETTINGS,
    audio: [],
    face: [],
    ...partial
  };
}
