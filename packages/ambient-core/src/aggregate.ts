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
  const groups = new Map<
    string,
    {
      code: string;
      contextKind: MeasurementContextKind;
      measurements: Measurement[];
    }
  >();

  for (const measurement of measurements) {
    const contextKind = contextByWindowId.get(measurement.contextRef);
    if (!contextKind) {
      throw new Error(
        `Measurement ${measurement.code} references unknown context ${measurement.contextRef}`
      );
    }

    const key = `${measurement.code}\u0000${contextKind}`;
    const group = groups.get(key) ?? {
      code: measurement.code,
      contextKind,
      measurements: []
    };
    group.measurements.push(measurement);
    groups.set(key, group);
  }

  const aggregates: BiomarkerAggregate[] = [];
  for (const { code, contextKind, measurements: bucket } of groups.values()) {
    const versions = new Set(bucket.map((m) => m.algorithmVersion));
    if (versions.size > 1) {
      throw new Error(`Biomarker ${code} mixes algorithm versions: ${[...versions].join(", ")}`);
    }
    const values = bucket.map((m) => m.value);
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

  return aggregates.sort(
    (a, b) =>
      a.code.localeCompare(b.code) || a.contextKind.localeCompare(b.contextKind)
  );
}
