import { describe, expect, it, vi } from "vitest";
import { CaptureRuntime, withTimeout } from "./capture-runtime.js";

describe("CaptureRuntime", () => {
  it("disposes in privacy-safe order, stops every track, and is idempotent", async () => {
    const order: string[] = [];
    const tracks = [
      { stop: vi.fn(() => order.push("track-a")) },
      { stop: vi.fn(() => order.push("track-b")) }
    ];
    const stream = { getTracks: () => tracks } as unknown as MediaStream;
    const video = {
      pause: vi.fn(() => order.push("video")),
      srcObject: stream
    } as unknown as HTMLVideoElement;
    const audioContext = {
      state: "running",
      close: vi.fn(async () => {
        order.push("audio-context");
      })
    } as unknown as AudioContext;
    const runtime = new CaptureRuntime();
    runtime.attach({
      cancelTimers: () => order.push("timers"),
      stopFacePump: () => order.push("pump"),
      stopVoicePipeline: async () => {
        order.push("voice");
      },
      disposeFaceWorker: async () => {
        order.push("face-worker");
      },
      streams: [stream],
      video,
      disconnectAudio: () => order.push("audio-nodes"),
      audioContext
    });

    const first = runtime.dispose(false);
    const second = runtime.dispose(false);
    expect(first).toBe(second);
    await first;
    expect(order).toEqual([
      "timers",
      "pump",
      "voice",
      "face-worker",
      "track-a",
      "track-b",
      "video",
      "audio-nodes",
      "audio-context"
    ]);
    expect(await runtime.dispose(false)).toBeNull();
  });

  it("freezes a derived-only snapshot and clears runtime ownership", async () => {
    const runtime = new CaptureRuntime();
    runtime.addVoiceFrame({ sequence: 1 } as never);
    runtime.addFaceFrame({ sequence: 2 } as never);
    const snapshot = await runtime.dispose(true);
    expect(snapshot?.voice).toHaveLength(1);
    expect(snapshot?.face).toHaveLength(1);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot?.voice)).toBe(true);
  });

  it("uses a bounded worker-disposal fallback", async () => {
    vi.useFakeTimers();
    const resultPromise = withTimeout(
      new Promise<string>(() => undefined),
      500,
      () => "terminated"
    );
    await vi.advanceTimersByTimeAsync(500);
    await expect(resultPromise).resolves.toBe("terminated");
    vi.useRealTimers();
  });
});
