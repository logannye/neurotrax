import { describe, expect, it } from "vitest";
import { extractFacialExpressivity, FACIAL_EXPRESSIVITY_VERSION } from "./facial-expressivity.js";
import type { FaceLandmarkFrame } from "./primitives.js";
import type { Abstention, MeasurableWindow, Measurement } from "@phenometric/contracts";

const window: MeasurableWindow = {
  windowId: "w-face-1",
  modality: "face",
  startMs: 0,
  endMs: 60000,
  context: {
    kind: "listening-expressive",
    confounds: {
      snrDb: 20,
      faceFramingFraction: 0.95,
      observedFrameRate: 30,
      illuminationRelative: 0.8,
      yawDegrees: 0
    }
  }
};

function faceFrame(tMs: number, ear: number, motion: number, brow: number, framing = 0.95): FaceLandmarkFrame {
  return {
    tMs, faceVisible: framing >= 0.5, framingFraction: framing, illumination: 0.8,
    eyeAspectRatio: ear, browRaise: brow, mouthOpen: 0.08 + tMs / 100_000, landmarkMotion: motion, observedFrameRate: 30
  };
}

describe("extractFacialExpressivity", () => {
  it("emits facial motor measurements and counts one blink over a 60s window", () => {
    const frames = [
      faceFrame(0, 0.3, 0.05, 0.2), faceFrame(1000, 0.1, 0.06, 0.3),
      faceFrame(2000, 0.3, 0.04, 0.1), faceFrame(3000, 0.3, 0.05, 0.25)
    ];
    const result = extractFacialExpressivity(window, frames) as Measurement[];
    const byCode = new Map(result.map((m) => [m.code, m]));
    expect(byCode.get("prototype.face.expressivity")!.value).toBeCloseTo(0.05, 5);
    expect(byCode.get("prototype.face.blink_rate")!.value).toBe(1);
    expect(byCode.get("prototype.face.brow_amplitude")!.value).toBeCloseTo(0.2, 5);
    expect(
      byCode.get("prototype.face.mouth_amplitude")!.value
    ).toBeGreaterThan(0);
    expect(
      byCode.get("prototype.face.eye_aperture_range")!.value
    ).toBeCloseTo(0.2, 5);
    for (const m of result) {
      expect(m.algorithmVersion).toBe(FACIAL_EXPRESSIVITY_VERSION);
      expect(m.clinicalValidation).toBe("none");
    }
  });

  it("abstains when the face is poorly framed", () => {
    // framing 0.55 keeps the face visible (>= 0.5) but below the 0.6 framing floor,
    // so the face-not-framed guard fires rather than face-not-visible.
    const frames = [faceFrame(0, 0.3, 0.05, 0.2, 0.55), faceFrame(1000, 0.3, 0.05, 0.2, 0.55), faceFrame(2000, 0.3, 0.05, 0.2, 0.55)];
    const result = extractFacialExpressivity(window, frames) as Abstention;
    expect(result.reasonCode).toBe("face-not-framed");
  });
});
