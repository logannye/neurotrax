import { describe, expect, it } from "vitest";
import {
  createNeutralFacialBaseline,
  evaluateEyeClosureAdherence,
  evaluateSmileAdherence,
  extractFacialTaskMeasurements
} from "./facial-task.js";
import {
  syntheticFacialFrame,
  syntheticFrameStream,
  syntheticTaskFrames
} from "./test-helpers.js";
import { detectMeasurableWindows } from "./windowing.js";

function extract(
  face = [
    ...syntheticTaskFrames("neutral-face", 0),
    ...syntheticTaskFrames("smile", 2_000, () => ({
      mouthCorners: {
        left: { x: 0.36, y: 0.06 },
        right: { x: -0.35, y: 0.07 }
      }
    })),
    ...syntheticTaskFrames("eye-closure", 4_000, () => ({
      eyeAperture: { left: 0.06, right: 0.09 }
    }))
  ]
) {
  const stream = syntheticFrameStream({ face });
  return extractFacialTaskMeasurements(
    detectMeasurableWindows(stream),
    face
  );
}

describe("extractFacialTaskMeasurements", () => {
  it("uses pure neutral-referenced evaluators at the inclusive gate boundaries", () => {
    const baseline = createNeutralFacialBaseline(
      syntheticTaskFrames("neutral-face", 0)
    );
    const smile = evaluateSmileAdherence(baseline, [
      syntheticFacialFrame(2_000, "smile", {
        mouthCorners: {
          left: { x: 0.32, y: 0.1 },
          right: { x: -0.3, y: 0.1 }
        }
      })
    ]);
    const closure = evaluateEyeClosureAdherence(baseline, [
      syntheticFacialFrame(4_000, "eye-closure", {
        eyeAperture: { left: 0.24, right: 0.3 }
      })
    ]);

    expect(baseline).toMatchObject({
      processorRef: expect.stringContaining("mediapipe-face-landmarker"),
      sourceFrameCount: 33,
      eyeAperture: { left: 0.3, right: 0.3 }
    });
    expect(smile).toMatchObject({
      observed: true,
      processorCompatible: true,
      adherent: { left: true, right: false }
    });
    expect(smile.excursions.left).toBeCloseTo(0.02);
    expect(closure).toMatchObject({
      observed: true,
      processorCompatible: true,
      closed: { left: true, right: false },
      recovered: { left: false, right: true }
    });
    expect(closure.closureFractions.left).toBeCloseTo(0.2);
  });

  it("uses the same inclusive per-side thresholds for live gating", () => {
    const baseline = createNeutralFacialBaseline(
      syntheticTaskFrames("neutral-face", 0)
    );
    const exactSmile = evaluateSmileAdherence(baseline, [
      syntheticFacialFrame(2_000, "smile", {
        mouthCorners: {
          left: { x: 0.32, y: 0.1 },
          right: { x: -0.3, y: 0.1 }
        }
      })
    ]);
    const justBelowSmile = evaluateSmileAdherence(baseline, [
      syntheticFacialFrame(2_050, "smile", {
        mouthCorners: {
          left: { x: 0.319_999, y: 0.1 },
          right: { x: -0.3, y: 0.1 }
        }
      })
    ]);
    const exactClosed = evaluateEyeClosureAdherence(baseline, [
      syntheticFacialFrame(4_000, "eye-closure", {
        eyeAperture: { left: 0.24, right: 0.3 }
      })
    ]);
    const exactRecovered = evaluateEyeClosureAdherence(baseline, [
      syntheticFacialFrame(4_050, "eye-closure", {
        eyeAperture: { left: 0.27, right: 0.3 }
      })
    ]);

    expect(exactSmile.adherent.left).toBe(true);
    expect(justBelowSmile.adherent.left).toBe(false);
    expect(exactClosed.closed.left).toBe(true);
    expect(exactRecovered.recovered.left).toBe(true);
  });

  it("weights accepted task evidence by time instead of camera burst density", () => {
    const baseline = createNeutralFacialBaseline(
      syntheticTaskFrames("neutral-face", 0)
    );
    const smileFrames = [
      2_000,
      2_167,
      2_333,
      2_500,
      ...Array.from({ length: 100 }, (_, index) => 2_501 + index * 10)
    ].map((tMs, index) =>
      syntheticFacialFrame(tMs, "smile", {
        mouthCorners:
          index < 4
            ? {
                left: { x: 0.34, y: 0.1 },
                right: { x: -0.34, y: 0.1 }
              }
            : {
                left: { x: 0.3, y: 0.1 },
                right: { x: -0.3, y: 0.1 }
              }
      })
    );
    const eyeFrames = [
      4_000,
      4_150,
      4_300,
      ...Array.from({ length: 120 }, (_, index) => 4_301 + index * 10)
    ].map((tMs, index) =>
      syntheticFacialFrame(tMs, "eye-closure", {
        eyeAperture:
          index < 3
            ? { left: 0.15, right: 0.15 }
            : { left: 0.3, right: 0.3 }
      })
    );

    const smile = evaluateSmileAdherence(baseline, smileFrames);
    const closure = evaluateEyeClosureAdherence(baseline, eyeFrames);

    expect(smile.observed).toBe(true);
    expect(smile.excursions).toEqual({
      left: expect.closeTo(0.04),
      right: expect.closeTo(0.04)
    });
    expect(closure.observed).toBe(true);
    expect(closure.closureFractions).toEqual({
      left: expect.closeTo(0.5),
      right: expect.closeTo(0.5)
    });
  });

  it("withholds live adherence values across visual processor references", () => {
    const baseline = createNeutralFacialBaseline(
      syntheticTaskFrames("neutral-face", 0)
    );
    const incompatible = syntheticFacialFrame(2_000, "smile", {
      processorRef: "different-processor",
      mouthCorners: {
        left: { x: 0.5, y: 0.1 },
        right: { x: -0.5, y: 0.1 }
      }
    });

    expect(evaluateSmileAdherence(baseline, [incompatible])).toMatchObject({
      observed: false,
      processorCompatible: false,
      adherent: { left: false, right: false },
      excursions: { left: null, right: null }
    });
  });

  it("emits the six bilateral neutral-referenced task measurements", () => {
    const result = extract();
    expect(result.abstentions).toEqual([]);
    expect(result.measurements.map((measurement) => measurement.code)).toEqual([
      "prototype.face.smile_excursion.left",
      "prototype.face.smile_excursion.right",
      "prototype.face.smile_excursion.asymmetry",
      "prototype.face.eye_closure_fraction.left",
      "prototype.face.eye_closure_fraction.right",
      "prototype.face.eye_closure_fraction.asymmetry"
    ]);

    const byCode = new Map(
      result.measurements.map((measurement) => [
        measurement.code,
        measurement
      ])
    );
    expect(
      byCode.get("prototype.face.eye_closure_fraction.left")?.value
    ).toBeCloseTo(0.8);
    expect(
      byCode.get("prototype.face.eye_closure_fraction.right")?.value
    ).toBeCloseTo(0.7);
    expect(
      byCode.get("prototype.face.eye_closure_fraction.asymmetry")?.value
    ).toBeCloseTo(0.1);
    for (const measurement of result.measurements) {
      expect(measurement.uncertainty).toMatchObject({
        kind: "estimated",
        method: "median-absolute-deviation"
      });
      expect(measurement.sourceWindowRefs).toHaveLength(2);
      expect(measurement.processorRef).toContain("mediapipe-face-landmarker");
    }
  });

  it("keeps subject-left and subject-right movement independent", () => {
    const face = [
      ...syntheticTaskFrames("neutral-face", 0),
      ...syntheticTaskFrames("smile", 2_000, () => ({
        mouthCorners: {
          left: { x: 0.38, y: 0.1 },
          right: { x: -0.3, y: 0.1 }
        }
      }))
    ];
    const result = extract(face);
    const byCode = new Map(
      result.measurements.map((measurement) => [
        measurement.code,
        measurement.value
      ])
    );
    expect(byCode.get("prototype.face.smile_excursion.left")).toBeCloseTo(
      0.08
    );
    expect(byCode.get("prototype.face.smile_excursion.right")).toBe(0);
    expect(
      byCode.get("prototype.face.smile_excursion.asymmetry")
    ).toBeCloseTo(0.08);
  });

  it("abstains only the task whose adherence check is not observed", () => {
    const face = [
      ...syntheticTaskFrames("neutral-face", 0),
      ...syntheticTaskFrames("smile", 2_000),
      ...syntheticTaskFrames("eye-closure", 4_000, () => ({
        eyeAperture: { left: 0.06, right: 0.06 }
      }))
    ];
    const result = extract(face);
    expect(result.abstentions).toEqual([
      expect.objectContaining({
        contextKind: "smile",
        reasonCode: "smile-not-observed"
      })
    ]);
    expect(
      result.measurements.every((measurement) =>
        measurement.code.includes("eye_closure")
      )
    ).toBe(true);
  });

  it("abstains active tasks when the neutral baseline is missing", () => {
    const face = [
      ...syntheticTaskFrames("smile", 0, () => ({
        mouthCorners: {
          left: { x: 0.38, y: 0.1 },
          right: { x: -0.38, y: 0.1 }
        }
      })),
      ...syntheticTaskFrames("eye-closure", 2_000, () => ({
        eyeAperture: { left: 0.06, right: 0.06 }
      }))
    ];
    const result = extract(face);
    expect(result.measurements).toEqual([]);
    expect(
      result.abstentions.map((abstention) => abstention.reasonCode)
    ).toEqual(["missing-neutral-baseline", "missing-neutral-baseline"]);
  });

  it("preserves a valid side when the other eye has invalid numeric input", () => {
    const face = [
      ...syntheticTaskFrames("neutral-face", 0),
      ...syntheticTaskFrames("eye-closure", 2_000, () => ({
        eyeAperture: { left: Number.NaN, right: 0.06 }
      }))
    ];
    const result = extract(face);
    expect(result.measurements.map((measurement) => measurement.code)).toEqual([
      "prototype.face.eye_closure_fraction.right"
    ]);
    expect(result.abstentions).toEqual([
      expect.objectContaining({
        reasonCode: "invalid-facial-kinematics",
        measurementCodes: expect.arrayContaining([
          "prototype.face.eye_closure_fraction.left",
          "prototype.face.eye_closure_fraction.asymmetry"
        ])
      })
    ]);
  });
});
