/// <reference lib="webworker" />

import {
  FaceLandmarker,
  FilesetResolver
} from "@mediapipe/tasks-vision";
import {
  AMBIENT_FACE_MAX_CALIBRATION_SIZE_DELTA,
  AMBIENT_FACE_MAX_FRAME_GAP_MS,
  AMBIENT_FACE_MAX_PITCH_DEGREES,
  AMBIENT_FACE_MAX_ROLL_DEGREES,
  AMBIENT_FACE_MAX_YAW_DEGREES,
  type FacialKinematicsFrameV1
} from "@phenometric/ambient-core";
import {
  boundingBoxForLandmarks,
  deriveFaceFeature,
  type FaceFeatureState
} from "./face-features.js";
import {
  FaceMeshOverlayRenderer,
  faceMeshPresentationEligible
} from "./face-mesh-overlay.js";
import {
  VISUAL_WORKER_MESSAGE_VERSION,
  visualPipelineProvenance,
  type VisualWorkerErrorMessage,
  type VisualWorkerFrameMessage,
  type VisualWorkerRequest,
  type VisualWorkerResponse
} from "./face-worker-protocol.js";
import { computeFaceImageQuality } from "./visual-image-quality.js";

const QUALITY_ROI_SIZE = 64;
const CADENCE_WINDOW_MS = 2_000;

let landmarker: FaceLandmarker | null = null;
let provenance: ReturnType<typeof visualPipelineProvenance> | null = null;
let activeCaptureEpoch = 0;
let lastSequence = 0;
let lastAcquiredAtMs: number | null = null;
let featureState: FaceFeatureState = {
  normalizedMotionPoints: null,
  acquiredAtMs: null
};
let analyzedAcquisitionTimes: number[] = [];
let initializing: Promise<void> | null = null;
let activeModelAsset = "";
let activeModelSha256 = "";
const meshOverlay = new FaceMeshOverlayRenderer();
let meshOverlayCaptureEpoch: number | null = null;
const qualityCanvas = new OffscreenCanvas(
  QUALITY_ROI_SIZE,
  QUALITY_ROI_SIZE
);
const qualityContext = qualityCanvas.getContext("2d", {
  willReadFrequently: true
});

function post(message: VisualWorkerResponse): void {
  self.postMessage(message);
}

function resetDerivedState(captureEpoch: number): void {
  meshOverlay.clear();
  if (meshOverlay.isAttached()) {
    meshOverlayCaptureEpoch = captureEpoch;
  }
  activeCaptureEpoch = captureEpoch;
  lastSequence = 0;
  lastAcquiredAtMs = null;
  analyzedAcquisitionTimes = [];
  featureState = {
    normalizedMotionPoints: null,
    acquiredAtMs: null
  };
}

function errorMessage(
  message: string,
  input: {
    code: VisualWorkerErrorMessage["code"];
    recoverable: boolean;
    sequence?: number;
    acquiredAtMs?: number;
    captureEpoch?: number;
  }
): VisualWorkerErrorMessage {
  return {
    schemaVersion: VISUAL_WORKER_MESSAGE_VERSION,
    type: "error",
    captureEpoch: input.captureEpoch ?? activeCaptureEpoch,
    sequence: input.sequence ?? null,
    acquiredAtMs: input.acquiredAtMs ?? null,
    code: input.code,
    message,
    recoverable: input.recoverable
  };
}

