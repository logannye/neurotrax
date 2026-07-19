import type {
  Abstention,
  EncounterObservation,
  EventEnvelope,
  CaptureQualityPolicy,
  Measurement,
  MeasurementContext,
  MeasurableWindow,
  Modality
} from "@phenometric/contracts";
import type {
  AudioFeatureFrame,
  FaceLandmarkFrame,
  FrameStream
} from "./primitives.js";
import { detectMeasurableWindows, MAX_SPEECH_PAUSE_MS } from "./windowing.js";
import {
  extractSpeechAcoustic,
  SPEECH_ACOUSTIC_VERSION
} from "./speech-acoustic.js";
import { extractFacialExpressivity, FACE_FRAMING_FLOOR } from "./facial-expressivity.js";
import { aggregateMeasurements } from "./aggregate.js";
import { createEventFactory, type EventFactory } from "./events.js";

const LABELS = new Map<string, { label: string; unit: string }>([
  ["prototype.speech.voiced_time_fraction", { label: "Voiced-time fraction", unit: "ratio" }],
  ["prototype.speech.pause_rate", { label: "Pause rate", unit: "pauses-per-minute" }],
  ["prototype.speech.onset_latency", { label: "Speech initiation latency", unit: "seconds" }],
  ["prototype.speech.pitch_center", { label: "Pitch center", unit: "hertz" }],
  ["prototype.speech.pitch_variability", { label: "Pitch variability", unit: "semitone-stddev" }],
  ["prototype.face.expressivity", { label: "Facial movement", unit: "motion-index" }],
  ["prototype.face.blink_rate", { label: "Blink rate", unit: "blinks-per-minute" }],
  ["prototype.face.brow_amplitude", { label: "Brow amplitude", unit: "normalized-range" }],
  ["prototype.face.mouth_amplitude", { label: "Mouth aperture range", unit: "normalized-range" }],
  ["prototype.face.eye_aperture_range", { label: "Eye aperture range", unit: "normalized-range" }]
]);

const FACE_QUALITY_DEBOUNCE_MS = 750;
const SPEECH_OPEN_DEBOUNCE_MS = 300;
export const MAX_FACE_YAW_DEGREES = 30;

export const DEFAULT_CAPTURE_QUALITY_POLICY: CaptureQualityPolicy = {
  id: "guided-live-v0.1",
  speechOpenDebounceMs: SPEECH_OPEN_DEBOUNCE_MS,
  maximumSpeechPauseMs: MAX_SPEECH_PAUSE_MS,
  faceQualityDebounceMs: FACE_QUALITY_DEBOUNCE_MS,
  faceFramingFloor: FACE_FRAMING_FLOOR,
  maximumFaceYawDegrees: MAX_FACE_YAW_DEGREES
};

type LaneQuality = "unknown" | "measurable" | "withheld";

interface LaneState {
  quality: LaneQuality;
  candidateSinceMs: number | null;
  adverseSinceMs: number | null;
  lastGoodMs: number | null;
  withheldSinceMs: number | null;
  withheldReasonCode: string | null;
  windowIndex: number;
  openWindowId: string | null;
}

export interface ConductorSession {
  ingestAudio(frame: AudioFeatureFrame): void;
  ingestFace(frame: FaceLandmarkFrame): void;
  complete(): { observation: EncounterObservation; events: EventEnvelope[] };
  getEvents(): EventEnvelope[];
}

export interface ConductorSessionOptions {
  baseTimeMs?: number;
  onEvent?: (event: EventEnvelope) => void;
  qualityPolicy?: CaptureQualityPolicy;
}

function slice<T extends { tMs: number }>(
  frames: T[],
  window: MeasurableWindow
): T[] {
  return frames.filter(
    (frame) => frame.tMs >= window.startMs && frame.tMs <= window.endMs
  );
}

function isAbstention(
  result: Measurement[] | Abstention
): result is Abstention {
  return !Array.isArray(result);
}

