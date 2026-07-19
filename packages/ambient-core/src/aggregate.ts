import type {
  BiomarkerAggregate,
  ConfoundEnvelope,
  Measurement,
  MeasurementContext
} from "@phenometric/contracts";
import { median, medianAbsoluteDeviation } from "./stats.js";

function aggregateConfounds(confounds: ConfoundEnvelope[]): ConfoundEnvelope {
  return {
    snrDb: median(confounds.map((value) => value.snrDb)),
    faceFramingFraction: median(
      confounds.map((value) => value.faceFramingFraction)
    ),
    observedFrameRate: median(
      confounds.map((value) => value.observedFrameRate)
    ),
    illuminationRelative: median(
      confounds.map((value) => value.illuminationRelative)
    ),
    yawDegrees: median(confounds.map((value) => value.yawDegrees))
  };
}

export function aggregateMeasurements(
  measurements: Measurement[],
  contextByWindowId: Map<string, MeasurementContext>,
  labelByCode: Map<string, { label: string; unit: string }>
): BiomarkerAggregate[] {
  const groups = new Map<
    string,
    {
      code: string;
      context: MeasurementContext;
      measurements: Measurement[];
    }
  >();

  for (const measurement of measurements) {
    const context = contextByWindowId.get(measurement.contextRef);
    if (!context) {
      throw new Error(
        `Measurement ${measurement.code} references unknown context ${measurement.contextRef}`
      );
    }

    const key = `${measurement.code}\u0000${context.kind}`;
    const group = groups.get(key) ?? {
      code: measurement.code,
      context,
      measurements: []
    };
    group.measurements.push(measurement);
    groups.set(key, group);
  }

  const aggregates: BiomarkerAggregate[] = [];
  for (const { code, context, measurements: bucket } of groups.values()) {
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
      contextKind: context.kind,
      value: median(values),
      spread: medianAbsoluteDeviation(values),
      confidence: median(bucket.map((measurement) => measurement.confidence)),
      windowCount: bucket.length,
      algorithmVersion: bucket[0].algorithmVersion,
      confounds: aggregateConfounds(
        bucket.map((measurement) => {
          const measurementContext = contextByWindowId.get(
            measurement.contextRef
          );
          if (!measurementContext) {
            throw new Error(
              `Missing context for ${measurement.contextRef}`
            );
          }
          return measurementContext.confounds;
        })
      ),
      uncertainty: "placeholder",
      clinicalValidation: "none"
    });
  }

  return aggregates.sort(
    (a, b) =>
      a.code.localeCompare(b.code) || a.contextKind.localeCompare(b.contextKind)
  );
}
