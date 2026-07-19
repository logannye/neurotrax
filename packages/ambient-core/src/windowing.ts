import type {
  ConfoundEnvelope,
  GuidedTaskEvidenceInterval,
  MeasurementContextKind,
  MeasurableWindow,
  Modality,
  SpeechConfoundEnvelope,
  VisualConfoundEnvelope,
  VisualTaskContext
} from "@phenometric/contracts";
import type {
  AudioFeatureFrame,
  FacialKinematicsFrameV1,
  FrameStream
} from "./primitives.js";
import { mean } from "./stats.js";
import {
  DEFAULT_CAPTURE_QUALITY_POLICY,
  evaluateVisualQuality
} from "./visual-quality.js";

export const MIN_WINDOW_MS = 1_500;
export const MAX_SPEECH_PAUSE_MS = 2_000;
export const MAX_FACE_WINDOW_YAW_DEGREES =
  DEFAULT_CAPTURE_QUALITY_POLICY.maximumFaceYawDegrees;

interface Run<T> {
  frames: T[];
  startMs: number;
  endMs: number;
}

function speechRuns(frames: AudioFeatureFrame[]): Run<AudioFeatureFrame>[] {
  const runs: Run<AudioFeatureFrame>[] = [];
  let current: AudioFeatureFrame[] = [];
  let lastVoicedAtMs: number | null = null;
  let lastVoicedIndex = -1;

  const flush = () => {
    if (lastVoicedIndex >= 0) {
      const trimmed = current.slice(0, lastVoicedIndex + 1);
      const startMs = trimmed[0].tMs;
      const endMs = trimmed[trimmed.length - 1].tMs;
      if (endMs - startMs >= MIN_WINDOW_MS) {
        runs.push({ frames: trimmed, startMs, endMs });
      }
    }
    current = [];
    lastVoicedAtMs = null;
    lastVoicedIndex = -1;
  };

  for (const frame of frames) {
    if (!frame.voiced && current.length === 0) continue;

    if (
      lastVoicedAtMs !== null &&
      frame.tMs - lastVoicedAtMs > MAX_SPEECH_PAUSE_MS
    ) {
      flush();
      if (!frame.voiced) continue;
    }

    current.push(frame);
    if (frame.voiced) {
      lastVoicedAtMs = frame.tMs;
      lastVoicedIndex = current.length - 1;
    }
  }

  flush();
  return runs;
}

interface FaceRun extends Run<FacialKinematicsFrameV1> {
  taskContext: VisualTaskContext;
}

export interface WindowDetectionOptions {
  faceSplitPointsMs?: readonly number[];
  /**
   * When supplied, visual frames are admitted only inside the controller's
   * final accepted evidence intervals. Omit this option for non-guided streams.
   */
  guidedTaskEvidenceIntervals?: readonly GuidedTaskEvidenceInterval[];
}

function validGuidedTaskEvidenceIntervals(
  intervals: readonly GuidedTaskEvidenceInterval[]
): GuidedTaskEvidenceInterval[] {
  return intervals
    .filter(
      (interval) =>
        Number.isFinite(interval.startMs) &&
        Number.isFinite(interval.endMs) &&
        interval.startMs >= 0 &&
        interval.endMs >= interval.startMs
    )
    .map((interval) => ({ ...interval }));
}

function acceptedIntervalForFrame(
  frame: FacialKinematicsFrameV1,
  intervals: readonly GuidedTaskEvidenceInterval[]
): GuidedTaskEvidenceInterval | null {
  return (
    intervals.find(
      (interval) =>
        interval.taskContext === frame.taskContext &&
        frame.tMs >= interval.startMs &&
        frame.tMs <= interval.endMs &&
        (interval.processorRef === undefined ||
          interval.processorRef === frame.processorRef)
    ) ?? null
  );
}

function faceRuns(
  stream: FrameStream,
  splitPointsMs: readonly number[],
  acceptedIntervals:
    | readonly GuidedTaskEvidenceInterval[]
    | undefined
): FaceRun[] {
  const runs: FaceRun[] = [];
  let current: FacialKinematicsFrameV1[] = [];
  let taskContext: VisualTaskContext | null = null;
  let acceptedInterval: GuidedTaskEvidenceInterval | null = null;

  const flush = () => {
    if (current.length > 0 && taskContext !== null) {
      const observedStartMs = current[0].tMs;
      const observedEndMs = current[current.length - 1].tMs;
      const startMs = acceptedInterval?.startMs ?? current[0].tMs;
      const endMs =
        acceptedInterval?.endMs ?? current[current.length - 1].tMs;
      const acceptedIntervalCovered =
        acceptedInterval !== null &&
        endMs - startMs >= MIN_WINDOW_MS &&
        current.length >= 2 &&
        Number.isFinite(observedStartMs) &&
        Number.isFinite(observedEndMs) &&
        observedStartMs <=
          startMs +
            DEFAULT_CAPTURE_QUALITY_POLICY.maximumVisualFrameGapMs &&
        observedEndMs >=
          endMs -
            DEFAULT_CAPTURE_QUALITY_POLICY.maximumVisualFrameGapMs;
      if (
        acceptedIntervalCovered ||
        (acceptedInterval === null &&
          observedEndMs - observedStartMs >= MIN_WINDOW_MS)
      ) {
        runs.push({ frames: current, startMs, endMs, taskContext });
      }
    }
    current = [];
    taskContext = null;
    acceptedInterval = null;
  };

  const validAcceptedIntervals =
    acceptedIntervals === undefined
      ? undefined
      : validGuidedTaskEvidenceIntervals(acceptedIntervals);

  for (const frame of stream.face) {
    const frameAcceptedInterval =
      validAcceptedIntervals === undefined
        ? null
        : acceptedIntervalForFrame(frame, validAcceptedIntervals);
    if (
      validAcceptedIntervals !== undefined &&
      frameAcceptedInterval === null
    ) {
      flush();
      continue;
    }

    const assessment = evaluateVisualQuality(
      frame,
      stream.calibration?.face ?? null
    );
    const prior = current.at(-1);
    const crossesExternalBoundary =
      prior !== undefined &&
      splitPointsMs.some(
        (boundary) =>
          boundary >= prior.tMs && boundary <= frame.tMs
      );
    const startsNewRun =
      prior !== undefined &&
      (frame.taskContext !== taskContext ||
        frame.captureEpoch !== prior.captureEpoch ||
        frame.processorRef !== prior.processorRef ||
        frameAcceptedInterval !== acceptedInterval ||
        crossesExternalBoundary ||
        frame.tMs - prior.tMs >
          DEFAULT_CAPTURE_QUALITY_POLICY.maximumVisualFrameGapMs);
    if (startsNewRun) flush();

    if (!assessment.usable || frame.taskContext === "turn-away") {
      flush();
      continue;
    }

    taskContext = frame.taskContext;
    acceptedInterval = frameAcceptedInterval;
    current.push(frame);
  }
  flush();
  return runs;
}

