import type {
  Abstention,
  Measurement,
  MeasurementContextKind,
  MeasurableWindow
} from "@phenometric/contracts";
import type {
  FacialKinematicsFrameV1,
  NormalizedPoint
} from "./primitives.js";
import {
  median,
  medianAbsoluteDeviation,
  percentile
} from "./stats.js";

export const FACIAL_KINEMATICS_VERSION = "facial-task-kinematics-1.0";
export const SMILE_ADHERENCE_FLOOR = 0.02;
export const EYE_CLOSURE_ADHERENCE_FLOOR = 0.2;
export const EYE_RECOVERY_CLOSURE_CEILING = 0.1;
const MIN_NUMERIC_FRAMES = 3;

const SMILE_CODES = [
  "prototype.face.smile_excursion.left",
  "prototype.face.smile_excursion.right",
  "prototype.face.smile_excursion.asymmetry"
] as const;

const EYE_CLOSURE_CODES = [
  "prototype.face.eye_closure_fraction.left",
  "prototype.face.eye_closure_fraction.right",
  "prototype.face.eye_closure_fraction.asymmetry"
] as const;

export interface FacialExtractionResult {
  measurements: Measurement[];
  abstentions: Abstention[];
}

export type FacialSide = "left" | "right";

export interface NeutralFacialBaseline {
  processorRef: string | null;
  sourceFrameCount: number;
  mouthCorners: Record<FacialSide, NormalizedPoint | null>;
  eyeAperture: Record<FacialSide, number | null>;
}

export interface SmileAdherenceEvaluation {
  observed: boolean;
  processorCompatible: boolean;
  adherent: Record<FacialSide, boolean>;
  excursions: Record<FacialSide, number | null>;
  excursionSamples: Record<FacialSide, number[]>;
  pairedAsymmetrySamples: number[];
}

export interface EyeClosureAdherenceEvaluation {
  observed: boolean;
  processorCompatible: boolean;
  closed: Record<FacialSide, boolean>;
  recovered: Record<FacialSide, boolean>;
  closureFractions: Record<FacialSide, number | null>;
  closureFractionSamples: Record<FacialSide, number[]>;
  pairedAsymmetrySamples: number[];
}

const SIDES = ["left", "right"] as const;
const ADHERENCE_EPSILON = 1e-12;

interface TimedFacialSample {
  tMs: number;
  value: number;
}

/**
 * Treat each observation as the value held until the next observation. This
 * keeps task percentiles tied to elapsed evidence rather than to however many
 * frames the camera happened to deliver during one part of the interval.
 */
function timeWeightedPercentile(
  samples: readonly TimedFacialSample[],
  probability: number
): number {
  const ordered = samples
    .filter((sample) => finite(sample.tMs) && finite(sample.value))
    .sort((left, right) => left.tMs - right.tMs);
  const fallback = ordered.map((sample) => sample.value);
  if (ordered.length < 2) return percentile(fallback, probability);

  const weighted = ordered.flatMap((sample, index) => {
    const next = ordered[index + 1];
    if (!next) return [];
    const weight = next.tMs - sample.tMs;
    return weight > 0 ? [{ value: sample.value, weight }] : [];
  });
  const totalWeight = weighted.reduce(
    (total, sample) => total + sample.weight,
    0
  );
  if (totalWeight <= 0) return percentile(fallback, probability);

  weighted.sort((left, right) => left.value - right.value);
  const targetWeight = probability * totalWeight;
  let cumulativeWeight = 0;
  for (const sample of weighted) {
    cumulativeWeight += sample.weight;
    if (cumulativeWeight + ADHERENCE_EPSILON >= targetWeight) {
      return sample.value;
    }
  }
  return weighted.at(-1)?.value ?? percentile(fallback, probability);
}

function framesForWindow(
  frames: FacialKinematicsFrameV1[],
  window: MeasurableWindow
): FacialKinematicsFrameV1[] {
  return frames.filter(
    (frame) =>
      frame.tMs >= window.startMs &&
      frame.tMs <= window.endMs
  );
}

function finite(value: number): boolean {
  return Number.isFinite(value);
}

function finitePoint(point: NormalizedPoint): boolean {
  return finite(point.x) && finite(point.y);
}

function meetsFloor(value: number | null, floor: number): boolean {
  return value !== null && value + ADHERENCE_EPSILON >= floor;
}

function meetsCeiling(value: number | null, ceiling: number): boolean {
  return value !== null && value <= ceiling + ADHERENCE_EPSILON;
}

