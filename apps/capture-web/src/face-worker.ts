/// <reference lib="webworker" />

import {
  FaceLandmarker,
  FilesetResolver
} from "@mediapipe/tasks-vision";
import { deriveFaceFeature, type FaceFeatureState } from "./face-features.js";

const WASM_ROOT =
  "/mediapipe-runtime";
const MODEL_PATH = "/models/face_landmarker.task";

let landmarker: FaceLandmarker | null = null;
let featureState: FaceFeatureState = { normalizedMotionPoints: null };
let lastFrameAtMs: number | null = null;
const illuminationCanvas = new OffscreenCanvas(32, 18);
const illuminationContext = illuminationCanvas.getContext("2d", {
  willReadFrequently: true
});

function illuminationFor(bitmap: ImageBitmap): number {
  if (!illuminationContext) return 0;
  illuminationContext.drawImage(
    bitmap,
    0,
    0,
    illuminationCanvas.width,
    illuminationCanvas.height
  );
  const pixels = illuminationContext.getImageData(
    0,
    0,
    illuminationCanvas.width,
    illuminationCanvas.height
  ).data;
  let total = 0;
  for (let index = 0; index < pixels.length; index += 4) {
    total +=
      pixels[index] * 0.2126 +
      pixels[index + 1] * 0.7152 +
      pixels[index + 2] * 0.0722;
  }
  return total / (pixels.length / 4) / 255;
}

async function initialize(): Promise<void> {
  const vision = await FilesetResolver.forVisionTasks(WASM_ROOT);
  const options = {
    runningMode: "VIDEO",
    numFaces: 1,
    minFaceDetectionConfidence: 0.5,
    minFacePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
    outputFaceBlendshapes: true,
    outputFacialTransformationMatrixes: true
  } as const;
  try {
    landmarker = await FaceLandmarker.createFromOptions(vision, {
      ...options,
      baseOptions: { modelAssetPath: MODEL_PATH, delegate: "GPU" }
    });
  } catch {
    landmarker = await FaceLandmarker.createFromOptions(vision, {
      ...options,
      baseOptions: { modelAssetPath: MODEL_PATH, delegate: "CPU" }
    });
  }
  self.postMessage({ type: "ready" });
}

self.addEventListener("message", async (event: MessageEvent) => {
  const message = event.data as
    | { type: "initialize" }
    | { type: "frame"; bitmap: ImageBitmap; tMs: number }
    | { type: "reset" };

  if (message.type === "initialize") {
    try {
      await initialize();
    } catch (error) {
      self.postMessage({
        type: "error",
        message:
          error instanceof Error
            ? error.message
            : "Face Landmarker could not initialize."
      });
    }
    return;
  }

  if (message.type === "reset") {
    featureState = { normalizedMotionPoints: null };
    lastFrameAtMs = null;
    return;
  }

  if (!landmarker) {
    message.bitmap.close();
    self.postMessage({ type: "error", message: "Face Landmarker is not ready." });
    return;
  }

  try {
    const result = landmarker.detectForVideo(message.bitmap, message.tMs);
    const frameStep =
      lastFrameAtMs === null ? 100 : Math.max(1, message.tMs - lastFrameAtMs);
    lastFrameAtMs = message.tMs;
    const derived = deriveFaceFeature(result, {
      tMs: message.tMs,
      illumination: illuminationFor(message.bitmap),
      observedFrameRate: 1000 / frameStep,
      state: featureState
    });
    featureState = derived.nextState;
    self.postMessage({
      type: "frame",
      frame: derived.frame,
      overlayPoints: derived.overlayPoints,
      boundingBox: derived.boundingBox
    });
  } catch (error) {
    self.postMessage({
      type: "error",
      message:
        error instanceof Error ? error.message : "Face inference failed."
    });
  } finally {
    message.bitmap.close();
  }
});