function speechConfounds(
  frames: AudioFeatureFrame[]
): SpeechConfoundEnvelope {
  return {
    kind: "speech",
    snrDb: mean(frames.map((frame) => frame.snrDb)),
    clippingFraction:
      frames.filter((frame) => frame.clipped).length /
      Math.max(1, frames.length)
  };
}

function faceConfounds(
  frames: FacialKinematicsFrameV1[]
): VisualConfoundEnvelope {
  const boxes = frames.flatMap((frame) =>
    frame.boundingBox === null ? [] : [frame.boundingBox]
  );
  const poses = frames.flatMap((frame) =>
    frame.pose === null ? [] : [frame.pose]
  );
  const gaps = frames.flatMap((frame) =>
    frame.interResultGapMs === null ? [] : [frame.interResultGapMs]
  );
  return {
    kind: "visual",
    faceBoxWidthPixels: mean(boxes.map((box) => box.widthPixels)),
    faceBoxHeightPixels: mean(boxes.map((box) => box.heightPixels)),
    faceWidthFraction: mean(boxes.map((box) => box.width)),
    faceHeightFraction: mean(boxes.map((box) => box.height)),
    edgeMarginFraction: mean(boxes.map((box) => box.edgeMarginFraction)),
    analyzedFrameRate: mean(
      frames.map((frame) => frame.analyzedFrameRate)
    ),
    skippedFrameFraction: mean(
      frames.map((frame) => frame.skippedFrameFraction)
    ),
    meanInterResultGapMs: gaps.length === 0 ? 0 : mean(gaps),
    illuminationMean: mean(
      frames.map((frame) => frame.imageQuality.illuminationMean)
    ),
    darkClippingFraction: mean(
      frames.map((frame) => frame.imageQuality.darkClippingFraction)
    ),
    brightClippingFraction: mean(
      frames.map((frame) => frame.imageQuality.brightClippingFraction)
    ),
    sharpness: mean(frames.map((frame) => frame.imageQuality.sharpness)),
    yawDegrees: mean(
      poses.map((pose) => Math.abs(pose.yawDegrees))
    ),
    pitchDegrees: mean(
      poses.map((pose) => Math.abs(pose.pitchDegrees))
    ),
    rollDegrees: mean(
      poses.map((pose) => Math.abs(pose.rollDegrees))
    )
  };
}

function contextKindForTask(
  taskContext: VisualTaskContext
): MeasurementContextKind {
  if (taskContext === "neutral-face") return "neutral-face";
  if (taskContext === "smile") return "smile";
  if (taskContext === "eye-closure") return "eye-closure";
  return "listening-expressive";
}

export function detectMeasurableWindows(
  stream: FrameStream,
  options: WindowDetectionOptions = {}
): MeasurableWindow[] {
  const windows: MeasurableWindow[] = [];

  speechRuns(stream.audio).forEach((run, index) => {
    windows.push({
      windowId: `speech-${index}`,
      modality: "speech",
      startMs: run.startMs,
      endMs: run.endMs,
      context: {
        kind: "spontaneous-speech",
        confounds: speechConfounds(run.frames)
      }
    });
  });

  faceRuns(
    stream,
    options.faceSplitPointsMs ?? [],
    options.guidedTaskEvidenceIntervals
  ).forEach((run, index) => {
    windows.push({
      windowId: `face-${index}`,
      modality: "face",
      startMs: run.startMs,
      endMs: run.endMs,
      context: {
        kind: contextKindForTask(run.taskContext),
        confounds: faceConfounds(run.frames)
      }
    });
  });

  const modalityOrder: Record<Modality, number> = { speech: 0, face: 1 };
  return windows.sort(
    (left, right) =>
      left.startMs - right.startMs ||
      modalityOrder[left.modality] - modalityOrder[right.modality]
  );
}

export function confoundsForWindow(
  frames: AudioFeatureFrame[] | FacialKinematicsFrameV1[],
  modality: Modality
): ConfoundEnvelope {
  return modality === "speech"
    ? speechConfounds(frames as AudioFeatureFrame[])
    : faceConfounds(frames as FacialKinematicsFrameV1[]);
}