function medianPoint(
  frames: FacialKinematicsFrameV1[],
  side: FacialSide
): NormalizedPoint | null {
  const points = frames.flatMap((frame) => {
    const point = frame.mouthCorners?.[side];
    return point && finitePoint(point) ? [point] : [];
  });
  if (points.length < MIN_NUMERIC_FRAMES) return null;
  return {
    x: median(points.map((point) => point.x)),
    y: median(points.map((point) => point.y))
  };
}

function medianEyeAperture(
  frames: FacialKinematicsFrameV1[],
  side: FacialSide
): number | null {
  const values = frames.flatMap((frame) => {
    const value = frame.eyeAperture?.[side];
    return value !== undefined && finite(value) && value > 0 ? [value] : [];
  });
  return values.length < MIN_NUMERIC_FRAMES ? null : median(values);
}

/**
 * Builds the task-independent neutral reference used by both live guidance and
 * final facial measurement. Inputs are expected to be one accepted, usable
 * neutral interval; mixed processors deliberately produce an unusable
 * processor reference instead of silently combining model outputs.
 */
export function createNeutralFacialBaseline(
  frames: readonly FacialKinematicsFrameV1[]
): NeutralFacialBaseline {
  const mutableFrames = [...frames];
  const processorRefs = new Set(
    mutableFrames.map((frame) => frame.processorRef)
  );
  return {
    processorRef:
      processorRefs.size === 1
        ? mutableFrames[0]?.processorRef ?? null
        : null,
    sourceFrameCount: mutableFrames.length,
    mouthCorners: {
      left: medianPoint(mutableFrames, "left"),
      right: medianPoint(mutableFrames, "right")
    },
    eyeAperture: {
      left: medianEyeAperture(mutableFrames, "left"),
      right: medianEyeAperture(mutableFrames, "right")
    }
  };
}

function framesMatchBaselineProcessor(
  baseline: NeutralFacialBaseline,
  frames: readonly FacialKinematicsFrameV1[]
): boolean {
  return (
    baseline.processorRef !== null &&
    frames.length > 0 &&
    frames.every((frame) => frame.processorRef === baseline.processorRef)
  );
}

/**
 * Evaluates the existing 0.02 inter-eye-normalized smile criterion. Passing a
 * single frame supports live gating; passing a task interval returns the same
 * time-weighted 90th-percentile values consumed by final extraction.
 */
export function evaluateSmileAdherence(
  baseline: NeutralFacialBaseline,
  frames: readonly FacialKinematicsFrameV1[]
): SmileAdherenceEvaluation {
  const processorCompatible = framesMatchBaselineProcessor(baseline, frames);
  const samples: Record<FacialSide, number[]> = {
    left: [],
    right: []
  };
  const timedSamples: Record<FacialSide, TimedFacialSample[]> = {
    left: [],
    right: []
  };
  const pairedAsymmetrySamples: number[] = [];

  if (processorCompatible) {
    for (const frame of frames) {
      const perFrame: Partial<Record<FacialSide, number>> = {};
      for (const side of SIDES) {
        const point = frame.mouthCorners?.[side];
        const center = baseline.mouthCorners[side];
        if (!point || !center || !finitePoint(point)) continue;
        const value = Math.hypot(point.x - center.x, point.y - center.y);
        if (!finite(value)) continue;
        samples[side].push(value);
        timedSamples[side].push({ tMs: frame.tMs, value });
        perFrame[side] = value;
      }
      if (perFrame.left !== undefined && perFrame.right !== undefined) {
        pairedAsymmetrySamples.push(
          Math.abs(perFrame.left - perFrame.right)
        );
      }
    }
  }

  const excursions = {
    left:
      timedSamples.left.length > 0
        ? timeWeightedPercentile(timedSamples.left, 0.9)
        : null,
    right:
      timedSamples.right.length > 0
        ? timeWeightedPercentile(timedSamples.right, 0.9)
        : null
  };
  const adherent = {
    left: meetsFloor(excursions.left, SMILE_ADHERENCE_FLOOR),
    right: meetsFloor(excursions.right, SMILE_ADHERENCE_FLOOR)
  };
  return {
    observed: adherent.left || adherent.right,
    processorCompatible,
    adherent,
    excursions,
    excursionSamples: samples,
    pairedAsymmetrySamples
  };
}

function closureFraction(aperture: number, openAperture: number): number {
  return Math.max(0, Math.min(1, 1 - aperture / openAperture));
}

/**
 * Evaluates the existing 20% neutral-referenced aperture reduction. As with
 * smile adherence, this accepts one live frame or a complete accepted interval.
 */