function readableError(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function continuityEligible(
  frame: FacialKinematicsFrameV1,
  calibration: VisualWorkerFrameMessage["calibration"]
): boolean {
  if (
    frame.qualityReasons.length > 0 ||
    frame.pose === null ||
    frame.boundingBox === null ||
    Math.abs(frame.pose.yawDegrees) > AMBIENT_FACE_MAX_YAW_DEGREES ||
    Math.abs(frame.pose.pitchDegrees) > AMBIENT_FACE_MAX_PITCH_DEGREES ||
    Math.abs(frame.pose.rollDegrees) > AMBIENT_FACE_MAX_ROLL_DEGREES ||
    (frame.interResultGapMs !== null &&
      frame.interResultGapMs > AMBIENT_FACE_MAX_FRAME_GAP_MS)
  ) {
    return false;
  }
  if (!calibration) return true;
  const widthRatio =
    frame.boundingBox.widthPixels / calibration.baselineBoxWidthPixels;
  const heightRatio =
    frame.boundingBox.heightPixels / calibration.baselineBoxHeightPixels;
  return (
    Number.isFinite(widthRatio) &&
    Number.isFinite(heightRatio) &&
    Math.abs(widthRatio - 1) <= AMBIENT_FACE_MAX_CALIBRATION_SIZE_DELTA &&
    Math.abs(heightRatio - 1) <= AMBIENT_FACE_MAX_CALIBRATION_SIZE_DELTA
  );
}

async function initialize(
  message: Extract<VisualWorkerRequest, { type: "initialize" }>
): Promise<void> {
  resetDerivedState(message.captureEpoch);
  if (landmarker && provenance) {
    post({
      schemaVersion: VISUAL_WORKER_MESSAGE_VERSION,
      type: "ready",
      captureEpoch: activeCaptureEpoch,
      provenance,
      videoCaptureSettings: message.videoCaptureSettings
    });
    return;
  }
  if (initializing) {
    await initializing;
    if (provenance) {
      post({
        schemaVersion: VISUAL_WORKER_MESSAGE_VERSION,
        type: "ready",
        captureEpoch: activeCaptureEpoch,
        provenance,
        videoCaptureSettings: message.videoCaptureSettings
      });
    }
    return;
  }

  initializing = (async () => {
    const vision = await FilesetResolver.forVisionTasks(
      message.assets.mediaPipeRootUrl,
      true
    );
    const options = {
      runningMode: "VIDEO",
      numFaces: 2,
      minFaceDetectionConfidence: 0.5,
      minFacePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
      outputFaceBlendshapes: true,
      outputFacialTransformationMatrixes: true
    } as const;
    try {
      landmarker = await FaceLandmarker.createFromOptions(vision, {
        ...options,
        baseOptions: {
          modelAssetPath: message.assets.modelUrl,
          delegate: "GPU"
        }
      });
      activeModelAsset = message.assets.modelUrl;
      activeModelSha256 = message.assets.modelSha256;
      provenance = visualPipelineProvenance(
        "GPU",
        activeModelAsset,
        activeModelSha256
      );
    } catch {
      landmarker = await FaceLandmarker.createFromOptions(vision, {
        ...options,
        baseOptions: {
          modelAssetPath: message.assets.modelUrl,
          delegate: "CPU"
        }
      });
      activeModelAsset = message.assets.modelUrl;
      activeModelSha256 = message.assets.modelSha256;
      provenance = visualPipelineProvenance(
        "CPU",
        activeModelAsset,
        activeModelSha256
      );
    }
  })();

  try {
    await initializing;
    if (!provenance) {
      throw new Error("Face Landmarker did not report processor provenance.");
    }
    post({
      schemaVersion: VISUAL_WORKER_MESSAGE_VERSION,
      type: "ready",
      captureEpoch: activeCaptureEpoch,
      provenance,
      videoCaptureSettings: message.videoCaptureSettings
    });
  } finally {
    initializing = null;
  }
}

function imageQualityFor(
  bitmap: ImageBitmap,
  box: ReturnType<typeof boundingBoxForLandmarks>
) {
  if (!qualityContext) {
    return {
      illuminationMean: 0,
      darkClippingFraction: 1,
      brightClippingFraction: 0,
      sharpness: 0
    };
  }

  const x = box ? Math.max(0, box.x * bitmap.width) : 0;
  const y = box ? Math.max(0, box.y * bitmap.height) : 0;
  const width = box
    ? Math.max(1, Math.min(bitmap.width - x, box.width * bitmap.width))
    : bitmap.width;
  const height = box
    ? Math.max(1, Math.min(bitmap.height - y, box.height * bitmap.height))
    : bitmap.height;
  qualityContext.clearRect(0, 0, QUALITY_ROI_SIZE, QUALITY_ROI_SIZE);
  qualityContext.drawImage(
    bitmap,
    x,
    y,
    width,
    height,
    0,
    0,
    QUALITY_ROI_SIZE,
    QUALITY_ROI_SIZE
  );
  return computeFaceImageQuality(
    qualityContext.getImageData(
      0,
      0,
      QUALITY_ROI_SIZE,
      QUALITY_ROI_SIZE
    )
  );
}

function cadenceFor(acquiredAtMs: number): {
  analyzedFrameRate: number;
  interResultGapMs: number | null;
} {
  const interResultGapMs =
    lastAcquiredAtMs === null
      ? null
      : acquiredAtMs - lastAcquiredAtMs;
  analyzedAcquisitionTimes.push(acquiredAtMs);
  const floor = acquiredAtMs - CADENCE_WINDOW_MS;
  analyzedAcquisitionTimes = analyzedAcquisitionTimes.filter(
    (timestamp) => timestamp >= floor
  );
  const analyzedFrameRate =
    analyzedAcquisitionTimes.length < 2
      ? 0
      : ((analyzedAcquisitionTimes.length - 1) * 1_000) /
        Math.max(
          1,
          acquiredAtMs - analyzedAcquisitionTimes[0]
        );
  return { analyzedFrameRate, interResultGapMs };
}

function processFrame(message: VisualWorkerFrameMessage): void {
  if (
    message.captureEpoch !== activeCaptureEpoch
  ) {
    message.bitmap.close();
    post({
      schemaVersion: VISUAL_WORKER_MESSAGE_VERSION,
      type: "discarded",
      captureEpoch: message.captureEpoch,
      sequence: message.sequence,
      acquiredAtMs: message.acquiredAtMs,
      reason: "capture-epoch-mismatch"
    });
    return;
  }
  if (
    message.sequence <= lastSequence ||
    (lastAcquiredAtMs !== null &&
      message.acquiredAtMs <= lastAcquiredAtMs)
  ) {
    message.bitmap.close();
    post({
      schemaVersion: VISUAL_WORKER_MESSAGE_VERSION,
      type: "discarded",
      captureEpoch: message.captureEpoch,
      sequence: message.sequence,
      acquiredAtMs: message.acquiredAtMs,
      reason: "non-monotonic-sequence"
    });
    return;
  }
  if (!landmarker || !provenance) {
    message.bitmap.close();
    meshOverlay.clear();
    post(
      errorMessage("Face Landmarker is not ready.", {
        code: "worker-not-ready",
        recoverable: true,
        captureEpoch: message.captureEpoch,
        sequence: message.sequence,
        acquiredAtMs: message.acquiredAtMs
      })
    );
    return;
  }

  const processingStartedAtMs = performance.now();
  try {
    // Native landmarks, blendshapes, and the transform remain scoped to this
    // synchronous turn and are never included in a worker response.
    const nativeResult = landmarker.detectForVideo(
      message.bitmap,
      message.acquiredAtMs
    );
    const faceCount = nativeResult.faceLandmarks.length;
    const nativeLandmarks = faceCount === 1
      ? nativeResult.faceLandmarks[0]
      : undefined;
    if (faceCount !== 1) {
      featureState = {
        normalizedMotionPoints: null,
        acquiredAtMs: null
      };
    }
    const box = nativeLandmarks
      ? boundingBoxForLandmarks(
          nativeLandmarks,
          message.width,
          message.height
        )
      : null;
    const imageQuality = imageQualityFor(message.bitmap, box);
    const cadence = cadenceFor(message.acquiredAtMs);
    const singleFaceResult = faceCount === 1
      ? nativeResult
      : {
          ...nativeResult,
          faceLandmarks: [],
          faceBlendshapes: [],
          facialTransformationMatrixes: []
        };
    const derived = deriveFaceFeature(singleFaceResult, {
      tMs: message.tMs,
      acquiredAtMs: message.acquiredAtMs,
      sequence: message.sequence,
      captureEpoch: message.captureEpoch,
      taskContext: message.taskContext,
      frameWidth: message.width,
      frameHeight: message.height,
      imageQuality,
      analyzedFrameRate: cadence.analyzedFrameRate,
      interResultGapMs: cadence.interResultGapMs,
      skippedFrameFraction: message.stream.busyDropFraction,
      processingLatencyMs:
        performance.now() - processingStartedAtMs,
      processorRef: provenance.processorRef,
      calibration: message.calibration,
      state: featureState
    });
    featureState = continuityEligible(derived.frame, message.calibration)
      ? derived.nextState
      : {
          normalizedMotionPoints: null,
          acquiredAtMs: null
        };
    lastSequence = message.sequence;
    lastAcquiredAtMs = message.acquiredAtMs;
    if (
      nativeLandmarks &&
      faceMeshPresentationEligible(
        faceCount,
        message.captureEpoch,
        meshOverlayCaptureEpoch
      )
    ) {
      meshOverlay.render({
        landmarks: nativeLandmarks,
        taskContext: message.taskContext,
        width: message.width,
        height: message.height,
        acquiredAtMs: message.acquiredAtMs
      });
    } else {
      meshOverlay.clear();
    }
    post({
      schemaVersion: VISUAL_WORKER_MESSAGE_VERSION,
      type: "frame",
      captureEpoch: message.captureEpoch,
      sequence: message.sequence,
      acquiredAtMs: message.acquiredAtMs,
      faceCount,
      frame: derived.frame,
      boundingBox: derived.boundingBox,
      stream: message.stream
    });
  } catch (error) {
    meshOverlay.clear();
    post(
      errorMessage(readableError(error, "Face inference failed."), {
        code: "inference-failed",
        recoverable: true,
        captureEpoch: message.captureEpoch,
        sequence: message.sequence,
        acquiredAtMs: message.acquiredAtMs
      })
    );
  } finally {
    message.bitmap.close();
  }
}

function dispose(captureEpoch: number): void {
  meshOverlay.detach();
  meshOverlayCaptureEpoch = null;
  landmarker?.close();
  landmarker = null;
  provenance = null;
  activeModelAsset = "";
  activeModelSha256 = "";
  resetDerivedState(captureEpoch);
  post({
    schemaVersion: VISUAL_WORKER_MESSAGE_VERSION,
    type: "disposed",
    captureEpoch
  });
}

self.addEventListener("message", (event: MessageEvent<unknown>) => {
  const candidate = event.data as Partial<VisualWorkerRequest> | null;
  if (
    !candidate ||
    candidate.schemaVersion !== VISUAL_WORKER_MESSAGE_VERSION ||
    typeof candidate.type !== "string"
  ) {
    if (
      candidate &&
      candidate.type === "frame" &&
      "bitmap" in candidate &&
      candidate.bitmap instanceof ImageBitmap
    ) {
      candidate.bitmap.close();
    }
    post(
      errorMessage("Unsupported visual worker message.", {
        code: "invalid-message",
        recoverable: false
      })
    );
    return;
  }

  const message = candidate as VisualWorkerRequest;
  if (message.type === "initialize") {
    void initialize(message).catch((error) => {
      meshOverlay.clear();
      post(
        errorMessage(
          readableError(
            error,
            "Face Landmarker could not initialize."
          ),
          {
            code: "initialization-failed",
            recoverable: false,
            captureEpoch: message.captureEpoch
          }
        )
      );
    });
    return;
  }
  if (message.type === "reset") {
    resetDerivedState(message.captureEpoch);
    return;
  }
  if (message.type === "attach-overlay") {
    if (message.captureEpoch < activeCaptureEpoch) {
      post({
        schemaVersion: VISUAL_WORKER_MESSAGE_VERSION,
        type: "overlay-status",
        captureEpoch: message.captureEpoch,
        attached: false
      });
      return;
    }
    const attached = meshOverlay.attach(
      message.canvas,
      message.maxRenderHz
    );
    meshOverlayCaptureEpoch = attached ? message.captureEpoch : null;
    post({
      schemaVersion: VISUAL_WORKER_MESSAGE_VERSION,
      type: "overlay-status",
      captureEpoch: message.captureEpoch,
      attached
    });
    return;
  }
  if (message.type === "clear-overlay") {
    if (message.captureEpoch === meshOverlayCaptureEpoch) {
      meshOverlay.clear();
    }
    return;
  }
  if (message.type === "dispose") {
    dispose(message.captureEpoch);
    return;
  }
  processFrame(message);
});
