import type { FaceLandmarkFrame } from "./primitives.js";
import type { Abstention, MeasurableWindow, Measurement } from "@neurotrax/contracts";
import { mean } from "./stats.js";

export const FACIAL_EXPRESSIVITY_VERSION = "facial-expressivity-0.2";
export const FACE_FRAMING_FLOOR = 0.6;
export const BLINK_EAR_THRESHOLD = 0.2;
const MIN_VISIBLE_FRAMES = 3;

function countBlinks(frames: FaceLandmarkFrame[]): number {
  let blinks = 0;
  let inBlink = false;
  for (const f of frames) {
    if (f.eyeAspectRatio < BLINK_EAR_THRESHOLD && !inBlink) {
      blinks += 1;
      inBlink = true;
    } else if (f.eyeAspectRatio >= BLINK_EAR_THRESHOLD) {
      inBlink = false;
    }
  }
  return blinks;
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
    algorithmVersion: FACIAL_EXPRESSIVITY_VERSION,
    clinicalValidation: "none",
    contextRef: window.windowId,
    windowStartMs: window.startMs,
    windowEndMs: window.endMs,
    evidenceSnippetRef: null
  };
}

export function extractFacialExpressivity(
  window: MeasurableWindow,
  frames: FaceLandmarkFrame[]
): Measurement[] | Abstention {
  const abstain = (reasonCode: string, detail: string): Abstention => ({
    modality: "face",
    windowStartMs: window.startMs,
    windowEndMs: window.endMs,
    reasonCode,
    detail
  });

  const visible = frames.filter((f) => f.faceVisible);
  if (visible.length < MIN_VISIBLE_FRAMES) {
    return abstain(
      "face-not-visible",
      `Window has ${visible.length} visible frames; ${MIN_VISIBLE_FRAMES} required.`
    );
  }
  const meanFraming = mean(frames.map((f) => f.framingFraction));
  if (meanFraming < FACE_FRAMING_FLOOR) {
    return abstain(
      "face-not-framed",
      `Mean framing ${meanFraming.toFixed(2)} below the ${FACE_FRAMING_FLOOR} floor.`
    );
  }

  const confidence = Math.min(1, meanFraming);
  const expressivity = mean(frames.map((f) => f.landmarkMotion));
  const durationMinutes = Math.max(1, window.endMs - window.startMs) / 60000;
  const blinkRate = countBlinks(frames) / durationMinutes;
  const brows = frames.map((f) => f.browRaise);
  const browAmplitude = Math.max(...brows) - Math.min(...brows);

  return [
    measurement(window, "prototype.face.expressivity", "Facial expressivity", expressivity, "motion-index", confidence),
    measurement(window, "prototype.face.blink_rate", "Blink rate", blinkRate, "blinks-per-minute", confidence),
    measurement(window, "prototype.face.brow_amplitude", "Brow amplitude", browAmplitude, "normalized-range", confidence)
  ];
}