export function evaluateEyeClosureAdherence(
  baseline: NeutralFacialBaseline,
  frames: readonly FacialKinematicsFrameV1[]
): EyeClosureAdherenceEvaluation {
  const processorCompatible = framesMatchBaselineProcessor(baseline, frames);
  const samples: Record<FacialSide, number[]> = {
    left: [],
    right: []
  };
  const timedSamples: Record<FacialSide, TimedFacialSample[]> = {
    left: [],
    right: []
  };
  const pairedAsymmetrySamples: number[] = [];

  if (processorCompatible) {
    for (const frame of frames) {
      const perFrame: Partial<Record<FacialSide, number>> = {};
      for (const side of SIDES) {
        const aperture = frame.eyeAperture?.[side];
        const openAperture = baseline.eyeAperture[side];
        if (
          aperture === undefined ||
          !finite(aperture) ||
          aperture < 0 ||
          openAperture === null
        ) {
          continue;
        }
        const value = closureFraction(aperture, openAperture);
        samples[side].push(value);
        timedSamples[side].push({ tMs: frame.tMs, value });
        perFrame[side] = value;
      }
      if (perFrame.left !== undefined && perFrame.right !== undefined) {
        pairedAsymmetrySamples.push(
          Math.abs(perFrame.left - perFrame.right)
        );
      }
    }
  }

  const closureFractions = {
    left:
      timedSamples.left.length > 0
        ? timeWeightedPercentile(timedSamples.left, 0.9)
        : null,
    right:
      timedSamples.right.length > 0
        ? timeWeightedPercentile(timedSamples.right, 0.9)
        : null
  };
  const closed = {
    left: meetsFloor(
      closureFractions.left,
      EYE_CLOSURE_ADHERENCE_FLOOR
    ),
    right: meetsFloor(
      closureFractions.right,
      EYE_CLOSURE_ADHERENCE_FLOOR
    )
  };
  const recovered = {
    left:
      processorCompatible &&
      meetsCeiling(
        closureFractions.left,
        EYE_RECOVERY_CLOSURE_CEILING
      ),
    right:
      processorCompatible &&
      meetsCeiling(
        closureFractions.right,
        EYE_RECOVERY_CLOSURE_CEILING
      )
  };
  return {
    observed: closed.left || closed.right,
    processorCompatible,
    closed,
    recovered,
    closureFractions,
    closureFractionSamples: samples,
    pairedAsymmetrySamples
  };
}

function confidenceFor(
  window: MeasurableWindow,
  frameCount: number
): number {
  const expectedAtCadence = Math.max(
    MIN_NUMERIC_FRAMES,
    ((window.endMs - window.startMs) / 1_000) * 20
  );
  return Math.min(1, frameCount / expectedAtCadence);
}

function measurement(
  window: MeasurableWindow,
  neutralWindow: MeasurableWindow,
  input: {
    code: string;
    label: string;
    value: number;
    unit: string;
    uncertaintyValues: number[];
    confidence: number;
    processorRef: string;
  }
): Measurement {
  return {
    code: input.code,
    label: input.label,
    value: input.value,
    unit: input.unit,
    confidence: input.confidence,
    uncertainty: {
      kind: "estimated",
      method: "median-absolute-deviation",
      value: medianAbsoluteDeviation(input.uncertaintyValues),
      unit: input.unit
    },
    algorithmVersion: FACIAL_KINEMATICS_VERSION,
    processorRef: input.processorRef,
    clinicalValidation: "none",
    contextRef: window.windowId,
    sourceWindowRefs: [neutralWindow.windowId, window.windowId],
    windowStartMs: window.startMs,
    windowEndMs: window.endMs,
    evidenceSnippetRef: null
  };
}

function abstention(
  window: MeasurableWindow,
  reasonCode: string,
  detail: string,
  measurementCodes: readonly string[],
  neutralWindow?: MeasurableWindow,
  processorRef?: string
): Abstention {
  return {
    modality: "face",
    windowStartMs: window.startMs,
    windowEndMs: window.endMs,
    reasonCode,
    detail,
    contextKind: window.context.kind,
    measurementCodes: [...measurementCodes],
    sourceWindowRefs: neutralWindow
      ? [neutralWindow.windowId, window.windowId]
      : [window.windowId],
    processorRef
  };
}

function longestWindow(
  windows: MeasurableWindow[],
  kind: MeasurementContextKind
): MeasurableWindow | null {
  return (
    windows
      .filter(
        (window) => window.modality === "face" && window.context.kind === kind
      )
      .sort(
        (left, right) =>
          right.endMs -
            right.startMs -
            (left.endMs - left.startMs) ||
          left.startMs - right.startMs
      )[0] ?? null
  );
}