function processObservation(
  stream: FrameStream,
  factory: EventFactory,
  events: EventEnvelope[],
  emit: (event: EventEnvelope) => void,
  qualityTransitionCount: number,
  liveAbstentions: Abstention[]
): EncounterObservation {
  const measurements: Measurement[] = [];
  const abstentions: Abstention[] = [...liveAbstentions];
  const contextByWindowId = new Map<string, MeasurementContext>();
  const windows = detectMeasurableWindows(stream);

  for (const window of windows) {
    contextByWindowId.set(window.windowId, window.context);
    emit(
      factory.next(
        "capture-conductor",
        "capture.window.detected",
        "ambient-capture",
        `Curated a measurable ${window.modality} window.`,
        window.startMs,
        {
          windowId: window.windowId,
          modality: window.modality,
          contextKind: window.context.kind
        }
      )
    );

    const actorId =
      window.modality === "speech"
        ? "speech-acoustic"
        : "facial-expressivity";
    emit(
      factory.next(
        "capture-conductor",
        "extractor.routed",
        "ambient-capture",
        `Routed ${window.windowId} to ${actorId}.`,
        window.startMs,
        { windowId: window.windowId, extractor: actorId }
      )
    );

    const result: Measurement[] | Abstention =
      window.modality === "speech"
        ? extractSpeechAcoustic(
            window,
            slice(stream.audio as AudioFeatureFrame[], window)
          )
        : extractFacialExpressivity(
            window,
            slice(stream.face as FaceLandmarkFrame[], window)
          );

    if (isAbstention(result)) {
      abstentions.push(result);
      emit(
        factory.next(
          actorId,
          "measurement.abstained",
          "ambient-capture",
          `Withheld ${window.modality} measurement: ${result.reasonCode}.`,
          window.endMs,
          { windowId: window.windowId, reasonCode: result.reasonCode }
        )
      );
      continue;
    }

    for (const measurement of result) {
      measurements.push(measurement);
      emit(
        factory.next(
          actorId,
          "measurement.recorded",
          "ambient-capture",
          `Recorded ${measurement.label}.`,
          window.endMs,
          {
            windowId: window.windowId,
            code: measurement.code,
            value: measurement.value
          },
          [window.windowId]
        )
      );
    }
  }

  const firstSpeechWindow = windows.find(
    (window) => window.modality === "speech"
  );
  if (
    firstSpeechWindow &&
    measurements.some((measurement) =>
      measurement.code.startsWith("prototype.speech.")
    )
  ) {
    const onsetMeasurement: Measurement = {
      code: "prototype.speech.onset_latency",
      label: "Speech initiation latency",
      value: firstSpeechWindow.startMs / 1000,
      unit: "seconds",
      confidence: Math.min(
        1,
        Math.max(0, firstSpeechWindow.context.confounds.snrDb / 24)
      ),
      uncertainty: "placeholder",
      algorithmVersion: SPEECH_ACOUSTIC_VERSION,
      clinicalValidation: "none",
      contextRef: firstSpeechWindow.windowId,
      windowStartMs: 0,
      windowEndMs: firstSpeechWindow.startMs,
      evidenceSnippetRef: null
    };
    measurements.push(onsetMeasurement);
    emit(
      factory.next(
        "speech-acoustic",
        "measurement.recorded",
        "ambient-capture",
        "Recorded speech initiation latency.",
        firstSpeechWindow.startMs,
        {
          windowId: firstSpeechWindow.windowId,
          code: onsetMeasurement.code,
          value: onsetMeasurement.value
        },
        [firstSpeechWindow.windowId]
      )
    );
  }

  const aggregates = aggregateMeasurements(
    measurements,
    contextByWindowId,
    LABELS
  );
  const occurredAt =
    stream.occurredAt ??
    new Date(
      events.length > 0 ? Date.parse(events[0].occurredAt) : 0
    ).toISOString();
  const observation: EncounterObservation = {
    containsPHI: stream.containsPHI,
    captureMode: stream.captureMode,
    visitId: stream.visitId,
    participantId: stream.participantId,
    occurredAt,
    captureAdapter: stream.captureAdapter ?? {
      id: "fixture-replay",
      version: "0.2.0"
    },
    windows,
    measurements,
    aggregates,
    abstentions,
    measurementCount: measurements.length,
    qualitySummary: {
      speechWindowCount: windows.filter(
        (window) => window.modality === "speech"
      ).length,
      faceWindowCount: windows.filter((window) => window.modality === "face")
        .length,
      abstentionCount: abstentions.length,
      qualityTransitionCount,
      audioFrameCount: stream.audio.length,
      speechActiveFrameCount: stream.audio.filter((frame) => frame.voiced)
        .length,
      pitchedFrameCount: stream.audio.filter(
        (frame) =>
          frame.pitchHz !== null && (frame.pitchConfidence ?? 1) >= 0.55
      ).length,
      pitchCoverage:
        stream.audio.filter((frame) => frame.voiced).length === 0
          ? 0
          : stream.audio.filter(
                (frame) =>
                  frame.voiced &&
                  frame.pitchHz !== null &&
                  (frame.pitchConfidence ?? 1) >= 0.55
              ).length /
            stream.audio.filter((frame) => frame.voiced).length,
      faceFrameCount: stream.face.length,
      usableFaceFrameCount: stream.face.filter(
        (frame) =>
          frame.faceVisible &&
          frame.framingFraction >= FACE_FRAMING_FLOOR &&
          Math.abs(frame.yawDegrees ?? 0) <= MAX_FACE_YAW_DEGREES
      ).length,
      usableFaceFraction:
        stream.face.length === 0
          ? 0
          : stream.face.filter(
                (frame) =>
                  frame.faceVisible &&
                  frame.framingFraction >= FACE_FRAMING_FLOOR &&
                  Math.abs(frame.yawDegrees ?? 0) <= MAX_FACE_YAW_DEGREES
              ).length / stream.face.length,
      faceWithholdingDurationMs: abstentions
        .filter((abstention) => abstention.modality === "face")
        .reduce(
          (total, abstention) =>
            total + Math.max(0, abstention.windowEndMs - abstention.windowStartMs),
          0
        ),
      faceRecoveryObserved:
        windows.filter((window) => window.modality === "face").length >= 2 &&
        abstentions.some((abstention) => abstention.modality === "face"),
      postRecoveryFaceWindowCount: Math.max(
        0,
        windows.filter((window) => window.modality === "face").length - 1
      )
    }
  };

  emit(
    factory.next(
      "capture-conductor",
      "encounter-observation.created",
      "ambient-capture",
      `Created a per-visit observation with ${aggregates.length} aggregates.`,
      windows.at(-1)?.endMs ?? 0,
      {
        visitId: stream.visitId,
        aggregateCount: aggregates.length,
        measurementCount: measurements.length
      },
      windows.map((window) => window.windowId)
    )
  );

  return observation;
}

