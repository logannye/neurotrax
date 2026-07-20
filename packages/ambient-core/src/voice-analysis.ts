import type {
  Abstention,
  Measurement,
  MeasurementContextKind,
  MeasurableWindow,
  MeasurementUncertainty
} from "@phenometric/contracts";
import type { VoiceSignalFrameV1 } from "./primitives.js";
import {
  median,
  medianAbsoluteDeviation,
  stdDev
} from "./stats.js";
import {
  evaluateVoiceQuality,
  VOICE_FINE_ACOUSTIC_SNR_FLOOR_DB
} from "./voice-quality.js";

export const VOICE_ANALYSIS_VERSION = "voice-analysis-1.0";
export const VOICE_ANALYSIS_PROCESSOR_REF =
  "browser-voice-dsp@1.0";

export const VOICE_MEASUREMENT_LABELS = new Map<
  string,
  { label: string; unit: string }
>([
  ["prototype.voice.f0.median", { label: "Median fundamental frequency", unit: "hertz" }],
  ["prototype.voice.f0.variability", { label: "Fundamental-frequency variability", unit: "semitone-stddev" }],
  ["prototype.voice.cpps", { label: "Cepstral peak prominence", unit: "decibels" }],
  ["prototype.voice.hnr", { label: "Harmonics-to-noise ratio", unit: "decibels" }],
  ["prototype.voice.intensity.variability", { label: "Intensity variability", unit: "decibel-stddev" }],
  ["prototype.voice.voiced_fraction", { label: "Voiced-time fraction", unit: "ratio" }],
  ["prototype.voice.pause_rate", { label: "Pause rate", unit: "pauses-per-minute" }],
  ["prototype.voice.pause_duration.median", { label: "Median pause duration", unit: "seconds" }],
  ["prototype.voice.speech_run_duration.median", { label: "Median speech-run duration", unit: "seconds" }],
  ["prototype.voice.syllabic_rate_estimate", { label: "Estimated syllabic rate", unit: "nuclei-per-second" }],
  ["prototype.voice.jitter.local", { label: "Local jitter", unit: "ratio" }],
  ["prototype.voice.shimmer.local", { label: "Local shimmer", unit: "ratio" }],
  ["prototype.voice.phonation_break_fraction", { label: "Phonation-break fraction", unit: "ratio" }],
  ["prototype.voice.formant.f1_median", { label: "Median first formant", unit: "hertz" }],
  ["prototype.voice.formant.f2_median", { label: "Median second formant", unit: "hertz" }],
  ["prototype.voice.ddk.rate", { label: "Estimated rapid-syllable rate", unit: "nuclei-per-second" }],
  ["prototype.voice.ddk.interval_variability", { label: "Rapid-syllable interval variability", unit: "coefficient-of-variation" }],
  ["prototype.voice.onset_latency", { label: "Voice onset latency", unit: "seconds" }]
]);

export interface VoiceExtractionResult {
  measurements: Measurement[];
  abstentions: Abstention[];
}

interface RunDurations {
  voiced: number[];
  pauses: number[];
}

function contextKind(window: MeasurableWindow): MeasurementContextKind {
  return window.context.kind;
}

function frameStepMs(frames: VoiceSignalFrameV1[]): number {
  const steps = frames
    .slice(1)
    .map((frame, index) => frame.tMs - frames[index].tMs)
    .filter((value) => Number.isFinite(value) && value > 0);
  return steps.length === 0 ? 10 : median(steps);
}

function durations(frames: VoiceSignalFrameV1[]): RunDurations {
  if (frames.length === 0) return { voiced: [], pauses: [] };
  const step = frameStepMs(frames);
  const result: RunDurations = { voiced: [], pauses: [] };
  let state = frames[0].voiced;
  let startedAt = frames[0].tMs;
  for (const frame of frames.slice(1)) {
    if (frame.voiced === state) continue;
    const elapsed = Math.max(step, frame.tMs - startedAt);
    (state ? result.voiced : result.pauses).push(elapsed);
    state = frame.voiced;
    startedAt = frame.tMs;
  }
  const elapsed =
    Math.max(step, frames.at(-1)!.tMs - startedAt + step);
  (state ? result.voiced : result.pauses).push(elapsed);
  return result;
}

function finite(values: Array<number | null>): number[] {
  return values.filter(
    (value): value is number =>
      value !== null && Number.isFinite(value)
  );
}

