import { describe, expect, it } from "vitest";
import { AMBIENT_LOCAL_PROTOCOL_PACK } from "@phenometric/contracts";
import { AMBIENT_METRIC_REGISTRY } from "./ambient-registry.js";
import { finalizeAmbientMetrics } from "./ambient-metrics.js";

describe("finalizeAmbientMetrics", () => {
  it("returns every registered metric exactly once in registry order", () => {
    const result = finalizeAmbientMetrics({
      identity: {
        sessionId: "empty-ambient-session",
        protocolVersion: "1.0.0",
        protocolContentSha256: "empty-session-protocol",
        sessionStartedAtMs: 0
      },
      voice: { frames: [], noiseCalibrationDurationMs: 0 },
      face: { frames: [], calibration: null }
    });

    expect(result.outcomes.map((outcome) => outcome.code)).toEqual(
      AMBIENT_METRIC_REGISTRY.map((definition) => definition.code)
    );
    expect(new Set(result.outcomes.map((outcome) => outcome.code)).size).toBe(
      AMBIENT_METRIC_REGISTRY.length
    );
    expect(result.outcomes.every((outcome) => outcome.status === "withheld"))
      .toBe(true);
  });

  it("contains no guided, diagnostic, narrative, or deferred metric registrations", () => {
    const serialized = JSON.stringify(AMBIENT_METRIC_REGISTRY);

    expect(serialized).not.toMatch(
      /smile|eye.closure|vocal.fry|cpps|harmonics|jitter|shimmer|formant|ddk|diagnos|impair|normal.range|narrative/i
    );
  });

  it("deep-freezes the canonical registry", () => {
    expect(Object.isFrozen(AMBIENT_METRIC_REGISTRY)).toBe(true);
    expect(Object.isFrozen(AMBIENT_METRIC_REGISTRY[0])).toBe(true);
    expect(Object.isFrozen(AMBIENT_METRIC_REGISTRY[0].minimumEvidence)).toBe(
      true
    );
  });

  it("matches the contract protocol pack's public metric identity fields", () => {
    expect(
      AMBIENT_METRIC_REGISTRY.map((definition) => ({
        code: definition.code,
        label: definition.label,
        unit: definition.unit,
        modality: definition.modality,
        context: definition.context,
        reportSection: definition.group,
        algorithmVersion: definition.algorithmVersion,
        technicalVerification: definition.technicalVerification,
        clinicalValidation: definition.clinicalValidation
      }))
    ).toEqual(
      AMBIENT_LOCAL_PROTOCOL_PACK.metrics.map((definition) => ({
        code: definition.code,
        label: definition.label,
        unit: definition.unit,
        modality: definition.modality,
        context: definition.context,
        reportSection: definition.reportSection,
        algorithmVersion: definition.algorithmVersion,
        technicalVerification: definition.technicalVerification,
        clinicalValidation: definition.clinicalValidation
      }))
    );
  });

  it("keeps terminal output free of raw signal and landmark arrays", () => {
    const result = finalizeAmbientMetrics({
      identity: {
        sessionId: "privacy-boundary-session",
        protocolVersion: "1.0.0",
        protocolContentSha256: "privacy-boundary-protocol",
        sessionStartedAtMs: 0
      },
      voice: { frames: [], noiseCalibrationDurationMs: 0 },
      face: { frames: [], calibration: null }
    });

    expect(JSON.stringify(result)).not.toMatch(
      /pcm|waveform|landmarks|mouthCorners|eyeAperture|imageBitmap|embedding|voiceprint/i
    );
  });
});
