import type { AudioFeatureFrame } from "./primitives.js";
import type { Abstention, MeasurableWindow, Measurement } from "@phenometric/contracts";
import { mean, median, stdDev } from "./stats.js";

export const SPEECH_ACOUSTIC_VERSION = "speech-acoustic-0.4";
export const SPEECH_SNR_FLOOR_DB = 12;
const MIN_VOICED_FRAMES = 3;
export const MIN_PITCHED_FRAMES = 10;
export const MIN_PITCH_COVERAGE = 0.2;
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
    uncertainty: {
      kind: "not-estimated",
      reason: "Speech uncertainty is not estimated by this prototype extractor."
    },
    algorithmVersion: SPEECH_ACOUSTIC_VERSION,
    processorRef: SPEECH_ACOUSTIC_VERSION,
    clinicalValidation: "none",
    contextRef: window.windowId,
    sourceWindowRefs: [window.windowId],
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

  const voicedTimeFraction = voiced.length / frames.length;
  const pauseCount = countBoundedPauses(frames);
  const durationMs = Math.max(1, window.endMs - window.startMs);
  const durationMinutes = durationMs / 60000;
  const pauseRate = pauseCount / durationMinutes;
  const pitched = voiced.filter(
    (frame) =>
      frame.pitchHz !== null && (frame.pitchConfidence ?? 1) >= 0.55
  );
  const pitchCoverage = pitched.length / Math.max(1, voiced.length);
  const clippingScore =
    1 -
    frames.filter((frame) => frame.clipped).length /
      Math.max(1, frames.length);
  const snrScore = Math.min(1, Math.max(0, (meanSnr - 12) / 12));
  const durationScore = Math.min(1, durationMs / 10_000);
  const generalConfidence = Math.min(
    1,
    0.35 * snrScore +
      0.25 * durationScore +
      0.2 * pitchCoverage +
      0.2 * clippingScore
  );

  const measurements = [
    measurement(
      window,
      "prototype.speech.voiced_time_fraction",
      "Voiced-time fraction",
      voicedTimeFraction,
      "ratio",
      generalConfidence
    ),
    measurement(
      window,
      "prototype.speech.pause_rate",
      "Pause rate",
      pauseRate,
      "pauses-per-minute",
      generalConfidence
    )
  ];

  if (
    pitched.length >= MIN_PITCHED_FRAMES &&
    pitchCoverage >= MIN_PITCH_COVERAGE
  ) {
    const pitchVariability = pitchVariabilitySemitones(
      pitched.map((frame) => frame.pitchHz as number)
    );
    const meanPitchConfidence = mean(
      pitched.map((frame) => frame.pitchConfidence ?? 1)
    );
    measurements.push(
      measurement(
        window,
        "prototype.speech.pitch_center",
        "Pitch center",
        median(pitched.map((frame) => frame.pitchHz as number)),
        "hertz",
        Math.min(
          1,
          0.3 * snrScore +
            0.2 * durationScore +
            0.2 * pitchCoverage +
            0.15 * meanPitchConfidence +
            0.15 * clippingScore
        )
      ),
      measurement(
        window,
        "prototype.speech.pitch_variability",
        "Pitch variability",
        pitchVariability,
        "semitone-stddev",
        Math.min(
          1,
          0.3 * snrScore +
            0.2 * durationScore +
            0.2 * pitchCoverage +
            0.15 * meanPitchConfidence +
            0.15 * clippingScore
        )
      )
    );
  }

  return measurements;
}
