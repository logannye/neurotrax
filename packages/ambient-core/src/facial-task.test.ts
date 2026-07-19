import { describe, expect, it } from "vitest";
import { extractFacialTaskMeasurements } from "./facial-task.js";
import { syntheticFrameStream, syntheticTaskFrames } from "./test-helpers.js";
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
