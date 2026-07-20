import type {
  BiomarkerAggregate,
  ConfoundEnvelope,
  Measurement,
  MeasurementContext,
  MeasurementUncertainty,
  SpeechConfoundEnvelope,
  VisualConfoundEnvelope
} from "@phenometric/contracts";
import { median, medianAbsoluteDeviation } from "./stats.js";

function aggregateConfounds(confounds: ConfoundEnvelope[]): ConfoundEnvelope {
  const kinds = new Set(confounds.map((value) => value.kind));
  if (kinds.size !== 1) {
    throw new Error("Cannot aggregate speech and visual confounds together.");
  }
  if (confounds[0].kind === "speech") {
    const speech = confounds as SpeechConfoundEnvelope[];
    return {
      kind: "speech",
      sampleRateHz: Math.round(
        median(speech.map((value) => value.sampleRateHz))
      ),
      sampleRateClass: speech[0].sampleRateClass,
      browserProcessing: {
        echoCancellation: speech.some(
          (value) => value.browserProcessing.echoCancellation
        ),
        noiseSuppression: speech.some(
          (value) => value.browserProcessing.noiseSuppression
        ),
        autoGainControl: speech.some(
          (value) => value.browserProcessing.autoGainControl
        )
      },
      snrDb: median(speech.map((value) => value.snrDb)),
      clippingFraction: median(
        speech.map((value) => value.clippingFraction)
      ),
      dcOffset: median(speech.map((value) => value.dcOffset)),
      lostBlockFraction: median(
        speech.map((value) => value.lostBlockFraction)
      ),
      maximumBlockGapMs: Math.max(
        ...speech.map((value) => value.maximumBlockGapMs)
      ),
      usableCoverage: median(
        speech.map((value) => value.usableCoverage)
      ),
      periodicityCoverage: median(
        speech.map((value) => value.periodicityCoverage)
      )
    };
  }
  const visual = confounds as VisualConfoundEnvelope[];
  return {
    kind: "visual",
    faceBoxWidthPixels: median(
      visual.map((value) => value.faceBoxWidthPixels)
    ),
    faceBoxHeightPixels: median(
      visual.map((value) => value.faceBoxHeightPixels)
    ),
    faceWidthFraction: median(
      visual.map((value) => value.faceWidthFraction)
    ),
    faceHeightFraction: median(
      visual.map((value) => value.faceHeightFraction)
    ),
    edgeMarginFraction: median(
      visual.map((value) => value.edgeMarginFraction)
    ),
    analyzedFrameRate: median(
      visual.map((value) => value.analyzedFrameRate)
    ),
    skippedFrameFraction: median(
      visual.map((value) => value.skippedFrameFraction)
    ),
    meanInterResultGapMs: median(
      visual.map((value) => value.meanInterResultGapMs)
    ),
    illuminationMean: median(
      visual.map((value) => value.illuminationMean)
    ),
    darkClippingFraction: median(
      visual.map((value) => value.darkClippingFraction)
    ),
    brightClippingFraction: median(
      visual.map((value) => value.brightClippingFraction)
    ),
    sharpness: median(visual.map((value) => value.sharpness)),
    yawDegrees: median(visual.map((value) => value.yawDegrees)),
    pitchDegrees: median(visual.map((value) => value.pitchDegrees)),
    rollDegrees: median(visual.map((value) => value.rollDegrees))
  };
}

function aggregateUncertainty(
  measurements: Measurement[]
): MeasurementUncertainty {
  const estimated = measurements.flatMap((measurement) =>
    measurement.uncertainty.kind === "estimated"
      ? [measurement.uncertainty]
      : []
  );
  if (estimated.length === measurements.length) {
    return {
      kind: "estimated",
      method: "median-absolute-deviation",
      value: median(estimated.map((uncertainty) => uncertainty.value)),
      unit: estimated[0].unit
    };
  }
  const reason = measurements.find(
    (measurement) => measurement.uncertainty.kind === "not-estimated"
  )?.uncertainty;
  return {
    kind: "not-estimated",
    reason:
      reason?.kind === "not-estimated"
        ? reason.reason
        : "Uncertainty was not estimated for all contributing measurements."
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
    const processors = new Set(bucket.map((measurement) => measurement.processorRef));
    if (processors.size > 1) {
      throw new Error(
        `Biomarker ${code} mixes processor references: ${[...processors].join(", ")}`
      );
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
      processorRef: bucket[0].processorRef,
      sourceWindowRefs: [
        ...new Set(
          bucket.flatMap((measurement) => measurement.sourceWindowRefs)
        )
      ],
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
      uncertainty: aggregateUncertainty(bucket),
      clinicalValidation: "none"
    });
  }

  return aggregates.sort(
    (a, b) =>
      a.code.localeCompare(b.code) || a.contextKind.localeCompare(b.contextKind)
  );
}
