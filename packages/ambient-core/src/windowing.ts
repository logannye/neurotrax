import type { AudioFeatureFrame, FaceLandmarkFrame, FrameStream } from "./primitives.js";
import type { ConfoundEnvelope, MeasurableWindow, Modality } from "@neurotrax/contracts";
import { mean } from "./stats.js";

export const MIN_WINDOW_MS = 1500;

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

function speechConfounds(frames: AudioFeatureFrame[]): ConfoundEnvelope {
  return {
    snrDb: mean(frames.map((f) => f.snrDb)),
    faceFramingFraction: 0,
    observedFrameRate: 0,
    illuminationRelative: 0
  };
}

function faceConfounds(frames: FaceLandmarkFrame[]): ConfoundEnvelope {
  return {
    snrDb: 0,
    faceFramingFraction: mean(frames.map((f) => f.framingFraction)),
    observedFrameRate: mean(frames.map((f) => f.observedFrameRate)),
    illuminationRelative: mean(frames.map((f) => f.illumination))
  };
}

export function detectMeasurableWindows(stream: FrameStream): MeasurableWindow[] {
  const windows: MeasurableWindow[] = [];

  contiguousRuns(stream.audio, (f) => f.voiced).forEach((run, i) => {
    windows.push({
      windowId: `speech-${i}`,
      modality: "speech",
      startMs: run.startMs,
      endMs: run.endMs,
      context: { kind: "spontaneous-speech", confounds: speechConfounds(run.frames) }
    });
  });

  contiguousRuns(stream.face, (f) => f.faceVisible).forEach((run, i) => {
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