function semitoneVariability(values: number[]): number {
  if (values.length < 2) return 0;
  const center = median(values);
  return stdDev(
    values.map((value) => 12 * Math.log2(value / center))
  );
}

function reliability(frames: VoiceSignalFrameV1[]): number {
  if (frames.length === 0) return 0;
  const usable = frames.filter(
    (frame) => evaluateVoiceQuality(frame).generalMeasurementUsable
  );
  const voiced = frames.filter((frame) => frame.voiced);
  const agreement =
    voiced.length === 0
      ? 0
      : median(voiced.map((frame) => frame.estimatorAgreement));
  const snr =
    Math.min(
      1,
      Math.max(
        0,
        (median(frames.map((frame) => frame.snrDb)) - 10) / 20
      )
    );
  const clipping =
    1 -
    Math.min(
      1,
      median(
        frames.map((frame) => frame.clippedSampleFraction)
      ) / 0.01
    );
  return Math.min(
    1,
    0.3 * (usable.length / frames.length) +
      0.25 * agreement +
      0.25 * snr +
      0.2 * clipping
  );
}

function uncertaintyFor(
  values: number[],
  unit: string
): MeasurementUncertainty {
  if (values.length < 2) {
    return {
      kind: "not-estimated",
      reason:
        "Fewer than two valid 500 ms subwindows were available."
    };
  }
  return {
    kind: "estimated",
    method: "median-absolute-deviation",
    value: medianAbsoluteDeviation(values),
    unit
  };
}

function subwindowValues(
  frames: VoiceSignalFrameV1[],
  selector: (chunk: VoiceSignalFrameV1[]) => number | null
): number[] {
  if (frames.length === 0) return [];
  const values: number[] = [];
  let chunkStart = frames[0].tMs;
  let chunk: VoiceSignalFrameV1[] = [];
  for (const frame of frames) {
    if (frame.tMs - chunkStart >= 500 && chunk.length > 0) {
      const value = selector(chunk);
      if (value !== null && Number.isFinite(value)) values.push(value);
      chunkStart = frame.tMs;
      chunk = [];
    }
    chunk.push(frame);
  }
  if (chunk.length > 0) {
    const value = selector(chunk);
    if (value !== null && Number.isFinite(value)) values.push(value);
  }
  return values;
}

function measurement(
  window: MeasurableWindow,
  frames: VoiceSignalFrameV1[],
  code: string,
  value: number,
  subwindows: number[],
  processorRef: string,
  uncertaintyReason?: string
): Measurement {
  const metadata = VOICE_MEASUREMENT_LABELS.get(code);
  if (!metadata) throw new Error(`Unknown voice measurement ${code}.`);
  return {
    code,
    label: metadata.label,
    value,
    unit: metadata.unit,
    confidence: reliability(frames),
    uncertainty: uncertaintyReason
      ? { kind: "not-estimated", reason: uncertaintyReason }
      : uncertaintyFor(subwindows, metadata.unit),
    algorithmVersion: VOICE_ANALYSIS_VERSION,
    processorRef,
    clinicalValidation: "none",
    contextRef: window.windowId,
    sourceWindowRefs: [window.windowId],
    windowStartMs: window.startMs,
    windowEndMs: window.endMs,
    evidenceSnippetRef: null
  };
}

function abstention(
  window: MeasurableWindow,
  code: string,
  reasonCode: string,
  detail: string,
  processorRef: string
): Abstention {
  return {
    modality: "speech",
    windowStartMs: window.startMs,
    windowEndMs: window.endMs,
    contextKind: window.context.kind,
    reasonCode,
    detail,
    measurementCodes: [code],
    sourceWindowRefs: [window.windowId],
    processorRef
  };
}

