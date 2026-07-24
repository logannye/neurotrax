import {
  createVisualWorkerAttachOverlayMessage,
  createVisualWorkerClearOverlayMessage
} from "./face-worker-protocol.js";

export const LIVE_FACE_MESH_RENDER_HZ = 24;

export type FaceMeshDisplayState =
  | "inactive"
  | "searching"
  | "active"
  | "unavailable";

type OverlayWorker = Pick<Worker, "postMessage">;

export class FaceOverlayController {
  private canvas: HTMLCanvasElement;
  private readonly status: HTMLElement;
  private worker: OverlayWorker | null = null;
  private captureEpoch: number | null = null;
  private transferred = false;
  private attached = false;
  private readonly createCanvas: () => HTMLCanvasElement;

  constructor(
    canvas: HTMLCanvasElement,
    status: HTMLElement,
    createCanvas: () => HTMLCanvasElement = () => document.createElement("canvas")
  ) {
    this.canvas = canvas;
    this.status = status;
    this.createCanvas = createCanvas;
    this.setState("inactive");
  }

  currentCanvas(): HTMLCanvasElement {
    return this.canvas;
  }

  attach(worker: OverlayWorker, captureEpoch: number): boolean {
    this.worker = worker;
    this.captureEpoch = captureEpoch;
    this.attached = false;
    this.canvas.hidden = true;
    this.setState("searching");

    const transferable = this.canvas as HTMLCanvasElement & {
      transferControlToOffscreen?: () => OffscreenCanvas;
    };
    if (typeof transferable.transferControlToOffscreen !== "function") {
      this.setState("unavailable");
      return false;
    }

    try {
      const offscreen = transferable.transferControlToOffscreen();
      this.transferred = true;
      worker.postMessage(
        createVisualWorkerAttachOverlayMessage(
          captureEpoch,
          offscreen,
          LIVE_FACE_MESH_RENDER_HZ
        ),
        [offscreen]
      );
      return true;
    } catch {
      this.setState("unavailable");
      return false;
    }
  }

  acknowledge(captureEpoch: number, attached: boolean): void {
    if (captureEpoch !== this.captureEpoch) return;
    this.attached = attached;
    this.canvas.hidden = !attached;
    this.setState(attached ? "searching" : "unavailable");
  }

  updateFaceCount(faceCount: number): void {
    if (!this.attached) return;
    this.canvas.hidden = false;
    this.setState(faceCount === 1 ? "active" : "searching");
  }

  markUnavailable(): void {
    this.attached = false;
    this.canvas.hidden = true;
    this.setState("unavailable");
  }

  clear(): void {
    this.canvas.hidden = true;
    if (
      this.transferred &&
      this.worker &&
      this.captureEpoch !== null
    ) {
      try {
        this.worker.postMessage(
          createVisualWorkerClearOverlayMessage(this.captureEpoch)
        );
      } catch {
        // A terminated worker has already released the display surface.
      }
    } else if (!this.transferred) {
      this.canvas
        .getContext("2d")
        ?.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }
    this.attached = false;
    this.setState("inactive");
  }

  releaseWorker(): void {
    this.worker = null;
    this.captureEpoch = null;
    this.attached = false;
    this.canvas.hidden = true;
    this.setState("inactive");
  }

  resetCanvas(): void {
    this.clear();
    this.releaseWorker();
    if (!this.transferred) return;

    const replacement = this.createCanvas();
    replacement.id = this.canvas.id;
    replacement.className = this.canvas.className;
    replacement.setAttribute("aria-hidden", "true");
    replacement.hidden = true;
    this.canvas.replaceWith(replacement);
    this.canvas = replacement;
    this.transferred = false;
  }

  private setState(state: FaceMeshDisplayState): void {
    this.status.dataset.state = state;
    this.status.hidden = state === "inactive";
    this.status.textContent =
      state === "active"
        ? "◆ TRACKING · 478 pts"
        : state === "searching"
          ? "◇ LOCATING…"
          : state === "unavailable"
            ? "Mesh display unavailable"
            : "";
  }
}