function taskWindows(
  windows: MeasurableWindow[],
  kind: "smile" | "eye-closure"
): MeasurableWindow[] {
  return windows.filter(
    (window) => window.modality === "face" && window.context.kind === kind
  );
}

function taskAbsentAbstention(
  frames: FacialKinematicsFrameV1[],
  kind: "smile" | "eye-closure",
  codes: readonly string[]
): Abstention | null {
  const taskFrames = frames.filter((frame) => frame.taskContext === kind);
  if (taskFrames.length === 0) return null;
  return {
    modality: "face",
    windowStartMs: taskFrames[0].tMs,
    windowEndMs: taskFrames.at(-1)?.tMs ?? taskFrames[0].tMs,
    reasonCode: "insufficient-task-evidence",
    detail: `${kind} did not provide 1.5 seconds of usable visual evidence.`,
    contextKind: kind,
    measurementCodes: [...codes],
    sourceWindowRefs: [],
    processorRef: taskFrames[0].processorRef
  };
}

function extractSmileWindow(
  window: MeasurableWindow,
  neutralWindow: MeasurableWindow,
  neutralFrames: FacialKinematicsFrameV1[],
  activeFrames: FacialKinematicsFrameV1[]
): FacialExtractionResult {
  const processorRef = activeFrames[0]?.processorRef;
  const result: FacialExtractionResult = { measurements: [], abstentions: [] };
  const baseline = createNeutralFacialBaseline(neutralFrames);
  const evaluation = evaluateSmileAdherence(baseline, activeFrames);
  if (!processorRef || !evaluation.processorCompatible) {
    result.abstentions.push(
      abstention(
        window,
        "visual-processor-mismatch",
        "Neutral and smile evidence were produced by different visual processors.",
        SMILE_CODES,
        neutralWindow,
        processorRef
      )
    );
    return result;
  }

  const value = {
    left:
      evaluation.excursionSamples.left.length >= MIN_NUMERIC_FRAMES
        ? evaluation.excursions.left
        : null,
    right:
      evaluation.excursionSamples.right.length >= MIN_NUMERIC_FRAMES
        ? evaluation.excursions.right
        : null
  };
  if (!evaluation.observed) {
    result.abstentions.push(
      abstention(
        window,
        "smile-not-observed",
        "Neither mouth corner reached the 0.02 task-adherence displacement.",
        SMILE_CODES,
        neutralWindow,
        processorRef
      )
    );
    return result;
  }

  const confidence = confidenceFor(window, activeFrames.length);
  for (const side of SIDES) {
    if (value[side] === null) {
      result.abstentions.push(
        abstention(
          window,
          "invalid-facial-kinematics",
          `The ${side} smile excursion had fewer than ${MIN_NUMERIC_FRAMES} finite observations.`,
          [
            `prototype.face.smile_excursion.${side}`,
            "prototype.face.smile_excursion.asymmetry"
          ],
          neutralWindow,
          processorRef
        )
      );
      continue;
    }
    result.measurements.push(
      measurement(window, neutralWindow, {
        code: `prototype.face.smile_excursion.${side}`,
        label: `${side === "left" ? "Left" : "Right"} smile excursion`,
        value: value[side],
        unit: "inter-eye-normalized-distance",
        uncertaintyValues: evaluation.excursionSamples[side],
        confidence,
        processorRef
      })
    );
  }

  if (
    value.left !== null &&
    value.right !== null &&
    evaluation.pairedAsymmetrySamples.length >= MIN_NUMERIC_FRAMES
  ) {
    result.measurements.push(
      measurement(window, neutralWindow, {
        code: "prototype.face.smile_excursion.asymmetry",
        label: "Smile-excursion asymmetry",
        value: Math.abs(value.left - value.right),
        unit: "inter-eye-normalized-distance",
        uncertaintyValues: evaluation.pairedAsymmetrySamples,
        confidence,
        processorRef
      })
    );
  }
  return result;
}

