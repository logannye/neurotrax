import type {
  AudioCalibration,
  CalibrationQuality,
  CaptureCalibration,
  FaceCalibration
} from "@phenometric/contracts";
import type { FaceLandmarkFrame } from "@phenometric/ambient-core";

export const PREFLIGHT_FACE_WINDOW = 15;
export const PREFLIGHT_FACE_REQUIRED = 12;

export type FaceGuidance =
  | "Face ready"
  | "Move into view"
  | "Move closer"
  | "Move farther back"
  | "Center your face"
  | "Face the camera"
  | "Add light";

export interface CalibratedFaceFrame {
  frame: FaceLandmarkFrame;
  usable: boolean;
  guidance: FaceGuidance;
}

export interface FaceCalibrationResult {
  quality: CalibrationQuality;
  calibration: FaceCalibration | null;
  usableFrameCount: number;
}

export function classifyAudioCalibration(
  reliablePitchFrames: number,
  speechEnergyFrames: number
): CalibrationQuality {
  if (reliablePitchFrames >= 8) return "strong";
  if (speechEnergyFrames > 0) return "limited";
  return "unavailable";
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function preflightFaceGuidance(
  frame: FaceLandmarkFrame
): FaceGuidance {
  const width = frame.faceBoxWidth ?? 0;
  const height = frame.faceBoxHeight ?? 0;
  const edgeMargin = frame.edgeMargin ?? 0;
  if (!frame.faceVisible) return "Move into view";
  if (Math.abs(frame.yawDegrees ?? 0) > 20) return "Face the camera";
  if (width < 0.14 || height < 0.2) {
    return "Move closer";
  }
  if (width > 0.6 || height > 0.85) {
    return "Move farther back";
  }
  if (edgeMargin < 0.015) return "Center your face";
  if (frame.illumination < 0.1) return "Add light";
  return "Face ready";
}

export function facePreflightPassed(
  frames: FaceLandmarkFrame[]
): boolean {
  const recent = frames.slice(-PREFLIGHT_FACE_WINDOW);
  return (
    recent.length === PREFLIGHT_FACE_WINDOW &&
    recent.filter((frame) => preflightFaceGuidance(frame) === "Face ready")
      .length >= PREFLIGHT_FACE_REQUIRED
  );
}

export function createFaceCalibration(
  frames: FaceLandmarkFrame[]
): FaceCalibration {
  const usable = frames
    .slice(-PREFLIGHT_FACE_WINDOW)
    .filter((frame) => preflightFaceGuidance(frame) === "Face ready");
  if (usable.length < PREFLIGHT_FACE_REQUIRED) {
    throw new Error("A stable facial baseline is required.");
  }
  return {
    baselineBoxWidth: median(
      usable.map((frame) => frame.faceBoxWidth ?? 0)
    ),
    baselineBoxHeight: median(
      usable.map((frame) => frame.faceBoxHeight ?? 0)
    ),
    baselineIllumination: median(
      usable.map((frame) => frame.illumination)
    )
  };
}

export function classifyFaceCalibration(
  frames: FaceLandmarkFrame[]
): FaceCalibrationResult {
  const recent = frames.slice(-PREFLIGHT_FACE_WINDOW);
  const usable = recent.filter(
    (frame) => preflightFaceGuidance(frame) === "Face ready"
  );
  const visible = recent.filter(
    (frame) =>
      frame.faceVisible &&
      (frame.faceBoxWidth ?? 0) > 0 &&
      (frame.faceBoxHeight ?? 0) > 0
  );
  const baselineFrames = usable.length >= 3 ? usable : visible;
  if (baselineFrames.length === 0) {
    return {
      quality: "unavailable",
      calibration: null,
      usableFrameCount: 0
    };
  }
  return {
    quality:
      usable.length >= PREFLIGHT_FACE_REQUIRED ? "strong" : "limited",
    calibration: {
      baselineBoxWidth: median(
        baselineFrames.map((frame) => frame.faceBoxWidth ?? 0)
      ),
      baselineBoxHeight: median(
        baselineFrames.map((frame) => frame.faceBoxHeight ?? 0)
      ),
      baselineIllumination: median(
        baselineFrames.map((frame) => frame.illumination)
      )
    },
    usableFrameCount: usable.length
  };
}

export function calibrateFaceFrame(
  frame: FaceLandmarkFrame,
  calibration: FaceCalibration
): CalibratedFaceFrame {
  let guidance: FaceGuidance = "Face ready";
  const width = frame.faceBoxWidth ?? 0;
  const height = frame.faceBoxHeight ?? 0;
  const edgeMargin = frame.edgeMargin ?? 0;
  if (!frame.faceVisible) guidance = "Move into view";
  else if (Math.abs(frame.yawDegrees ?? 0) > 30) {
    guidance = "Face the camera";
  } else if (
    width <
      calibration.baselineBoxWidth * 0.6 ||
    height < calibration.baselineBoxHeight * 0.6
  ) {
    guidance = "Move closer";
  } else if (
    width >
      calibration.baselineBoxWidth * 1.7 ||
    height > calibration.baselineBoxHeight * 1.7
  ) {
    guidance = "Move farther back";
  } else if (edgeMargin < 0.01) {
    guidance = "Center your face";
  } else if (
    frame.illumination < 0.1 ||
    Math.abs(
      frame.illumination - calibration.baselineIllumination
    ) > 0.3
  ) {
    guidance = "Add light";
  }

  const usable = guidance === "Face ready";
  const widthRatio =
    width /
    Math.max(0.001, calibration.baselineBoxWidth);
  const heightRatio =
    height /
    Math.max(0.001, calibration.baselineBoxHeight);
  const sizeScore = Math.min(
    clamp(widthRatio / 0.75),
    clamp(heightRatio / 0.75),
    clamp(1.7 / Math.max(widthRatio, 0.001)),
    clamp(1.7 / Math.max(heightRatio, 0.001))
  );
  const marginScore = clamp(edgeMargin / 0.015);
  const lightScore = clamp(
    1 -
      Math.abs(
        frame.illumination - calibration.baselineIllumination
      ) /
        0.3
  );

  return {
    usable,
    guidance,
    frame: {
      ...frame,
      framingFraction: usable
        ? Math.max(0.75, Math.min(sizeScore, marginScore, lightScore))
        : 0
    }
  };
}

export function createCaptureCalibration(
  audio: AudioCalibration,
  audioQuality: CalibrationQuality,
  faceResult: FaceCalibrationResult
): CaptureCalibration {
  return {
    profileId: "macbook-timed-v0.2",
    calibratedAt: new Date().toISOString(),
    audio,
    audioQuality,
    face: faceResult.calibration,
    faceQuality: faceResult.quality
  };
}
