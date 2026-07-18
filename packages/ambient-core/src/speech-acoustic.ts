import type { AudioFeatureFrame } from "./primitives.js";
import type { Abstention, MeasurableWindow, Measurement } from "@neurotrax/contracts";
import { mean, median, stdDev } from "./stats.js";

export const SPEECH_ACOUSTIC_VERSION = "speech-acoustic-0.2";
export const SPEECH_SNR_FLOOR_DB = 12;
const MIN_VOICED_FRAMES = 3;
export const MIN_PAUSE_MS = 300;
export const MAX_PAUSE_MS = 2000;

function estimatedFrameStepMs(frames: AudioFeatureFrame[]): number {
  if (frames.length < 2) return 100;
  return median(
    frames
      .slice(1)
      .map((frame, index) => Math.max(1, frame.tMs - frames[index].tMs))
  );
}

export function countBoundedPauses(frames: AudioFeatureFrame[]): number {
  let pauses = 0;
  let pauseStartMs: number | null = null;
  let pauseEndMs: number | null = null;
  const frameStepMs = estimatedFrameStepMs(frames);

  for (const f of frames) {
    if (!f.voiced) {
      pauseStartMs ??= f.tMs;
      pauseEndMs = f.tMs;
    } else if (pauseStartMs !== null && pauseEndMs !== null) {
      const durationMs = pauseEndMs - pauseStartMs + frameStepMs;
      if (durationMs >= MIN_PAUSE_MS && durationMs <= MAX_PAUSE_MS) {
        pauses += 1;
      }
      pauseStartMs = null;
      pauseEndMs = null;
    }
  }

  if (pauseStartMs !== null && pauseEndMs !== null) {
    const durationMs = pauseEndMs - pauseStartMs + frameStepMs;
    if (durationMs >= MIN_PAUSE_MS && durationMs <= MAX_PAUSE_MS) pauses += 1;
  }

  return pauses;
}

export function pitchVariabilitySemitones(
  pitchesHz: number[]
): number {
  if (pitchesHz.length < 2) return 0;
  const centerHz = median(pitchesHz);
  if (centerHz <= 0) return 0;
  return stdDev(pitchesHz.map((pitchHz) => 12 * Math.log2(pitchHz / centerHz)));
}

function measurement(
  window: MeasurableWindow,
  code: string,
  label: string,
  value: number,
  unit: string,
  confidence: number
): Measurement {
  return {
    code,
    label,
    value,
    unit,
    confidence,
    uncertainty: "placeholder",
    algorithmVersion: SPEECH_ACOUSTIC_VERSION,
    clinicalValidation: "none",
    contextRef: window.windowId,
    windowStartMs: window.startMs,
    windowEndMs: window.endMs,
    evidenceSnippetRef: null
  };
}

export function extractSpeechAcoustic(
  window: MeasurableWindow,
  frames: AudioFeatureFrame[]
): Measurement[] | Abstention {
  const abstain = (reasonCode: string, detail: string): Abstention => ({
    modality: "speech",
    windowStartMs: window.startMs,
    windowEndMs: window.endMs,
    reasonCode,
    detail
  });

  const voiced = frames.filter((f) => f.voiced);
  if (voiced.length < MIN_VOICED_FRAMES) {
    return abstain(
      "insufficient-voiced-frames",
      `Window has ${voiced.length} voiced frames; ${MIN_VOICED_FRAMES} required.`
    );
  }
  const meanSnr = mean(frames.map((f) => f.snrDb));
  if (meanSnr < SPEECH_SNR_FLOOR_DB) {
    return abstain(
      "snr-too-low",
      `Mean SNR ${meanSnr.toFixed(1)} dB below the ${SPEECH_SNR_FLOOR_DB} dB floor.`
    );
  }

  const confidence = Math.min(1, meanSnr / 30);
  const voicedTimeFraction = voiced.length / frames.length;
  const pauseCount = countBoundedPauses(frames);
  const durationMinutes =
    Math.max(1, window.endMs - window.startMs) / 60000;
  const pauseRate = pauseCount / durationMinutes;
  const pitchVariability = pitchVariabilitySemitones(
    voiced.map((f) => f.pitchHz).filter((p): p is number => p !== null)
  );

  return [
    measurement(window, "prototype.speech.voiced_time_fraction", "Voiced-time fraction", voicedTimeFraction, "ratio", confidence),
    measurement(window, "prototype.speech.pause_rate", "Pause rate", pauseRate, "pauses-per-minute", confidence),
    measurement(window, "prototype.speech.pitch_variability", "Pitch variability", pitchVariability, "semitone-stddev", confidence)
  ];
}
