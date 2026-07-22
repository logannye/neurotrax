import { describe, expect, it } from "vitest";
import {
  AMBIENT_LOCAL_PROTOCOL_PACK,
  type ConsentRecordV1,
  type MetricDefinition
} from "@phenometric/contracts";
import {
  finalizeAmbientMetrics,
  type AmbientFacialFrame,
  type AmbientMetricOutcome,
  type AmbientWithheldReasonCode
} from "@phenometric/ambient-core";
import {
  buildPostEncounterReport,
  validateObservationProvenance
} from "@phenometric/evidence-core";
import {
  buildAmbientObservation,
  contractReason,
  parseAmbientSourceWindowRef
} from "./ambient-core-adapter.js";

function consent(): ConsentRecordV1 {
  return {
    schemaVersion: "phenometric.consent-record.v1",
    consentId: "consent-session-adapter",
    sessionId: "session-adapter",
    documentVersion: "ambient-local-consent.v1",
    documentSha256: AMBIENT_LOCAL_PROTOCOL_PACK.consentDocument.contentSha256,
    recordedAt: "2026-07-20T17:00:00.000Z",
    scopes: {
      cameraCapture: true,
      microphoneCapture: true,
      localInMemoryAnalysis: true
    },
    localParticipantAssertion: true,
    withdrawnAt: null
  };
}

function definition(code: string): MetricDefinition {
  const value = AMBIENT_LOCAL_PROTOCOL_PACK.metrics.find(
    (candidate) => candidate.code === code
  );
  if (!value) throw new Error(`Missing test metric ${code}`);
  return value;
}

function emptyExtractionOutcome(code: string): AmbientMetricOutcome {
  const result = finalizeAmbientMetrics({
    identity: {
      sessionId: "session-adapter",
      protocolVersion: AMBIENT_LOCAL_PROTOCOL_PACK.version,
      protocolContentSha256: AMBIENT_LOCAL_PROTOCOL_PACK.contentSha256,
      sessionStartedAtMs: 0
    },
    voice: { frames: [], noiseCalibrationDurationMs: 2_000 },
    face: { frames: [], calibration: null }
  });
  const outcome = result.outcomes.find((candidate) => candidate.code === code);
  if (!outcome) throw new Error(`Missing extracted metric ${code}`);
  return outcome;
}

function outcomeWithReason(
  code: string,
  reasonCode: AmbientWithheldReasonCode
): AmbientMetricOutcome {
  const outcome = emptyExtractionOutcome(code);
  return {
    ...outcome,
    status: "withheld",
    reasonCode,
    detail: `Withheld for ${reasonCode}.`,
    technicalQualityScore: null,
    technicalDispersion: null
  };
}

function faceFrames(durationMs = 30_000, cadenceHz = 30): AmbientFacialFrame[] {
  const stepMs = 1_000 / cadenceHz;
  return Array.from(
    { length: Math.round(durationMs / stepMs) },
    (_, index) => {
      const tMs = index * stepMs;
      return {
        schemaVersion: "phenometric.facial-kinematics-frame.v1",
        tMs,
        acquiredAtMs: tMs,
        sequence: index + 1,
        captureEpoch: 1,
        taskContext: "ambient-frontal",
        faceCount: 1,
        trackSegmentId: "face:track:one",
        faceVisible: true,
        boundingBox: {
          x: 0.35,
          y: 0.2,
          width: 0.3,
          height: 0.5,
          widthPixels: 384,
          heightPixels: 360,
          edgeMarginFraction: 0.1
        },
        anatomicalLaterality: "subject-anatomical",
        pose: { yawDegrees: 0, pitchDegrees: 0, rollDegrees: 0 },
        eyeAperture: { left: 0.3, right: 0.3 },
        mouthCorners: {
          left: { x: 0.3, y: 0.1 },
          right: { x: -0.3, y: 0.1 }
        },
        mouthApertureRatio: 0.08,
        regionalMovementSpeed: 0.02,
        imageQuality: {
          illuminationMean: 0.55,
          darkClippingFraction: 0.02,
          brightClippingFraction: 0.02,
          sharpness: 0.002
        },
        analyzedFrameRate: cadenceHz,
        interResultGapMs: index === 0 ? null : stepMs,
        skippedFrameFraction: 0,
        processingLatencyMs: 8,
        qualityReasons: [],
        processorRef: "mediapipe-face-landmarker@test"
      };
    }
  );
}

