import type {
  Abstention,
  EncounterObservation,
  EventEnvelope,
  Measurement,
  MeasurableWindow,
  MeasurementContextKind
} from "@neurotrax/contracts";
import type { AudioFeatureFrame, FaceLandmarkFrame, FrameStream } from "./primitives.js";
import { detectMeasurableWindows } from "./windowing.js";
import { extractSpeechAcoustic } from "./speech-acoustic.js";
import { extractFacialExpressivity } from "./facial-expressivity.js";
import { aggregateMeasurements } from "./aggregate.js";
import { createEventFactory } from "./events.js";

const LABELS = new Map<string, { label: string; unit: string }>([
  ["prototype.speech.articulation_rate", { label: "Articulation rate", unit: "voiced-fraction" }],
  ["prototype.speech.pause_count", { label: "Pause count", unit: "count" }],
  ["prototype.speech.pitch_variability", { label: "Pitch variability", unit: "hz-stddev" }],
  ["prototype.face.expressivity", { label: "Facial expressivity", unit: "motion-index" }],
  ["prototype.face.blink_rate", { label: "Blink rate", unit: "blinks-per-minute" }],
  ["prototype.face.brow_amplitude", { label: "Brow amplitude", unit: "normalized-range" }]
]);

function slice<T extends { tMs: number }>(frames: T[], window: MeasurableWindow): T[] {
  return frames.filter((f) => f.tMs >= window.startMs && f.tMs <= window.endMs);
}

function isAbstention(result: Measurement[] | Abstention): result is Abstention {
  return !Array.isArray(result);
}

export function runConductor(
  stream: FrameStream,
  options: { baseTimeMs?: number } = {}
): { observation: EncounterObservation; events: EventEnvelope[] } {
  if (stream.containsPHI !== false) {
    throw new Error(
      "ambient-core accepts only explicitly non-PHI synthetic streams"
    );
  }

  const factory = createEventFactory({
    visitId: stream.visitId,
    participantId: stream.participantId,
    baseTimeMs: options.baseTimeMs ?? 0
  });
  const events: EventEnvelope[] = [];
  const measurements: Measurement[] = [];
  const abstentions: Abstention[] = [];
  const contextByWindowId = new Map<string, MeasurementContextKind>();

  const windows = detectMeasurableWindows(stream);
  for (const window of windows) {
    contextByWindowId.set(window.windowId, window.context.kind);
    events.push(
      factory.next(
        "capture-conductor",
        "capture.window.detected",
        `Detected a candidate ${window.modality} window.`,
        window.startMs,
        { windowId: window.windowId, modality: window.modality, contextKind: window.context.kind }
      )
    );

    const result: Measurement[] | Abstention =
      window.modality === "speech"
        ? extractSpeechAcoustic(window, slice(stream.audio as AudioFeatureFrame[], window))
        : extractFacialExpressivity(window, slice(stream.face as FaceLandmarkFrame[], window));

    const actorId = window.modality === "speech" ? "speech-acoustic" : "facial-expressivity";

    if (isAbstention(result)) {
      abstentions.push(result);
      events.push(
        factory.next(
          actorId,
          "measurement.abstained",
          `Abstained on ${window.modality} window: ${result.reasonCode}.`,
          window.startMs,
          { windowId: window.windowId, reasonCode: result.reasonCode }
        )
      );
      continue;
    }

    for (const measurement of result) {
      measurements.push(measurement);
      events.push(
        factory.next(
          actorId,
          "measurement.recorded",
          `Recorded ${measurement.label}.`,
          window.startMs,
          { windowId: window.windowId, code: measurement.code, value: measurement.value }
        )
      );
    }
  }

  const aggregates = aggregateMeasurements(measurements, contextByWindowId, LABELS);
  const observation: EncounterObservation = {
    containsPHI: stream.containsPHI,
    captureMode: stream.captureMode,
    visitId: stream.visitId,
    participantId: stream.participantId,
    windows,
    measurements,
    aggregates,
    abstentions,
    measurementCount: measurements.length
  };

  events.push(
    factory.next(
      "capture-conductor",
      "encounter-observation.created",
      `Created a per-visit observation with ${aggregates.length} biomarker aggregates.`,
      windows.at(-1)?.endMs ?? 0,
      { visitId: stream.visitId, aggregateCount: aggregates.length, measurementCount: measurements.length }
    )
  );

  return { observation, events };
}
