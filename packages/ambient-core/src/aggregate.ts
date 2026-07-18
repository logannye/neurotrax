import type {
  BiomarkerAggregate,
  Measurement,
  MeasurementContextKind
} from "@neurotrax/contracts";
import { median, medianAbsoluteDeviation } from "./stats.js";

export function aggregateMeasurements(
  measurements: Measurement[],
  contextByWindowId: Map<string, MeasurementContextKind>,
  labelByCode: Map<string, { label: string; unit: string }>
): BiomarkerAggregate[] {
  const byCode = new Map<string, Measurement[]>();
  for (const measurement of measurements) {
    const bucket = byCode.get(measurement.code) ?? [];
    bucket.push(measurement);
    byCode.set(measurement.code, bucket);
  }

  const aggregates: BiomarkerAggregate[] = [];
  for (const [code, bucket] of byCode) {
    const versions = new Set(bucket.map((m) => m.algorithmVersion));
    if (versions.size > 1) {
      throw new Error(`Biomarker ${code} mixes algorithm versions: ${[...versions].join(", ")}`);
    }
    const values = bucket.map((m) => m.value);
    const contextKind =
      contextByWindowId.get(bucket[0].contextRef) ?? "spontaneous-speech";
    const label = labelByCode.get(code) ?? { label: code, unit: bucket[0].unit };
    aggregates.push({
      code,
      label: label.label,
      unit: label.unit,
      contextKind,
      value: median(values),
      spread: medianAbsoluteDeviation(values),
      windowCount: bucket.length,
      algorithmVersion: bucket[0].algorithmVersion,
      uncertainty: "placeholder",
      clinicalValidation: "none"
    });
  }

  return aggregates.sort((a, b) => a.code.localeCompare(b.code));
}
