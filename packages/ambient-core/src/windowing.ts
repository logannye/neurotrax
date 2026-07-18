import type { AudioFeatureFrame, FaceLandmarkFrame, FrameStream } from "./primitives.js";
import type { ConfoundEnvelope, MeasurableWindow, Modality } from "@neurotrax/contracts";
import { mean } from "./stats.js";

export const MIN_WINDOW_MS = 1500;
export const MAX_SPEECH_PAUSE_MS = 2000;
export const MAX_FACE_WINDOW_YAW_DEGREES = 30;

interface Run<T> {
  frames: T[];
  startMs: number;
  endMs: number;
}

function contiguousRuns<T extends { tMs: number }>(
  frames: T[],
  predicate: (frame: T) => boolean
): Run<T>[] {
  const runs: Run<T>[] = [];
  let current: T[] = [];
  const flush = () => {
    if (current.length > 0) {
      runs.push({
        frames: current,
        startMs: current[0].tMs,
        endMs: current[current.length - 1].tMs
      });
      current = [];
    }
  };
  for (const frame of frames) {
    if (predicate(frame)) current.push(frame);
    else flush();
  }
  flush();
  return runs.filter((run) => run.endMs - run.startMs >= MIN_WINDOW_MS);
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

function speechConfounds(frames: AudioFeatureFrame[]): ConfoundEnvelope {
  return {
    snrDb: mean(frames.map((f) => f.snrDb)),
    faceFramingFraction: 0,
    observedFrameRate: 0,
    illuminationRelative: 0,
    yawDegrees: 0
  };
}

function faceConfounds(frames: FaceLandmarkFrame[]): ConfoundEnvelope {
  return {
    snrDb: 0,
    faceFramingFraction: mean(frames.map((f) => f.framingFraction)),
    observedFrameRate: mean(frames.map((f) => f.observedFrameRate)),
    illuminationRelative: mean(frames.map((f) => f.illumination)),
    yawDegrees: mean(frames.map((f) => Math.abs(f.yawDegrees ?? 0)))
  };
}

export function detectMeasurableWindows(stream: FrameStream): MeasurableWindow[] {
  const windows: MeasurableWindow[] = [];

  speechRuns(stream.audio).forEach((run, i) => {
    windows.push({
      windowId: `speech-${i}`,
      modality: "speech",
      startMs: run.startMs,
      endMs: run.endMs,
      context: { kind: "spontaneous-speech", confounds: speechConfounds(run.frames) }
    });
  });

  contiguousRuns(
    stream.face,
    (frame) =>
      frame.faceVisible &&
      frame.framingFraction >= 0.6 &&
      Math.abs(frame.yawDegrees ?? 0) <= MAX_FACE_WINDOW_YAW_DEGREES
  ).forEach((run, i) => {
    windows.push({
      windowId: `face-${i}`,
      modality: "face",
      startMs: run.startMs,
      endMs: run.endMs,
      context: { kind: "listening-expressive", confounds: faceConfounds(run.frames) }
    });
  });

  const modalityOrder: Record<Modality, number> = { speech: 0, face: 1 };
  return windows.sort(
    (a, b) => a.startMs - b.startMs || modalityOrder[a.modality] - modalityOrder[b.modality]
  );
}
