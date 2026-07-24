import { describe, expect, it } from "vitest";
import { FaceMeshGLRenderer } from "./face-mesh-gl.js";

describe("FaceMeshGLRenderer", () => {
  it("attach returns false and stays unattached when webgl2 is unavailable", () => {
    const renderer = new FaceMeshGLRenderer();
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => null
    } as unknown as OffscreenCanvas;
    expect(renderer.attach(canvas, 24)).toBe(false);
    expect(renderer.isAttached()).toBe(false);
    expect(renderer.drawFrame(0, 1).rendered).toBe(false);
  });
});
