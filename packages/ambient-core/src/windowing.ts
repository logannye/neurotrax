import type {
  ConfoundEnvelope,
  GuidedVoiceTaskEvidenceInterval,
  GuidedTaskEvidenceInterval,
  MeasurementContextKind,
  MeasurableWindow,
  Modality,
  SpeechConfoundEnvelope,
  VisualConfoundEnvelope,
  VisualTaskContext,
  VoiceTaskContext
} from "@phenometric/contracts";
import type {
  VoiceSignalFrameV1,
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

interface VoiceRun extends Run<VoiceSignalFrameV1> {
  taskContext: VoiceTaskContext;
  taskStartedAtMs: number;
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
  guidedVoiceTaskEvidenceIntervals?:
    | readonly GuidedVoiceTaskEvidenceInterval[];
}

function voiceRuns(
  stream: FrameStream,
  acceptedIntervals:
    | readonly GuidedVoiceTaskEvidenceInterval[]
    | undefined
): VoiceRun[] {
  if (stream.selectedProtocolId !== "voice-foundation.v1") return [];
  if (acceptedIntervals !== undefined) {
    return acceptedIntervals.flatMap((interval) => {
      const frames = stream.audio.filter(
        (frame) =>
          frame.taskContext === interval.taskContext &&
          frame.processorRef === interval.processorRef &&
          frame.tMs >= interval.startMs &&
          frame.tMs <= interval.endMs
      );
      if (
        frames.length < 2 ||
        frames[0].tMs > interval.startMs + 40 ||
        frames.at(-1)!.tMs < interval.endMs - 40
      ) {
        return [];
      }
      return [{
        frames,
        startMs: interval.startMs,
        endMs: interval.endMs,
        taskContext: interval.taskContext,
        taskStartedAtMs: interval.taskStartedAtMs
      }];
    });
  }

  const runs: VoiceRun[] = [];
  let current: VoiceSignalFrameV1[] = [];
  let taskContext: VoiceTaskContext | null = null;
  const flush = (): void => {
    if (
      current.length >= 2 &&
      taskContext !== null &&
      current.at(-1)!.tMs - current[0].tMs >= MIN_WINDOW_MS &&
      !["quiet-calibration", "natural-speech-check"].includes(
        taskContext
      )
    ) {
      runs.push({
        frames: current,
        startMs: current[0].tMs,
        endMs: current.at(-1)!.tMs,
        taskContext,
        taskStartedAtMs: current[0].tMs
      });
    }
    current = [];
    taskContext = null;
  };
  for (const frame of stream.audio) {
    const prior = current.at(-1);
    if (
      prior &&
      (frame.taskContext !== taskContext ||
        frame.captureEpoch !== prior.captureEpoch ||
        frame.processorRef !== prior.processorRef ||
        frame.tMs - prior.tMs > 40)
    ) {
      flush();
    }
    taskContext = frame.taskContext;
    current.push(frame);
  }
  flush();
  return runs;
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
  frames: VoiceSignalFrameV1[]
): SpeechConfoundEnvelope {
  const sampleRateHz = Math.round(
    mean(frames.map((frame) => frame.sampleRateHz))
  );
  const browserProcessing =
    frames[0]?.browserProcessing ?? {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false
    };
  return {
    kind: "speech",
    sampleRateHz,
    sampleRateClass:
      sampleRateHz >= 48_000
        ? "48khz-or-higher"
        : sampleRateHz >= 44_100
          ? "44.1khz"
          : "below-44.1khz",
    browserProcessing: { ...browserProcessing },
    snrDb: mean(frames.map((frame) => frame.snrDb)),
    clippingFraction:
      mean(frames.map((frame) => frame.clippedSampleFraction)),
    dcOffset: mean(frames.map((frame) => Math.abs(frame.dcOffset))),
    lostBlockFraction: Math.max(
      0,
      ...frames.map((frame) => frame.lostBlockFraction)
    ),
    maximumBlockGapMs: Math.max(
      0,
      ...frames.map((frame) => frame.blockGapMs)
    ),
    usableCoverage:
      frames.filter((frame) => frame.qualityReasons.length === 0).length /
      Math.max(1, frames.length),
    periodicityCoverage:
      frames.filter(
        (frame) =>
          frame.voiced &&
          frame.f0Hz !== null &&
          frame.f0Confidence >= 0.55
      ).length /
      Math.max(1, frames.filter((frame) => frame.voiced).length)
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

function contextKindForVoiceTask(
  taskContext: VoiceTaskContext
): MeasurementContextKind {
  if (
    taskContext === "sustained-vowel-1" ||
    taskContext === "sustained-vowel-2"
  ) {
    return "sustained-vowel";
  }
  if (taskContext === "standardized-reading") return "reading-aloud";
  if (taskContext === "rapid-syllables") return "rapid-syllables";
  return "spontaneous-speech";
}

export function detectMeasurableWindows(
  stream: FrameStream,
  options: WindowDetectionOptions = {}
): MeasurableWindow[] {
  const windows: MeasurableWindow[] = [];

  voiceRuns(
    stream,
    options.guidedVoiceTaskEvidenceIntervals
  ).forEach((run, index) => {
    windows.push({
      windowId: `speech-${index}`,
      modality: "speech",
      startMs: run.startMs,
      endMs: run.endMs,
      context: {
        kind: contextKindForVoiceTask(run.taskContext),
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
  frames: VoiceSignalFrameV1[] | FacialKinematicsFrameV1[],
  modality: Modality
): ConfoundEnvelope {
  return modality === "speech"
    ? speechConfounds(frames as VoiceSignalFrameV1[])
    : faceConfounds(frames as FacialKinematicsFrameV1[]);
}
