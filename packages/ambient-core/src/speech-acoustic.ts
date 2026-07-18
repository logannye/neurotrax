import type { AudioFeatureFrame } from "./primitives.js";
import type { Abstention, MeasurableWindow, Measurement } from "@neurotrax/contracts";
import { mean, stdDev } from "./stats.js";

export const SPEECH_ACOUSTIC_VERSION = "speech-acoustic-0.1";
export const SPEECH_SNR_FLOOR_DB = 12;
const MIN_VOICED_FRAMES = 3;

function countPauses(frames: AudioFeatureFrame[]): number {
  let pauses = 0;
  let inPause = false;
  for (const f of frames) {
    if (!f.voiced && !inPause) {
      pauses += 1;
      inPause = true;
    } else if (f.voiced) {
      inPause = false;
    }
  }
  return pauses;
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
  const articulationRate = voiced.length / frames.length;
  const pauseCount = countPauses(frames);
  const pitchVariability = stdDev(
    voiced.map((f) => f.pitchHz).filter((p): p is number => p !== null)
  );

  return [
    measurement(window, "prototype.speech.articulation_rate", "Articulation rate", articulationRate, "voiced-fraction", confidence),
    measurement(window, "prototype.speech.pause_count", "Pause count", pauseCount, "count", confidence),
    measurement(window, "prototype.speech.pitch_variability", "Pitch variability", pitchVariability, "hz-stddev", confidence)
  ];
}
