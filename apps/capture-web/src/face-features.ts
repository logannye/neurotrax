import type {
  Category,
  FaceLandmarkerResult,
  NormalizedLandmark
} from "@mediapipe/tasks-vision";
import type { FaceLandmarkFrame } from "@neurotrax/ambient-core";

const SELECTED_MOTION_LANDMARKS = [1, 13, 14, 33, 61, 70, 263, 291, 300];
const LEFT_CHEEK_INDEX = 234;
const RIGHT_CHEEK_INDEX = 454;
const NOSE_TIP_INDEX = 1;
const LEFT_EYE_INDEX = 33;
const RIGHT_EYE_INDEX = 263;

export interface NormalizedPoint {
  x: number;
  y: number;
}

export interface FaceFeatureState {
  normalizedMotionPoints: NormalizedPoint[] | null;
}

export interface FaceFeatureResult {
  frame: FaceLandmarkFrame;
  nextState: FaceFeatureState;
  overlayPoints: NormalizedPoint[];
  boundingBox: { x: number; y: number; width: number; height: number } | null;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function categoryScore(categories: Category[], name: string): number {
  return (
    categories.find((category) => category.categoryName === name)?.score ?? 0
  );
}

function boundingBox(landmarks: NormalizedLandmark[]): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  const xs = landmarks.map((landmark) => landmark.x);
  const ys = landmarks.map((landmark) => landmark.y);
  const minimumX = Math.min(...xs);
  const maximumX = Math.max(...xs);
  const minimumY = Math.min(...ys);
  const maximumY = Math.max(...ys);
  return {
    x: minimumX,
    y: minimumY,
    width: maximumX - minimumX,
    height: maximumY - minimumY
  };
}

function framingScore(box: {
  x: number;
  y: number;
  width: number;
  height: number;
}): number {
  const margin = Math.min(
    box.x,
    box.y,
    1 - (box.x + box.width),
    1 - (box.y + box.height)
  );
  const marginScore = clamp(margin / 0.015, 0, 1);
  const minimumSizeScore = Math.min(
    clamp(box.width / 0.14, 0, 1),
    clamp(box.height / 0.2, 0, 1)
  );
  const maximumSizeScore = Math.min(
    clamp(0.6 / Math.max(box.width, 0.001), 0, 1),
    clamp(0.85 / Math.max(box.height, 0.001), 0, 1)
  );
  return Math.min(marginScore, minimumSizeScore, maximumSizeScore);
}

function yawDegrees(landmarks: NormalizedLandmark[]): number {
  const left = landmarks[LEFT_CHEEK_INDEX];
  const right = landmarks[RIGHT_CHEEK_INDEX];
  const nose = landmarks[NOSE_TIP_INDEX];
  if (!left || !right || !nose) return 0;
  const centerX = (left.x + right.x) / 2;
  const halfWidth = Math.max(0.001, Math.abs(right.x - left.x) / 2);
  return clamp(((nose.x - centerX) / halfWidth) * 55, -90, 90);
}

function normalizedMotionPoints(
  landmarks: NormalizedLandmark[]
): NormalizedPoint[] {
  const nose = landmarks[NOSE_TIP_INDEX];
  const leftEye = landmarks[LEFT_EYE_INDEX];
  const rightEye = landmarks[RIGHT_EYE_INDEX];
  if (!nose || !leftEye || !rightEye) return [];
  const scale = Math.max(
    0.001,
    Math.hypot(rightEye.x - leftEye.x, rightEye.y - leftEye.y)
  );
  return SELECTED_MOTION_LANDMARKS.map((index) => ({
    x: (landmarks[index].x - nose.x) / scale,
    y: (landmarks[index].y - nose.y) / scale
  }));
}

function motionIndex(
  current: NormalizedPoint[],
  previous: NormalizedPoint[] | null
): number {
  if (!previous || previous.length !== current.length) return 0;
  return (
    current.reduce(
      (total, point, index) =>
        total +
        Math.hypot(
          point.x - previous[index].x,
          point.y - previous[index].y
        ),
      0
    ) / current.length
  );
}

export function deriveFaceFeature(
  result: FaceLandmarkerResult,
  input: {
    tMs: number;
    illumination: number;
    observedFrameRate: number;
    state?: FaceFeatureState;
  }
): FaceFeatureResult {
  const landmarks = result.faceLandmarks[0];
  if (!landmarks) {
    return {
      frame: {
        tMs: input.tMs,
        faceVisible: false,
        framingFraction: 0,
        illumination: input.illumination,
        yawDegrees: 0,
        eyeAspectRatio: 0,
        browRaise: 0,
        mouthOpen: 0,
        landmarkMotion: 0,
        observedFrameRate: input.observedFrameRate,
        faceBoxWidth: 0,
        faceBoxHeight: 0,
        edgeMargin: 0
      },
      nextState: { normalizedMotionPoints: null },
      overlayPoints: [],
      boundingBox: null
    };
  }

  const box = boundingBox(landmarks);
  const categories = result.faceBlendshapes[0]?.categories ?? [];
  const blink =
    (categoryScore(categories, "eyeBlinkLeft") +
      categoryScore(categories, "eyeBlinkRight")) /
    2;
  const points = normalizedMotionPoints(landmarks);
  const edgeMargin = Math.min(
    box.x,
    box.y,
    1 - (box.x + box.width),
    1 - (box.y + box.height)
  );

  return {
    frame: {
      tMs: input.tMs,
      faceVisible: true,
      framingFraction: framingScore(box),
      illumination: input.illumination,
      yawDegrees: yawDegrees(landmarks),
      eyeAspectRatio: 1 - blink,
      browRaise: categoryScore(categories, "browInnerUp"),
      mouthOpen: categoryScore(categories, "jawOpen"),
      landmarkMotion: motionIndex(
        points,
        input.state?.normalizedMotionPoints ?? null
      ),
      observedFrameRate: input.observedFrameRate,
      faceBoxWidth: box.width,
      faceBoxHeight: box.height,
      edgeMargin
    },
    nextState: { normalizedMotionPoints: points },
    overlayPoints: SELECTED_MOTION_LANDMARKS.map((index) => ({
      x: landmarks[index].x,
      y: landmarks[index].y
    })),
    boundingBox: box
  };
}