describe("ambient observation adapter", () => {
  it("projects empty capture into 16 traceable withheld outcomes", () => {
    const observation = buildAmbientObservation({
      sessionId: "session-adapter",
      subjectRef: "subject-session-adapter",
      consent: consent(),
      startedAt: "2026-07-20T17:00:00.000Z",
      endedAt: "2026-07-20T17:00:01.000Z",
      durationMs: 1_000,
      voiceFrames: [],
      faceFrames: [],
      noiseCalibrationDurationMs: 0,
      faceCalibration: null,
      voiceLaneAvailable: false,
      faceLaneAvailable: false,
      processors: []
    });
    expect(observation.metricOutcomes).toHaveLength(16);
    expect(observation.metricOutcomes.every((outcome) => outcome.status === "withheld")).toBe(true);
    expect(
      validateObservationProvenance(
        observation,
        AMBIENT_LOCAL_PROTOCOL_PACK
      )
    ).toEqual({ status: "pass", errors: [] });

    const report = buildPostEncounterReport(
      observation,
      AMBIENT_LOCAL_PROTOCOL_PACK,
      { generatedAt: "2026-07-20T17:00:01.000Z" }
    );
    expect(report.sections.flatMap((section) => section.outcomes)).toHaveLength(16);
    expect(report.exportAvailable).toBe(false);
  });

  it("preserves current extractor reasons in outcomes and evidence windows", () => {
    const observation = buildAmbientObservation({
      sessionId: "session-adapter",
      subjectRef: "subject-session-adapter",
      consent: consent(),
      startedAt: "2026-07-20T17:00:00.000Z",
      endedAt: "2026-07-20T17:00:01.000Z",
      durationMs: 1_000,
      voiceFrames: [],
      faceFrames: [],
      noiseCalibrationDurationMs: 2_000,
      faceCalibration: null,
      voiceLaneAvailable: true,
      faceLaneAvailable: false,
      processors: []
    });
    const pitch = observation.metricOutcomes.find(
      (outcome) => outcome.metricCode === "ambient.voice.f0.median"
    );
    expect(pitch).toMatchObject({
      status: "withheld",
      reasonCode: "no-usable-signal"
    });
    const windowRef = pitch?.evidence.refs.find((ref) => ref.kind === "window");
    expect(windowRef?.kind).toBe("window");
    if (windowRef?.kind === "window") {
      expect(
        observation.windows.find((window) => window.windowId === windowRef.windowId)
          ?.reasonCodes
      ).toEqual(["no-usable-signal"]);
    }
  });

  it.each([
    ["ambient.voice.f0.median", "insufficient-pitched-speech"],
    ["ambient.voice.f0.variability", "insufficient-pitch-bins"],
    ["ambient.voice.pause_duration.median", "insufficient-events"],
    ["ambient.face.eye_aperture.left", "insufficient-bins"],
    ["ambient.face.eye_aperture.left", "multiple-faces"],
    ["ambient.face.blink_rate.bilateral", "insufficient-exposure"]
  ] as const)("preserves %s reason %s", (code, reasonCode) => {
    expect(
      contractReason(outcomeWithReason(code, reasonCode), definition(code), true)
    ).toBe(reasonCode);
  });

  it("fails closed when a reason is not registered for the metric", () => {
    expect(() =>
      contractReason(
        outcomeWithReason("ambient.voice.f0.median", "multiple-faces"),
        definition("ambient.voice.f0.median"),
        true
      )
    ).toThrow("is not registered");
  });

  it("projects each qualifying source bin onto its exact interval", () => {
    const observation = buildAmbientObservation({
      sessionId: "session-adapter",
      subjectRef: "subject-session-adapter",
      consent: consent(),
      startedAt: "2026-07-20T17:00:00.000Z",
      endedAt: "2026-07-20T17:00:30.000Z",
      durationMs: 30_000,
      voiceFrames: [],
      faceFrames: faceFrames(),
      noiseCalibrationDurationMs: 0,
      faceCalibration: {
        durationMs: 1_500,
        baselineBoxWidthPixels: 384,
        baselineBoxHeightPixels: 360
      },
      voiceLaneAvailable: false,
      faceLaneAvailable: true,
      processors: []
    });
    const outcome = observation.metricOutcomes.find(
      (candidate) => candidate.metricCode === "ambient.face.eye_aperture.left"
    );
    const windowIds = outcome?.evidence.refs.flatMap((ref) =>
      ref.kind === "window" ? [ref.windowId] : []
    ) ?? [];
    const intervals = windowIds.map((windowId) => {
      const window = observation.windows.find(
        (candidate) => candidate.windowId === windowId
      );
      return [window?.startMs, window?.endMs];
    });
    expect(intervals).toEqual([
      [0, 5_000],
      [5_000, 10_000],
      [10_000, 15_000],
      [15_000, 20_000],
      [20_000, 25_000],
      [25_000, 30_000]
    ]);
    expect(
      validateObservationProvenance(observation, AMBIENT_LOCAL_PROTOCOL_PACK)
    ).toEqual({ status: "pass", errors: [] });
  });

  it("parses track IDs containing colons and rejects invalid bounds", () => {
    expect(
      parseAmbientSourceWindowRef("face:2:track:with:colons:5000:10000", "face", 30_000)
    ).toEqual({
      modality: "face",
      captureEpoch: 2,
      trackSegmentId: "track:with:colons",
      startMs: 5_000,
      endMs: 10_000
    });
    expect(() =>
      parseAmbientSourceWindowRef("face:2:track:5000:31000", "face", 30_000)
    ).toThrow("Invalid ambient source window reference");
    expect(() =>
      parseAmbientSourceWindowRef("not-a-window", "face", 30_000)
    ).toThrow("Malformed ambient source window reference");
  });
});
