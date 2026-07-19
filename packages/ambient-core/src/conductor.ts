import type {
  Abstention,
  EncounterObservation,
  EventEnvelope,
  CaptureQualityPolicy,
  Measurement,
  MeasurementContext,
  MeasurableWindow,
  Modality,
  VisualQualityReasonCode,
  VisualTaskContext
} from "@phenometric/contracts";
import type {
  AudioFeatureFrame,
  FacialKinematicsFrameV1,
  FrameStream
} from "./primitives.js";
import { detectMeasurableWindows } from "./windowing.js";
import {
  extractSpeechAcoustic,
  SPEECH_ACOUSTIC_VERSION
} from "./speech-acoustic.js";
import { extractFacialTaskMeasurements } from "./facial-task.js";
import { aggregateMeasurements } from "./aggregate.js";
import { createEventFactory, type EventFactory } from "./events.js";
import {
  DEFAULT_CAPTURE_QUALITY_POLICY,
  evaluateVisualQuality
} from "./visual-quality.js";

const LABELS = new Map<string, { label: string; unit: string }>([
  ["prototype.speech.voiced_time_fraction", { label: "Voiced-time fraction", unit: "ratio" }],
  ["prototype.speech.pause_rate", { label: "Pause rate", unit: "pauses-per-minute" }],
  ["prototype.speech.onset_latency", { label: "Speech initiation latency", unit: "seconds" }],
  ["prototype.speech.pitch_center", { label: "Pitch center", unit: "hertz" }],
  ["prototype.speech.pitch_variability", { label: "Pitch variability", unit: "semitone-stddev" }],
  ["prototype.face.smile_excursion.left", { label: "Left smile excursion", unit: "inter-eye-normalized-distance" }],
  ["prototype.face.smile_excursion.right", { label: "Right smile excursion", unit: "inter-eye-normalized-distance" }],
  ["prototype.face.smile_excursion.asymmetry", { label: "Smile-excursion asymmetry", unit: "inter-eye-normalized-distance" }],
  ["prototype.face.eye_closure_fraction.left", { label: "Left eye-closure fraction", unit: "fraction" }],
  ["prototype.face.eye_closure_fraction.right", { label: "Right eye-closure fraction", unit: "fraction" }],
  ["prototype.face.eye_closure_fraction.asymmetry", { label: "Eye-closure fraction asymmetry", unit: "fraction" }]
]);

export const MAX_FACE_YAW_DEGREES =
  DEFAULT_CAPTURE_QUALITY_POLICY.maximumFaceYawDegrees;
