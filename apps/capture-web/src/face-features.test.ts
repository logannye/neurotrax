import type {
  Category,
  FaceLandmarkerResult,
  NormalizedLandmark
} from "@mediapipe/tasks-vision";
import { describe, expect, it } from "vitest";
import { deriveFaceFeature } from "./face-features.js";

function landmarks(noseX = 0.5): NormalizedLandmark[] {
  const values = Array.from({ length: 478 }, (_, index) => ({
    x: 0.35 + ((index % 20) / 19) * 0.3,
    y: 0.25 + ((Math.floor(index / 20) % 24) / 23) * 0.5,
    z: 0,
    visibility: 1
  }));
  values[234] = { x: 0.35, y: 0.5, z: 0, visibility: 1 };
  values[454] = { x: 0.65, y: 0.5, z: 0, visibility: 1 };
  values[1] = { x: noseX, y: 0.5, z: 0, visibility: 1 };
  values[33] = { x: 0.42, y: 0.43, z: 0, visibility: 1 };
  values[263] = { x: 0.58, y: 0.43, z: 0, visibility: 1 };
  return values;
}

function result(
  faceLandmarks: NormalizedLandmark[][],
  categories: Category[] = []
): FaceLandmarkerResult {
  return {
    faceLandmarks,
    faceBlendshapes:
      faceLandmarks.length === 0 ? [] : [{ categories, headIndex: 0 }],
    facialTransformationMatrixes: []
  } as unknown as FaceLandmarkerResult;
}

describe("deriveFaceFeature", () => {
  it("returns a complete withheld primitive when no face is visible", () => {
    const derived = deriveFaceFeature(result([]), {
      tMs: 100,
      illumination: 0.5,
      observedFrameRate: 10
    });

    expect(derived.frame).toMatchObject({
      faceVisible: false,
      framingFraction: 0,
      yawDegrees: 0,
      illumination: 0.5
    });
    expect(derived.overlayPoints).toEqual([]);
  });

  it("derives framing, blendshape proxies, and normalized motion", () => {
    const categories = [
      { categoryName: "eyeBlinkLeft", score: 0.2 },
      { categoryName: "eyeBlinkRight", score: 0.4 },
      { categoryName: "browInnerUp", score: 0.35 },
      { categoryName: "jawOpen", score: 0.25 }
    ] as Category[];
    const first = deriveFaceFeature(result([landmarks()], categories), {
      tMs: 0,
      illumination: 0.62,
      observedFrameRate: 10
    });
    const moved = landmarks();
    moved[13] = { ...moved[13], y: moved[13].y + 0.02 };
    const second = deriveFaceFeature(result([moved], categories), {
      tMs: 100,
      illumination: 0.62,
      observedFrameRate: 10,
      state: first.nextState
    });

    expect(first.frame.faceVisible).toBe(true);
    expect(first.frame.framingFraction).toBeGreaterThan(0.6);
    expect(first.frame.yawDegrees).toBeCloseTo(0);
    expect(first.frame.eyeAspectRatio).toBeCloseTo(0.7);
    expect(first.frame.browRaise).toBeCloseTo(0.35);
    expect(first.frame.mouthOpen).toBeCloseTo(0.25);
    expect(second.frame.landmarkMotion).toBeGreaterThan(0);
  });

  it("maps an off-axis nose position beyond the 30 degree quality limit", () => {
    const derived = deriveFaceFeature(result([landmarks(0.62)]), {
      tMs: 0,
      illumination: 0.55,
      observedFrameRate: 10
    });

    expect(Math.abs(derived.frame.yawDegrees ?? 0)).toBeGreaterThan(30);
  });
});
