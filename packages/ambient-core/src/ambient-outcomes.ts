import { ambientMetricDefinition } from "./ambient-registry.js";
import {
  AMBIENT_PROTOCOL_ID,
  type AmbientIdentityInput,
  type AmbientMeasuredMetric,
  type AmbientMetricCode,
  type AmbientMetricEvidence,
  type AmbientMetricIdentity,
  type AmbientWithheldMetric,
  type AmbientWithheldReasonCode
} from "./ambient-types.js";

function stableHash(value: string): string {
  // FNV-1a 64-bit is used only as a deterministic local identifier, not as an
  // integrity or security primitive. The unhashed identityKey is retained so
  // contract code can replace this with SHA-256 without losing information.
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= BigInt(value.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, "0");
}

export function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))].sort();
}

export function metricIdentity(
  code: AmbientMetricCode,
  input: AmbientIdentityInput,
  processorRefs: readonly string[],
  trackSegmentIds: readonly string[]
): AmbientMetricIdentity {
  const definition = ambientMetricDefinition(code);
  const protocolId = input.protocolId ?? AMBIENT_PROTOCOL_ID;
  const normalizedProcessors = sortedUnique(processorRefs);
  const normalizedTracks = sortedUnique(trackSegmentIds);
  const identityKey = [
    input.sessionId,
    protocolId,
    input.protocolVersion,
    input.protocolContentSha256,
    definition.context,
    code,
    definition.unit,
    definition.algorithmVersion,
    normalizedProcessors.join(","),
    normalizedTracks.join(",")
  ].join("\u0000");
  return {
    outcomeId: `ambient-outcome-${stableHash(identityKey)}`,
    identityKey,
    sessionId: input.sessionId,
    protocolId,
    protocolVersion: input.protocolVersion,
    protocolContentSha256: input.protocolContentSha256,
    context: definition.context,
    algorithmVersion: definition.algorithmVersion,
    processorRefs: normalizedProcessors,
    trackSegmentIds: normalizedTracks
  };
}

export function measuredOutcome(
  code: AmbientMetricCode,
  input: AmbientIdentityInput,
  evidence: AmbientMetricEvidence,
  value: number,
  technicalQualityScore: number,
  technicalDispersion: number | null
): AmbientMeasuredMetric {
  if (!Number.isFinite(value)) {
    throw new Error(`Measured outcome ${code} must have a finite value.`);
  }
  if (
    !Number.isFinite(technicalQualityScore) ||
    technicalQualityScore < 0 ||
    technicalQualityScore > 1
  ) {
    throw new Error(
      `Measured outcome ${code} must have a technical quality score from 0 to 1.`
    );
  }
  if (
    technicalDispersion !== null &&
    !Number.isFinite(technicalDispersion)
  ) {
    throw new Error(
      `Measured outcome ${code} must have finite technical dispersion.`
    );
  }
  const definition = ambientMetricDefinition(code);
  return {
    status: "measured",
    code,
    label: definition.label,
    unit: definition.unit,
    modality: definition.modality,
    group: definition.group,
    value,
    technicalQualityScore,
    technicalDispersion,
    evidence,
    identity: metricIdentity(
      code,
      input,
      evidence.processorRefs,
      evidence.trackSegmentIds
    )
  };
}

export function withheldOutcome(
  code: AmbientMetricCode,
  input: AmbientIdentityInput,
  evidence: AmbientMetricEvidence,
  reasonCode: AmbientWithheldReasonCode,
  detail: string
): AmbientWithheldMetric {
  const definition = ambientMetricDefinition(code);
  return {
    status: "withheld",
    code,
    label: definition.label,
    unit: definition.unit,
    modality: definition.modality,
    group: definition.group,
    reasonCode,
    detail,
    technicalQualityScore: null,
    technicalDispersion: null,
    evidence,
    identity: metricIdentity(
      code,
      input,
      evidence.processorRefs,
      evidence.trackSegmentIds
    )
  };
}
