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

type Side = "left" | "right";

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

function medianPoint(
  frames: FacialKinematicsFrameV1[],
  side: Side
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
  side: Side
): number | null {
  const values = frames.flatMap((frame) => {
    const value = frame.eyeAperture?.[side];
    return value !== undefined && finite(value) && value > 0 ? [value] : [];
  });
  return values.length < MIN_NUMERIC_FRAMES ? null : median(values);
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
  if (!processorRef || neutralFrames[0]?.processorRef !== processorRef) {
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

  const baseline = {
    left: medianPoint(neutralFrames, "left"),
    right: medianPoint(neutralFrames, "right")
  };
  const excursions: Record<Side, number[]> = { left: [], right: [] };
  const pairedAsymmetry: number[] = [];
  for (const frame of activeFrames) {
    const perFrame: Partial<Record<Side, number>> = {};
    for (const side of ["left", "right"] as const) {
      const point = frame.mouthCorners?.[side];
      const center = baseline[side];
      if (!point || !center || !finitePoint(point)) continue;
      const value = Math.hypot(point.x - center.x, point.y - center.y);
      if (!finite(value)) continue;
      excursions[side].push(value);
      perFrame[side] = value;
    }
    if (perFrame.left !== undefined && perFrame.right !== undefined) {
      pairedAsymmetry.push(Math.abs(perFrame.left - perFrame.right));
    }
  }

  const value = {
    left:
      excursions.left.length >= MIN_NUMERIC_FRAMES
        ? percentile(excursions.left, 0.9)
        : null,
    right:
      excursions.right.length >= MIN_NUMERIC_FRAMES
        ? percentile(excursions.right, 0.9)
        : null
  };
  if (
    Math.max(value.left ?? 0, value.right ?? 0) <
    SMILE_ADHERENCE_FLOOR
  ) {
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
  for (const side of ["left", "right"] as const) {
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
        uncertaintyValues: excursions[side],
        confidence,
        processorRef
      })
    );
  }

  if (
    value.left !== null &&
    value.right !== null &&
    pairedAsymmetry.length >= MIN_NUMERIC_FRAMES
  ) {
    result.measurements.push(
      measurement(window, neutralWindow, {
        code: "prototype.face.smile_excursion.asymmetry",
        label: "Smile-excursion asymmetry",
        value: Math.abs(value.left - value.right),
        unit: "inter-eye-normalized-distance",
        uncertaintyValues: pairedAsymmetry,
        confidence,
        processorRef
      })
    );
  }
  return result;
}

function closureFraction(aperture: number, openAperture: number): number {
  return Math.max(0, Math.min(1, 1 - aperture / openAperture));
}

function extractEyeClosureWindow(
  window: MeasurableWindow,
  neutralWindow: MeasurableWindow,
  neutralFrames: FacialKinematicsFrameV1[],
  activeFrames: FacialKinematicsFrameV1[]
): FacialExtractionResult {
  const processorRef = activeFrames[0]?.processorRef;
  const result: FacialExtractionResult = { measurements: [], abstentions: [] };
  if (!processorRef || neutralFrames[0]?.processorRef !== processorRef) {
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

  const open = {
    left: medianEyeAperture(neutralFrames, "left"),
    right: medianEyeAperture(neutralFrames, "right")
  };
  const fractions: Record<Side, number[]> = { left: [], right: [] };
  const pairedAsymmetry: number[] = [];
  for (const frame of activeFrames) {
    const perFrame: Partial<Record<Side, number>> = {};
    for (const side of ["left", "right"] as const) {
      const aperture = frame.eyeAperture?.[side];
      const openAperture = open[side];
      if (
        aperture === undefined ||
        !finite(aperture) ||
        aperture < 0 ||
        openAperture === null
      ) {
        continue;
      }
      const value = closureFraction(aperture, openAperture);
      fractions[side].push(value);
      perFrame[side] = value;
    }
    if (perFrame.left !== undefined && perFrame.right !== undefined) {
      pairedAsymmetry.push(Math.abs(perFrame.left - perFrame.right));
    }
  }

  const value = {
    left:
      fractions.left.length >= MIN_NUMERIC_FRAMES
        ? percentile(fractions.left, 0.9)
        : null,
    right:
      fractions.right.length >= MIN_NUMERIC_FRAMES
        ? percentile(fractions.right, 0.9)
        : null
  };
  if (
    Math.max(value.left ?? 0, value.right ?? 0) <
    EYE_CLOSURE_ADHERENCE_FLOOR
  ) {
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
  for (const side of ["left", "right"] as const) {
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
        uncertaintyValues: fractions[side],
        confidence,
        processorRef
      })
    );
  }

  if (
    value.left !== null &&
    value.right !== null &&
    pairedAsymmetry.length >= MIN_NUMERIC_FRAMES
  ) {
    result.measurements.push(
      measurement(window, neutralWindow, {
        code: "prototype.face.eye_closure_fraction.asymmetry",
        label: "Eye-closure fraction asymmetry",
        value: Math.abs(value.left - value.right),
        unit: "fraction",
        uncertaintyValues: pairedAsymmetry,
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