export { DEFAULT_CAPTURE_QUALITY_POLICY };

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
  ingestFace(frame: FacialKinematicsFrameV1): void;
  ingestVisualWithholding(input: {
    tMs: number;
    reasonCode: VisualQualityReasonCode;
    taskContext: VisualTaskContext;
    processorRef?: string;
  }): void;
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
  liveAbstentions: Abstention[],
  faceSplitPointsMs: readonly number[]
): EncounterObservation {
  const measurements: Measurement[] = [];
  const abstentions: Abstention[] = [...liveAbstentions];
  const contextByWindowId = new Map<string, MeasurementContext>();
  const windows = detectMeasurableWindows(stream, {
    faceSplitPointsMs
  });

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

    if (window.modality === "face") continue;
    const result = extractSpeechAcoustic(
      window,
      slice(stream.audio, window)
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

  const faceResult = extractFacialTaskMeasurements(windows, stream.face);
  for (const facialAbstention of faceResult.abstentions) {
    abstentions.push(facialAbstention);
    emit(
      factory.next(
        "facial-expressivity",
        "measurement.abstained",
        "ambient-capture",
        `Withheld face measurement: ${facialAbstention.reasonCode}.`,
        facialAbstention.windowEndMs,
        {
          windowId: facialAbstention.sourceWindowRefs?.at(-1),
          reasonCode: facialAbstention.reasonCode,
          measurementCodes: facialAbstention.measurementCodes
        },
        facialAbstention.sourceWindowRefs ?? []
      )
    );
  }
  for (const measurement of faceResult.measurements) {
    measurements.push(measurement);
    emit(
      factory.next(
        "facial-expressivity",
        "measurement.recorded",
        "ambient-capture",
        `Recorded ${measurement.label}.`,
        measurement.windowEndMs,
        {
          windowId: measurement.contextRef,
          code: measurement.code,
          value: measurement.value
        },
        measurement.sourceWindowRefs
      )
    );
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
      confidence:
        firstSpeechWindow.context.confounds.kind === "speech"
          ? Math.min(
              1,
              Math.max(0, firstSpeechWindow.context.confounds.snrDb / 24)
            )
          : 0,
      uncertainty: {
        kind: "not-estimated",
        reason:
          "Speech uncertainty is not estimated by this prototype extractor."
      },
      algorithmVersion: SPEECH_ACOUSTIC_VERSION,
      processorRef: SPEECH_ACOUSTIC_VERSION,
      clinicalValidation: "none",
      contextRef: firstSpeechWindow.windowId,
      sourceWindowRefs: [firstSpeechWindow.windowId],
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
  const usableFaceFrameCount = stream.face.filter(
    (frame) =>
      evaluateVisualQuality(
        frame,
        stream.calibration?.face ?? null,
        DEFAULT_CAPTURE_QUALITY_POLICY
      ).usable
  ).length;
  const observation: EncounterObservation = {
    schemaVersion: "phenometric.encounter-observation.v1",
    containsPHI: stream.containsPHI,
    rawMediaRetained: false,
    nativeVisualObservationsRetained: false,
    captureMode: stream.captureMode,
    visitId: stream.visitId,
    participantId: stream.participantId,
    occurredAt,
    captureAdapter: stream.captureAdapter ?? {
      id: "fixture-replay",
      version: "0.2.0"
    },
    visualPipeline: stream.visualPipeline,
    videoCaptureSettings: stream.videoCaptureSettings,
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
      usableFaceFrameCount,
      usableFaceFraction:
        stream.face.length === 0
          ? 0
          : usableFaceFrameCount / stream.face.length,
      faceWithholdingDurationMs: liveAbstentions
        .filter((abstention) => abstention.modality === "face")
        .reduce(
          (total, abstention) =>
            total + Math.max(0, abstention.windowEndMs - abstention.windowStartMs),
          0
        ),
      faceRecoveryObserved:
        windows.filter((window) => window.modality === "face").length >= 2 &&
        liveAbstentions.some(
          (abstention) => abstention.modality === "face"
        ),
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
  const face: FacialKinematicsFrameV1[] = [];
  const speechState = freshLaneState();
  const faceState = freshLaneState();
  const liveAbstentions: Abstention[] = [];
  const faceSplitPointsMs: number[] = [];
  const qualityPolicy =
    options.qualityPolicy ?? DEFAULT_CAPTURE_QUALITY_POLICY;
  let completed = false;
  let qualityTransitionCount = 0;

  const faceQualityReason = (
    frame: FacialKinematicsFrameV1
  ): string | null =>
    evaluateVisualQuality(
      frame,
      identity.calibration?.face ?? null,
      qualityPolicy
    ).reasonCodes[0] ?? null;

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

    ingestVisualWithholding(input) {
      if (completed) throw new Error("Cannot ingest after session completion.");
      if (faceState.quality !== "withheld") {
        faceSplitPointsMs.push(input.tMs);
      }
      faceState.candidateSinceMs = null;
      faceState.adverseSinceMs = input.tMs;
      closeWindow(
        "face",
        faceState,
        faceState.lastGoodMs ?? input.tMs,
        input.reasonCode
      );
      changeQuality(
        "face",
        faceState,
        "withheld",
        input.tMs,
        input.reasonCode
      );
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
        liveAbstentions,
        faceSplitPointsMs
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
