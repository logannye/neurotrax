import { describe, expect, it, vi } from "vitest";
import {
  FaceOverlayController,
  LIVE_FACE_MESH_RENDER_HZ
} from "./face-overlay-controller.js";

function fixture(options: { transferable?: boolean } = {}) {
  const offscreen = { surface: "mesh" } as unknown as OffscreenCanvas;
  const context = { clearRect: vi.fn() };
  const replacement = {
    id: "",
    className: "",
    hidden: false,
    setAttribute: vi.fn(),
    replaceWith: vi.fn(),
    getContext: vi.fn(() => context)
  } as unknown as HTMLCanvasElement;
  const canvas = {
    id: "landmark-overlay",
    className: "landmark-overlay",
    hidden: false,
    width: 640,
    height: 360,
    replaceWith: vi.fn(),
    getContext: vi.fn(() => context),
    ...(options.transferable === false
      ? {}
      : { transferControlToOffscreen: vi.fn(() => offscreen) })
  } as unknown as HTMLCanvasElement;
  const status = {
    dataset: {} as DOMStringMap,
    hidden: true,
    textContent: ""
  } as HTMLElement;
  const worker = { postMessage: vi.fn() };
  return {
    canvas,
    status,
    worker,
    offscreen,
    replacement,
    controller: new FaceOverlayController(canvas, status, () => replacement)
  };
}

describe("FaceOverlayController", () => {
  it("transfers the canvas once and waits for worker acknowledgement", () => {
    const item = fixture();

    expect(item.controller.attach(item.worker, 7)).toBe(true);
    expect(item.worker.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "attach-overlay",
        captureEpoch: 7,
        canvas: item.offscreen,
        maxRenderHz: LIVE_FACE_MESH_RENDER_HZ
      }),
      [item.offscreen]
    );
    expect(item.canvas.hidden).toBe(true);
    expect(item.status.textContent).toBe("Looking for one face");

    item.controller.acknowledge(7, true);
    expect(item.canvas.hidden).toBe(false);
    item.controller.updateFaceCount(1);
    expect(item.status.textContent).toBe("Face mesh active");
    item.controller.updateFaceCount(2);
    expect(item.status.textContent).toBe("Looking for one face");
  });

  it("ignores stale acknowledgements and fails presentation closed", () => {
    const item = fixture({ transferable: false });

    expect(item.controller.attach(item.worker, 4)).toBe(false);
    expect(item.status.textContent).toBe("Mesh display unavailable");
    item.controller.acknowledge(3, true);
    expect(item.canvas.hidden).toBe(true);
  });

  it("clears the worker surface and replaces a transferred canvas on reset", () => {
    const item = fixture();
    item.controller.attach(item.worker, 9);
    item.controller.acknowledge(9, true);

    item.controller.resetCanvas();

    expect(item.worker.postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({
        type: "clear-overlay",
        captureEpoch: 9
      })
    );
    expect(item.canvas.replaceWith).toHaveBeenCalledWith(item.replacement);
    expect(item.controller.currentCanvas()).toBe(item.replacement);
    expect(item.replacement.hidden).toBe(true);
  });
});
