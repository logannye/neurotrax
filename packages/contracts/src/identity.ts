export type StableMetricIdentityInput = Readonly<{
  protocolPackId: string;
  protocolVersion: string;
  sessionId: string;
  metricCode: string;
  context: string;
  unit: string;
  algorithmVersion: string;
  processorRef: string;
  trackSegmentId: string;
}>;

function canonicalComponent(value: string): string {
  return `${new TextEncoder().encode(value).length}:${value}`;
}

/**
 * A small deterministic, non-cryptographic identifier hash. This is used for
 * referential identity, not security or asset integrity.
 */
function fnv1a64(value: string): string {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  for (const byte of new TextEncoder().encode(value)) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * prime);
  }
  return hash.toString(16).padStart(16, "0");
}

export function canonicalMetricIdentity(
  input: StableMetricIdentityInput
): string {
  return [
    input.protocolPackId,
    input.protocolVersion,
    input.sessionId,
    input.metricCode,
    input.context,
    input.unit,
    input.algorithmVersion,
    input.processorRef,
    input.trackSegmentId
  ]
    .map(canonicalComponent)
    .join("|");
}

export function createAggregateId(
  input: StableMetricIdentityInput
): string {
  return `agg_${fnv1a64(canonicalMetricIdentity(input))}`;
}

export function createMeasurementId(
  input: StableMetricIdentityInput,
  windowId: string,
  ordinal: number
): string {
  if (!Number.isSafeInteger(ordinal) || ordinal < 0) {
    throw new Error("Measurement ordinal must be a non-negative safe integer.");
  }
  return `msr_${fnv1a64(
    `${canonicalMetricIdentity(input)}|${canonicalComponent(windowId)}|${ordinal}`
  )}`;
}
