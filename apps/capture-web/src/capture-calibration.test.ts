import { describe, expect, it } from "vitest";
import type { FaceLandmarkFrame } from "@neurotrax/ambient-core";
import {
  calibrateFaceFrame,
  classifyAudioCalibration,
  classifyFaceCalibration,
  createFaceCalibration,
  facePreflightPassed,
  preflightFaceGuidance
} from "./capture-calibration.js";

function face(
  overrides: Partial<FaceLandmarkFrame> = {}
): FaceLandmarkFrame {
  return {
    tMs: 0,
    faceVisible: true,
    framingFraction: 1,
    illumination: 0.58,
    yawDegrees: 4,
    eyeAspectRatio: 0.3,
    browRaise: 0.2,
    mouthOpen: 0.1,
    landmarkMotion: 0.03,
    observedFrameRate: 10,
    faceBoxWidth: 0.2,
    faceBoxHeight: 0.36,
    edgeMargin: 0.08,
    ...overrides
  };
}

describe("guided face calibration", () => {
  it("classifies eight reliable pitch frames as strong without waiting for ten", () => {
    expect(classifyAudioCalibration(8, 8)).toBe("strong");
    expect(classifyAudioCalibration(7, 9)).toBe("limited");
    expect(classifyAudioCalibration(0, 0)).toBe("unavailable");
  });

  it("accepts a stable face that is smaller than the old fixed target", () => {
    const frames = Array.from({ length: 15 }, (_, index) =>
      face({ tMs: index * 100 })
    );
    expect(facePreflightPassed(frames)).toBe(true);
    const calibration = createFaceCalibration(frames);
    expect(calibration.baselineBoxWidth).toBeCloseTo(0.2);
    expect(calibrateFaceFrame(face(), calibration).usable).toBe(true);
  });

  it("returns specific correction guidance", () => {
    expect(preflightFaceGuidance(face({ faceVisible: false }))).toBe(
      "Move into view"
    );
    expect(preflightFaceGuidance(face({ faceBoxWidth: 0.1 }))).toBe(
      "Move closer"
    );
    expect(preflightFaceGuidance(face({ edgeMargin: 0.005 }))).toBe(
      "Center your face"
    );
    expect(preflightFaceGuidance(face({ yawDegrees: 35 }))).toBe(
      "Face the camera"
    );
    expect(preflightFaceGuidance(face({ illumination: 0.05 }))).toBe(
      "Add light"
    );
  });

  it("withholds an off-axis interval and accepts recovery", () => {
    const baseline = createFaceCalibration(
      Array.from({ length: 15 }, () => face())
    );
    expect(
      calibrateFaceFrame(face({ yawDegrees: 48 }), baseline).usable
    ).toBe(false);
    expect(calibrateFaceFrame(face({ yawDegrees: 5 }), baseline).usable).toBe(
      true
    );
  });

  it("classifies incomplete facial checks without blocking", () => {
    expect(classifyFaceCalibration([])).toEqual({
      quality: "unavailable",
      calibration: null,
      usableFrameCount: 0
    });
    const limited = classifyFaceCalibration([
      face(),
      face({ edgeMargin: 0.005 }),
      face({ yawDegrees: 35 })
    ]);
    expect(limited.quality).toBe("limited");
    expect(limited.calibration).not.toBeNull();
  });
});
