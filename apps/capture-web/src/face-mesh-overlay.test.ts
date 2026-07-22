import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import { describe, expect, it, vi } from "vitest";
import {
  FACE_MESH_LANDMARK_COUNT,
  FaceMeshOverlayRenderer,
  MAX_FACE_MESH_RENDER_HZ,
  faceMeshPresentationEligible
} from "./face-mesh-overlay.js";

function landmarks(): NormalizedLandmark[] {
  return Array.from(
    { length: FACE_MESH_LANDMARK_COUNT },
    (_, index) => landmarkAt(index)
  );
}

function landmarkAt(index: number): NormalizedLandmark {
  return {
    x: 0.2 + (index % 24) * 0.025,
    y: 0.15 + Math.floor(index / 24) * 0.035,
    z: 0,
    visibility: 1
  };
}

function canvasFixture() {
  const calls = {
    moveTo: [] as Array<[number, number]>,
    lineTo: [] as Array<[number, number]>,
    arc: [] as Array<[number, number, number, number, number]>,
    strokeWidths: [] as number[]
  };
  const context = {
    clearRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn((x: number, y: number) => {
      calls.moveTo.push([x, y]);
    }),
    lineTo: vi.fn((x: number, y: number) => {
      calls.lineTo.push([x, y]);
    }),
    arc: vi.fn(
      (
        x: number,
        y: number,
        radius: number,
        start: number,
        end: number
      ) => {
        calls.arc.push([x, y, radius, start, end]);
      }
    ),
    stroke: vi.fn(() => {
      calls.strokeWidths.push(context.lineWidth);
    }),
    fill: vi.fn(),
    lineCap: "butt",
    lineJoin: "miter",
    strokeStyle: "",
    fillStyle: "",
    lineWidth: 1
  };
  const canvas = {
    width: 0,
    height: 0,
    getContext: vi.fn(() => context)
  } as unknown as OffscreenCanvas;
  return { canvas, context, calls };
}