function extractEyeClosureWindow(
  window: MeasurableWindow,
  neutralWindow: MeasurableWindow,
  neutralFrames: FacialKinematicsFrameV1[],
  activeFrames: FacialKinematicsFrameV1[]
): FacialExtractionResult {
  const processorRef = activeFrames[0]?.processorRef;
  const result: FacialExtractionResult = { measurements: [], abstentions: [] };
  const baseline = createNeutralFacialBaseline(neutralFrames);
  const evaluation = evaluateEyeClosureAdherence(
    baseline,
    activeFrames
  );
  if (!processorRef || !evaluation.processorCompatible) {
    result.abstentions.push(
      abstention(
        window,
        "visual-processor-mismatch",
        "Neutral and eye-closure evidence were produced by different visual processors.",
        EYE_CLOSURE_CODES,
        neutralWindow,
        processorRef
      )
    );
    return result;
  }

  const value = {
    left:
      evaluation.closureFractionSamples.left.length >= MIN_NUMERIC_FRAMES
        ? evaluation.closureFractions.left
        : null,
    right:
      evaluation.closureFractionSamples.right.length >= MIN_NUMERIC_FRAMES
        ? evaluation.closureFractions.right
        : null
  };
  if (!evaluation.observed) {
    result.abstentions.push(
      abstention(
        window,
        "eye-closure-not-observed",
        "Neither eye reached the 20% task-adherence aperture reduction.",
        EYE_CLOSURE_CODES,
        neutralWindow,
        processorRef
      )
    );
    return result;
  }

  const confidence = confidenceFor(window, activeFrames.length);
  for (const side of SIDES) {
    if (value[side] === null) {
      result.abstentions.push(
        abstention(
          window,
          "invalid-facial-kinematics",
          `The ${side} eye closure had fewer than ${MIN_NUMERIC_FRAMES} finite observations.`,
          [
            `prototype.face.eye_closure_fraction.${side}`,
            "prototype.face.eye_closure_fraction.asymmetry"
          ],
          neutralWindow,
          processorRef
        )
      );
      continue;
    }
    result.measurements.push(
      measurement(window, neutralWindow, {
        code: `prototype.face.eye_closure_fraction.${side}`,
        label: `${side === "left" ? "Left" : "Right"} eye-closure fraction`,
        value: value[side],
        unit: "fraction",
        uncertaintyValues: evaluation.closureFractionSamples[side],
        confidence,
        processorRef
      })
    );
  }

  if (
    value.left !== null &&
    value.right !== null &&
    evaluation.pairedAsymmetrySamples.length >= MIN_NUMERIC_FRAMES
  ) {
    result.measurements.push(
      measurement(window, neutralWindow, {
        code: "prototype.face.eye_closure_fraction.asymmetry",
        label: "Eye-closure fraction asymmetry",
        value: Math.abs(value.left - value.right),
        unit: "fraction",
        uncertaintyValues: evaluation.pairedAsymmetrySamples,
        confidence,
        processorRef
      })
    );
  }
  return result;
}

export function extractFacialTaskMeasurements(
  windows: MeasurableWindow[],
  frames: FacialKinematicsFrameV1[]
): FacialExtractionResult {
  const result: FacialExtractionResult = { measurements: [], abstentions: [] };
  const neutralWindow = longestWindow(windows, "neutral-face");
  const smileWindows = taskWindows(windows, "smile");
  const eyeClosureWindows = taskWindows(windows, "eye-closure");

  if (!neutralWindow) {
    for (const window of [...smileWindows, ...eyeClosureWindows]) {
      const codes =
        window.context.kind === "smile" ? SMILE_CODES : EYE_CLOSURE_CODES;
      result.abstentions.push(
        abstention(
          window,
          "missing-neutral-baseline",
          "Task measurement requires a usable neutral-face baseline.",
          codes,
          undefined,
          framesForWindow(frames, window)[0]?.processorRef
        )
      );
    }
    for (const [kind, codes] of [
      ["smile", SMILE_CODES],
      ["eye-closure", EYE_CLOSURE_CODES]
    ] as const) {
      if (taskWindows(windows, kind).length > 0) continue;
      const missing = taskAbsentAbstention(frames, kind, codes);
      if (missing) result.abstentions.push(missing);
    }
    return result;
  }

  const neutralFrames = framesForWindow(frames, neutralWindow);
  for (const window of smileWindows) {
    const extracted = extractSmileWindow(
      window,
      neutralWindow,
      neutralFrames,
      framesForWindow(frames, window)
    );
    result.measurements.push(...extracted.measurements);
    result.abstentions.push(...extracted.abstentions);
  }
  for (const window of eyeClosureWindows) {
    const extracted = extractEyeClosureWindow(
      window,
      neutralWindow,
      neutralFrames,
      framesForWindow(frames, window)
    );
    result.measurements.push(...extracted.measurements);
    result.abstentions.push(...extracted.abstentions);
  }

  if (smileWindows.length === 0) {
    const missing = taskAbsentAbstention(frames, "smile", SMILE_CODES);
    if (missing) result.abstentions.push(missing);
  }
  if (eyeClosureWindows.length === 0) {
    const missing = taskAbsentAbstention(
      frames,
      "eye-closure",
      EYE_CLOSURE_CODES
    );
    if (missing) result.abstentions.push(missing);
  }

  return result;
}