function freshLaneState(): LaneState {
  return {
    quality: "unknown",
    candidateSinceMs: null,
    adverseSinceMs: null,
    lastGoodMs: null,
    withheldSinceMs: null,
    withheldReasonCode: null,
    windowIndex: 0,
    openWindowId: null
  };
}

export function createConductorSession(
  identity: Omit<FrameStream, "audio" | "face">,
  options: ConductorSessionOptions = {}
): ConductorSession {
  if (identity.containsPHI !== false) {
    throw new Error(
      "ambient-core accepts only streams explicitly marked containsPHI: false"
    );
  }

  const baseTimeMs =
    options.baseTimeMs ??
    (identity.occurredAt ? Date.parse(identity.occurredAt) : Date.now());
  const factory = createEventFactory({
    visitId: identity.visitId,
    participantId: identity.participantId,
    baseTimeMs
  });
  const events: EventEnvelope[] = [];
  const audio: AudioFeatureFrame[] = [];
  const face: FaceLandmarkFrame[] = [];
  const speechState = freshLaneState();
  const faceState = freshLaneState();
  const liveAbstentions: Abstention[] = [];
  const qualityPolicy =
    options.qualityPolicy ?? DEFAULT_CAPTURE_QUALITY_POLICY;
  let completed = false;
  let qualityTransitionCount = 0;

  const faceQualityReason = (
    frame: FaceLandmarkFrame
  ): string | null => {
    if (!frame.faceVisible) return "face-not-visible";
    if (
      Math.abs(frame.yawDegrees ?? 0) >
      qualityPolicy.maximumFaceYawDegrees
    ) {
      return "face-off-axis";
    }
    const faceCalibration = identity.calibration?.face;
    if (
      faceCalibration &&
      frame.faceBoxWidth !== undefined &&
      frame.faceBoxHeight !== undefined
    ) {
      const widthRatio =
        frame.faceBoxWidth /
        Math.max(0.001, faceCalibration.baselineBoxWidth);
      const heightRatio =
        frame.faceBoxHeight /
        Math.max(0.001, faceCalibration.baselineBoxHeight);
      if (widthRatio < 0.6 || heightRatio < 0.6) {
        return "face-too-small";
      }
      if (widthRatio > 1.7 || heightRatio > 1.7) {
        return "face-too-large";
      }
    }
    if (frame.edgeMargin !== undefined && frame.edgeMargin < 0.01) {
      return "face-off-center";
    }
    if (
      frame.illumination < 0.1 ||
      (faceCalibration &&
        Math.abs(
          frame.illumination - faceCalibration.baselineIllumination
        ) > 0.3)
    ) {
      return "illumination-out-of-range";
    }
    if (frame.framingFraction < qualityPolicy.faceFramingFloor) {
      return "face-not-framed";
    }
    return null;
  };

  const emit = (event: EventEnvelope): void => {
    events.push(event);
    options.onEvent?.(event);
  };

  const changeQuality = (
    modality: Modality,
    lane: LaneState,
    quality: Exclude<LaneQuality, "unknown">,
    atMs: number,
    reasonCode: string
  ): void => {
    if (lane.quality === quality) return;
    const priorQuality = lane.quality;
    if (
      quality === "measurable" &&
      priorQuality === "withheld" &&
      lane.withheldSinceMs !== null &&
      lane.withheldReasonCode
    ) {
      const abstention: Abstention = {
        modality,
        windowStartMs: lane.withheldSinceMs,
        windowEndMs: atMs,
        reasonCode: lane.withheldReasonCode,
        detail: `No ${modality} value was produced while capture quality was withheld.`
      };
      liveAbstentions.push(abstention);
      emit(
        factory.next(
          modality === "speech" ? "speech-acoustic" : "facial-expressivity",
          "measurement.abstained",
          "ambient-capture",
          `Preserved a ${modality} abstention: ${abstention.reasonCode}.`,
          atMs,
          {
            windowStartMs: abstention.windowStartMs,
            windowEndMs: abstention.windowEndMs,
            reasonCode: abstention.reasonCode
          }
        )
      );
      lane.withheldSinceMs = null;
      lane.withheldReasonCode = null;
    }
    if (quality === "withheld") {
      lane.withheldSinceMs = lane.adverseSinceMs ?? atMs;
      lane.withheldReasonCode = reasonCode;
    }
    lane.quality = quality;
    qualityTransitionCount += 1;
    emit(
      factory.next(
        modality === "speech" ? "speech-acoustic" : "facial-expressivity",
        "capture.quality.changed",
        "ambient-capture",
        quality === "measurable"
          ? `${modality === "speech" ? "Speech" : "Face"} signal is measurable.`
          : `${modality === "speech" ? "Speech" : "Face"} measurement withheld: ${reasonCode}.`,
        atMs,
        { modality, priorQuality, quality, reasonCode }
      )
    );
  };

  const openWindow = (
    modality: Modality,
    lane: LaneState,
    startMs: number
  ): void => {
    if (lane.openWindowId) return;
    lane.openWindowId = `${modality}-${lane.windowIndex}`;
    lane.windowIndex += 1;
    emit(
      factory.next(
        "capture-conductor",
        "capture.window.opened",
        "ambient-capture",
        `Opened a candidate ${modality} window.`,
        startMs,
        { modality, windowId: lane.openWindowId }
      )
    );
  };

  const closeWindow = (
    modality: Modality,
    lane: LaneState,
    endMs: number,
    reasonCode: string
  ): void => {
    if (!lane.openWindowId) return;
    const windowId = lane.openWindowId;
    lane.openWindowId = null;
    emit(
      factory.next(
        "capture-conductor",
        "capture.window.closed",
        "ambient-capture",
        `Closed candidate ${modality} window.`,
        endMs,
        { modality, windowId, reasonCode }
      )
    );
  };

  emit(
    factory.next(
      "capture-web",
      "consent.recorded",
      "ambient-capture",
      "Recorded consent for in-session audiovisual analysis.",
      0,
      { containsPHI: false, consentScope: "developer-self-assessment" }
    )
  );

  if (identity.calibration) {
    emit(
      factory.next(
        "capture-web",
        "device.preflight.passed",
        "ambient-capture",
        "Verified camera framing, room conditions, and speech signal.",
        0,
        {
          profileId: identity.calibration.profileId,
          calibratedAt: identity.calibration.calibratedAt,
          audio: identity.calibration.audio,
          face: identity.calibration.face
        }
      )
    );
  }

  emit(
    factory.next(
      "capture-conductor",
      "analysis.started",
      "ambient-capture",
      "Started ephemeral audiovisual analysis.",
      0,
      {
        captureMode: identity.captureMode,
        captureAdapter: identity.captureAdapter
      }
    )
  );

  return {
    ingestAudio(frame) {
      if (completed) throw new Error("Cannot ingest after session completion.");
      audio.push(frame);

      const usable = frame.voiced && !frame.clipped;
      if (usable) {
        speechState.lastGoodMs = frame.tMs;
        speechState.adverseSinceMs = null;
        speechState.candidateSinceMs ??= frame.tMs;
        if (
          frame.tMs - speechState.candidateSinceMs >=
          qualityPolicy.speechOpenDebounceMs
        ) {
          changeQuality(
            "speech",
            speechState,
            "measurable",
            frame.tMs,
            "voiced-signal-present"
          );
          openWindow("speech", speechState, speechState.candidateSinceMs);
        }
      } else {
        speechState.candidateSinceMs = null;
        speechState.adverseSinceMs ??= frame.tMs;
        if (
          speechState.openWindowId &&
          speechState.lastGoodMs !== null &&
          frame.tMs - speechState.lastGoodMs >
            qualityPolicy.maximumSpeechPauseMs
        ) {
          closeWindow(
            "speech",
            speechState,
            speechState.lastGoodMs,
            frame.clipped ? "audio-clipping" : "speech-pause"
          );
          changeQuality(
            "speech",
            speechState,
            "withheld",
            frame.tMs,
            frame.clipped ? "audio-clipping" : "no-voiced-signal"
          );
        }
      }
    },

    ingestFace(frame) {
      if (completed) throw new Error("Cannot ingest after session completion.");
      face.push(frame);

      const reasonCode = faceQualityReason(frame);
      const usable = reasonCode === null;
      if (usable) {
        faceState.lastGoodMs = frame.tMs;
        faceState.adverseSinceMs = null;
        faceState.candidateSinceMs ??= frame.tMs;
        if (
          frame.tMs - faceState.candidateSinceMs >=
          qualityPolicy.faceQualityDebounceMs
        ) {
          changeQuality(
            "face",
            faceState,
            "measurable",
            frame.tMs,
            "face-framed"
          );
          openWindow("face", faceState, faceState.candidateSinceMs);
        }
      } else {
        faceState.candidateSinceMs = null;
        faceState.adverseSinceMs ??= frame.tMs;
        if (
          frame.tMs - faceState.adverseSinceMs >=
          qualityPolicy.faceQualityDebounceMs
        ) {
          closeWindow(
            "face",
            faceState,
            faceState.lastGoodMs ?? frame.tMs,
            "face-not-measurable"
          );
          changeQuality(
            "face",
            faceState,
            "withheld",
            frame.tMs,
            reasonCode ?? "face-not-framed"
          );
        }
      }
    },

    complete() {
      if (completed) throw new Error("Session has already completed.");
      completed = true;
      const endMs = Math.max(
        audio.at(-1)?.tMs ?? 0,
        face.at(-1)?.tMs ?? 0
      );
      closeWindow("speech", speechState, endMs, "encounter-ended");
      closeWindow("face", faceState, endMs, "encounter-ended");
      for (const [modality, lane] of [
        ["speech", speechState],
        ["face", faceState]
      ] as const) {
        if (lane.withheldSinceMs === null || !lane.withheldReasonCode) continue;
        const abstention: Abstention = {
          modality,
          windowStartMs: lane.withheldSinceMs,
          windowEndMs: endMs,
          reasonCode: lane.withheldReasonCode,
          detail: `No ${modality} value was produced while capture quality was withheld.`
        };
        liveAbstentions.push(abstention);
        emit(
          factory.next(
            modality === "speech" ? "speech-acoustic" : "facial-expressivity",
            "measurement.abstained",
            "ambient-capture",
            `Preserved a ${modality} abstention: ${abstention.reasonCode}.`,
            endMs,
            {
              windowStartMs: abstention.windowStartMs,
              windowEndMs: abstention.windowEndMs,
              reasonCode: abstention.reasonCode
            }
          )
        );
        lane.withheldSinceMs = null;
        lane.withheldReasonCode = null;
      }
      emit(
        factory.next(
          "capture-conductor",
          "analysis.stopped",
          "ambient-capture",
          "Stopped ephemeral analysis and released the live stream.",
          endMs,
          {}
        )
      );

      const stream: FrameStream = { ...identity, audio, face };
      const observation = processObservation(
        stream,
        factory,
        events,
        emit,
        qualityTransitionCount,
        liveAbstentions
      );
      return { observation, events: [...events] };
    },

    getEvents() {
      return [...events];
    }
  };
}

export function runConductor(
  stream: FrameStream,
  options: { baseTimeMs?: number } = {}
): { observation: EncounterObservation; events: EventEnvelope[] } {
  const { audio, face, ...identity } = stream;
  const session = createConductorSession(identity, options);
  const frames = [
    ...audio.map((frame) => ({ modality: "audio" as const, frame })),
    ...face.map((frame) => ({ modality: "face" as const, frame }))
  ].sort(
    (left, right) =>
      left.frame.tMs - right.frame.tMs ||
      left.modality.localeCompare(right.modality)
  );

  for (const item of frames) {
    if (item.modality === "audio") session.ingestAudio(item.frame);
    else session.ingestFace(item.frame);
  }
  return session.complete();
}