export function extractVoiceMeasurements(
  window: MeasurableWindow,
  frames: VoiceSignalFrameV1[],
  taskStartedAtMs = window.startMs
): VoiceExtractionResult {
  const measurements: Measurement[] = [];
  const abstentions: Abstention[] = [];
  const processorRef =
    frames.find((frame) => frame.processorRef)?.processorRef ??
    VOICE_ANALYSIS_PROCESSOR_REF;
  const usable = frames.filter(
    (frame) => evaluateVoiceQuality(frame).generalMeasurementUsable
  );
  const fine = frames.filter(
    (frame) => evaluateVoiceQuality(frame).fineAcousticUsable
  );
  const voiced = usable.filter((frame) => frame.voiced);
  const pitched = voiced.filter(
    (frame) =>
      frame.f0Hz !== null &&
      frame.f0Confidence >= 0.55 &&
      frame.estimatorAgreement >= 0.7
  );
  const durationSeconds = Math.max(
    0.001,
    (window.endMs - window.startMs) / 1000
  );

  const addOrAbstain = (
    code: string,
    values: number[],
    value: number | null,
    reason = "task-not-observed",
    detail = "The accepted task interval did not contain enough valid observations."
  ): void => {
    if (value === null || !Number.isFinite(value)) {
      abstentions.push(
        abstention(window, code, reason, detail, processorRef)
      );
      return;
    }
    measurements.push(
      measurement(window, frames, code, value, values, processorRef)
    );
  };

  const f0Values = finite(pitched.map((frame) => frame.f0Hz));
  addOrAbstain(
    "prototype.voice.f0.median",
    subwindowValues(pitched, (chunk) => {
      const values = finite(chunk.map((frame) => frame.f0Hz));
      return values.length ? median(values) : null;
    }),
    f0Values.length ? median(f0Values) : null
  );
  addOrAbstain(
    "prototype.voice.f0.variability",
    subwindowValues(pitched, (chunk) => {
      const values = finite(chunk.map((frame) => frame.f0Hz));
      return values.length >= 2 ? semitoneVariability(values) : null;
    }),
    f0Values.length >= 2 ? semitoneVariability(f0Values) : null
  );

  for (const [code, selector] of [
    ["prototype.voice.cpps", (frame: VoiceSignalFrameV1) => frame.cppsDb],
    ["prototype.voice.hnr", (frame: VoiceSignalFrameV1) => frame.hnrDb]
  ] as const) {
    const values = finite(fine.map(selector));
    addOrAbstain(
      code,
      subwindowValues(fine, (chunk) => {
        const chunkValues = finite(chunk.map(selector));
        return chunkValues.length ? median(chunkValues) : null;
      }),
      values.length ? median(values) : null,
      fine.length === 0 ? "audio-processing-enabled" : "task-not-observed",
      `This fine acoustic measurement requires at least ${VOICE_FINE_ACOUSTIC_SNR_FLOOR_DB} dB SNR, unprocessed audio, continuity, and a supported sample rate.`
    );
  }

  const fineVoiced = fine.filter((frame) => frame.voiced);
  const intensity = fineVoiced.map((frame) => frame.intensityDbfs);
  addOrAbstain(
    "prototype.voice.intensity.variability",
    subwindowValues(fineVoiced, (chunk) =>
      chunk.length >= 2
        ? stdDev(chunk.map((frame) => frame.intensityDbfs))
        : null
    ),
    intensity.length >= 2 ? stdDev(intensity) : null,
    fineVoiced.length === 0
      ? "audio-processing-enabled"
      : "task-not-observed",
    "Intensity variability requires unprocessed, continuous audio with at least 20 dB SNR and a supported sample rate."
  );
  const voicedFraction = voiced.length / Math.max(1, usable.length);
  measurements.push(
    measurement(
      window,
      frames,
      "prototype.voice.voiced_fraction",
      voicedFraction,
      subwindowValues(usable, (chunk) =>
        chunk.filter((frame) => frame.voiced).length /
        Math.max(1, chunk.length)
      ),
      processorRef
    )
  );

  const runs = durations(usable);
  const boundedPauses = runs.pauses.filter(
    (duration) => duration >= 100 && duration <= 2_000
  );
  const pauseRate =
    boundedPauses.length / Math.max(durationSeconds / 60, 1 / 60);
  measurements.push(
    measurement(
      window,
      frames,
      "prototype.voice.pause_rate",
      pauseRate,
      subwindowValues(usable, (chunk) => {
        const pauses = durations(chunk).pauses.filter(
          (duration) => duration >= 100
        );
        return pauses.length * 120;
      }),
      processorRef
    )
  );
  addOrAbstain(
    "prototype.voice.pause_duration.median",
    subwindowValues(usable, (chunk) => {
      const pauses = durations(chunk).pauses.filter(
        (duration) => duration >= 100 && duration <= 2_000
      );
      return pauses.length ? median(pauses) / 1000 : null;
    }),
    boundedPauses.length ? median(boundedPauses) / 1000 : null
  );
  addOrAbstain(
    "prototype.voice.speech_run_duration.median",
    subwindowValues(usable, (chunk) => {
      const voicedRuns = durations(chunk).voiced;
      return voicedRuns.length
        ? median(voicedRuns) / 1000
        : null;
    }),
    runs.voiced.length ? median(runs.voiced) / 1000 : null
  );

  const nuclei = usable.filter((frame) => frame.syllabicNucleus);
  const syllabicRate = nuclei.length / durationSeconds;
  measurements.push(
    measurement(
      window,
      frames,
      "prototype.voice.syllabic_rate_estimate",
      syllabicRate,
      subwindowValues(usable, (chunk) =>
        chunk.filter((frame) => frame.syllabicNucleus).length * 2
      ),
      processorRef
    )
  );

  if (contextKind(window) === "sustained-vowel") {
    for (const [code, selector] of [
      ["prototype.voice.jitter.local", (frame: VoiceSignalFrameV1) => frame.jitterLocal],
      ["prototype.voice.shimmer.local", (frame: VoiceSignalFrameV1) => frame.shimmerLocal]
    ] as const) {
      const values = finite(fine.map(selector));
      addOrAbstain(
        code,
        subwindowValues(fine, (chunk) => {
          const chunkValues = finite(chunk.map(selector));
          return chunkValues.length ? median(chunkValues) : null;
        }),
        values.length >= 10 ? median(values) : null,
        "task-not-observed",
        "Perturbation analysis requires accepted sustained phonation, sufficient reliable cycles, at least 20 dB SNR, and disabled browser audio processing."
      );
    }
    measurements.push(
      measurement(
        window,
        frames,
        "prototype.voice.phonation_break_fraction",
        1 - voicedFraction,
        subwindowValues(usable, (chunk) =>
          1 -
          chunk.filter((frame) => frame.voiced).length /
            Math.max(1, chunk.length)
        ),
        processorRef
      )
    );
    for (const [code, selector] of [
      ["prototype.voice.formant.f1_median", (frame: VoiceSignalFrameV1) => frame.formantF1Hz],
      ["prototype.voice.formant.f2_median", (frame: VoiceSignalFrameV1) => frame.formantF2Hz]
    ] as const) {
      const values = finite(fine.map(selector));
      addOrAbstain(
        code,
        subwindowValues(fine, (chunk) => {
          const chunkValues = finite(chunk.map(selector));
          return chunkValues.length ? median(chunkValues) : null;
        }),
        values.length ? median(values) : null,
        "task-not-observed",
        "No plausible stable formant candidate passed LPC bandwidth and frequency filtering."
      );
    }
  }

  if (contextKind(window) === "rapid-syllables") {
    const times = nuclei.map((frame) => frame.tMs);
    const intervals = times
      .slice(1)
      .map((time, index) => (time - times[index]) / 1000)
      .filter((value) => value > 0);
    addOrAbstain(
      "prototype.voice.ddk.rate",
      subwindowValues(usable, (chunk) =>
        chunk.filter((frame) => frame.syllabicNucleus).length * 2
      ),
      nuclei.length >= 6 ? nuclei.length / durationSeconds : null
    );
    addOrAbstain(
      "prototype.voice.ddk.interval_variability",
      subwindowValues(usable, (chunk) => {
        const times = chunk
          .filter((frame) => frame.syllabicNucleus)
          .map((frame) => frame.tMs);
        const localIntervals = times
          .slice(1)
          .map((time, index) => (time - times[index]) / 1000)
          .filter((value) => value > 0);
        return localIntervals.length >= 2
          ? stdDev(localIntervals) /
              Math.max(0.001, median(localIntervals))
          : null;
      }),
      intervals.length >= 5
        ? stdDev(intervals) / Math.max(0.001, median(intervals))
        : null
    );
  }

  if (contextKind(window) === "spontaneous-speech") {
    const firstVoiced = voiced[0];
    const value = firstVoiced
      ? Math.max(0, firstVoiced.tMs - taskStartedAtMs) / 1000
      : null;
    if (value === null) {
      abstentions.push(
        abstention(
          window,
          "prototype.voice.onset_latency",
          "task-not-observed",
          "No usable voice onset was found.",
          processorRef
        )
      );
    } else {
      measurements.push(
        measurement(
          window,
          frames,
          "prototype.voice.onset_latency",
          value,
          [],
          processorRef,
          "Onset latency is a non-repeatable event in this protocol."
        )
      );
    }
  }

  return { measurements, abstentions };
}