describe("FaceMeshOverlayRenderer", () => {
  it("keeps display eligibility independent from measurement-quality warnings", () => {
    const warningFrame = {
      faceCount: 1,
      qualityReasons: ["blur", "illumination-out-of-range"]
    };
    expect(
      faceMeshPresentationEligible(warningFrame.faceCount, 3, 3)
    ).toBe(true);
    expect(faceMeshPresentationEligible(0, 3, 3)).toBe(false);
    expect(faceMeshPresentationEligible(2, 3, 3)).toBe(false);
    expect(faceMeshPresentationEligible(1, 3, 2)).toBe(false);
  });

  it("draws every landmark and the complete MediaPipe tessellation", () => {
    const renderer = new FaceMeshOverlayRenderer();
    const fixture = canvasFixture();
    expect(renderer.attach(fixture.canvas, 12)).toBe(true);

    const result = renderer.render({
      landmarks: landmarks(),
      taskContext: "neutral-face",
      width: 1_280,
      height: 720,
      acquiredAtMs: 1_000
    });

    expect(result).toEqual({
      rendered: true,
      landmarkDots: 478,
      tessellationEdges: 2_556,
      accentAnchors: 14
    });
    expect(fixture.canvas.width).toBe(1_280);
    expect(fixture.canvas.height).toBe(720);
    expect(fixture.context.stroke).toHaveBeenCalledTimes(5);
  });

  it("caps rendering at twenty-four hertz even when a higher rate is requested", () => {
    const renderer = new FaceMeshOverlayRenderer();
    const fixture = canvasFixture();
    renderer.attach(fixture.canvas, 60);
    const input = {
      landmarks: landmarks(),
      taskContext: "establishing" as const,
      width: 640,
      height: 360
    };

    expect(
      renderer.render({ ...input, acquiredAtMs: 1_000 }).rendered
    ).toBe(true);
    expect(
      renderer.render({ ...input, acquiredAtMs: 1_041 }).rendered
    ).toBe(false);
    expect(
      renderer.render({ ...input, acquiredAtMs: 1_042 }).rendered
    ).toBe(true);
    expect(MAX_FACE_MESH_RENDER_HZ).toBe(24);
  });

  it("rejects non-finite points and preserves unmirrored coordinates", () => {
    const renderer = new FaceMeshOverlayRenderer();
    const fixture = canvasFixture();
    renderer.attach(fixture.canvas, 12);
    const points = landmarks();
    points[10] = {
      x: Number.NaN,
      y: 0.5,
      z: 0,
      visibility: 1
    };

    const result = renderer.render({
      landmarks: points,
      taskContext: "turn-away",
      width: 100,
      height: 200,
      acquiredAtMs: 2_000
    });

    expect(result.landmarkDots).toBe(477);
    expect(result.tessellationEdges).toBeLessThan(2_556);
    expect(fixture.calls.arc[0]?.[0]).toBeCloseTo(20);
    expect(fixture.calls.arc[0]?.[1]).toBeCloseTo(30);
    expect(
      [...fixture.calls.moveTo, ...fixture.calls.lineTo]
        .flat()
        .every(Number.isFinite)
    ).toBe(true);
  });

  it("uses task-specific measurement anchors and clears immediately", () => {
    const renderer = new FaceMeshOverlayRenderer();
    const fixture = canvasFixture();
    renderer.attach(fixture.canvas, 12);
    const input = {
      landmarks: landmarks(),
      width: 640,
      height: 360
    };

    expect(
      renderer.render({
        ...input,
        taskContext: "smile",
        acquiredAtMs: 1_000
      }).accentAnchors
    ).toBe(2);
    renderer.clear();
    expect(
      renderer.render({
        ...input,
        taskContext: "eye-closure",
        acquiredAtMs: 1_010
      }).accentAnchors
    ).toBe(12);
    renderer.clear();
    expect(
      renderer.render({
        ...input,
        taskContext: "turn-away",
        acquiredAtMs: 1_020
      }).accentAnchors
    ).toBe(0);
    expect(fixture.context.clearRect).toHaveBeenCalled();
  });

  it("accents the exact eye-aperture measurement landmarks", () => {
    const renderer = new FaceMeshOverlayRenderer();
    const fixture = canvasFixture();
    renderer.attach(fixture.canvas, 12);
    const width = 640;
    const height = 360;

    const result = renderer.render({
      landmarks: landmarks(),
      taskContext: "eye-closure",
      width,
      height,
      acquiredAtMs: 1_000
    });

    const expectedIndices = [
      362, 263, 385, 380, 387, 373,
      33, 133, 160, 144, 158, 153
    ];
    const accentCenters = fixture.calls.arc
      .slice(-expectedIndices.length)
      .map(([x, y]) => [x, y]);
    expect(accentCenters).toEqual(
      expectedIndices.map((index) => {
        const landmark = landmarkAt(index);
        return [landmark.x * width, landmark.y * height];
      })
    );
    expect(result.accentAnchors).toBe(expectedIndices.length);
  });

  it("emphasizes the semantic region associated with the active task", () => {
    const smileRenderer = new FaceMeshOverlayRenderer();
    const smileFixture = canvasFixture();
    smileRenderer.attach(smileFixture.canvas, 12);
    smileRenderer.render({
      landmarks: landmarks(),
      taskContext: "smile",
      width: 640,
      height: 360,
      acquiredAtMs: 1_000
    });

    // Stroke order: tessellation, eyes, brows, lips, face oval.
    expect(smileFixture.calls.strokeWidths[3]).toBeGreaterThan(
      smileFixture.calls.strokeWidths[1] ?? Number.POSITIVE_INFINITY
    );

    const eyeRenderer = new FaceMeshOverlayRenderer();
    const eyeFixture = canvasFixture();
    eyeRenderer.attach(eyeFixture.canvas, 12);
    eyeRenderer.render({
      landmarks: landmarks(),
      taskContext: "eye-closure",
      width: 640,
      height: 360,
      acquiredAtMs: 1_000
    });

    expect(eyeFixture.calls.strokeWidths[1]).toBeGreaterThan(
      eyeFixture.calls.strokeWidths[3] ?? Number.POSITIVE_INFINITY
    );
  });

  it("falls back cleanly when a transferred canvas has no 2D context", () => {
    const renderer = new FaceMeshOverlayRenderer();
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => null
    } as unknown as OffscreenCanvas;

    expect(renderer.attach(canvas, 12)).toBe(false);
    expect(renderer.isAttached()).toBe(false);
    expect(
      renderer.render({
        landmarks: landmarks(),
        taskContext: "establishing",
        width: 640,
        height: 360,
        acquiredAtMs: 1_000
      }).rendered
    ).toBe(false);
  });
});
