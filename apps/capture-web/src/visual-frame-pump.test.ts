import { describe, expect, it, vi } from "vitest";
import {
  LatestFrameScheduler,
  OverlayRenderThrottle,
  VideoFramePump,
  VisualLaneGuard,
  VisualResultAcceptanceGuard,
  VisualWorkerRestartBudget,
  type ScheduledVisualFrame,
  type VideoFrameCallbackMetadataLike
} from "./visual-frame-pump.js";

class FakeFrame {
  closed = false;

  constructor(readonly id: string) {}

  close(): void {
    this.closed = true;
  }
}

function offered(frame: FakeFrame, acquisitionTimestampMs: number) {
  return {
    frame,
    acquisitionTimestampMs,
    width: 1280,
    height: 720
  };
}

describe("LatestFrameScheduler", () => {
  it("keeps one request in flight and replaces only the pending frame", () => {
    const submitted: ScheduledVisualFrame<FakeFrame>[] = [];
    const scheduler = new LatestFrameScheduler<FakeFrame>({
      captureEpoch: 7,
      onSubmit: (frame) => submitted.push(frame)
    });
    const first = new FakeFrame("first");
    const second = new FakeFrame("second");
    const latest = new FakeFrame("latest");

    expect(scheduler.offer(offered(first, 100))).toBe(true);
    expect(scheduler.offer(offered(second, 133))).toBe(false);
    expect(scheduler.offer(offered(latest, 166))).toBe(false);

    expect(submitted).toHaveLength(1);
    expect(second.closed).toBe(true);
    expect(latest.closed).toBe(false);
    expect(scheduler.diagnostics(166)).toMatchObject({
      presented: 3,
      submitted: 1,
      processed: 0,
      skipped: 1
    });

    expect(
      scheduler.accept({
        captureEpoch: 7,
        sequence: 1,
        acquisitionTimestampMs: 100
      })
    ).toBe(true);
    expect(submitted.map((item) => item.frame.id)).toEqual([
      "first",
      "latest"
    ]);
    expect(submitted[1]).toMatchObject({
      captureEpoch: 7,
      sequence: 2,
      acquisitionTimestampMs: 166
    });
  });

  it("rejects non-monotonic frames and stale epoch or sequence responses", () => {
    const submitted: ScheduledVisualFrame<FakeFrame>[] = [];
    const scheduler = new LatestFrameScheduler<FakeFrame>({
      captureEpoch: 3,
      onSubmit: (frame) => submitted.push(frame)
    });
    scheduler.offer(offered(new FakeFrame("active"), 200));
    const regressed = new FakeFrame("regressed");

    expect(scheduler.offer(offered(regressed, 199))).toBe(false);
    expect(regressed.closed).toBe(true);
    expect(
      scheduler.accept({
        captureEpoch: 2,
        sequence: 1,
        acquisitionTimestampMs: 200
      })
    ).toBe(false);
    expect(
      scheduler.accept({
        captureEpoch: 3,
        sequence: 99,
        acquisitionTimestampMs: 200
      })
    ).toBe(false);
    expect(scheduler.activeRequest?.sequence).toBe(1);
    expect(scheduler.diagnostics(200).stale).toBe(3);
  });

  it("releases the matching request when the worker explicitly discards it", () => {
    const submitted: ScheduledVisualFrame<FakeFrame>[] = [];
    const scheduler = new LatestFrameScheduler<FakeFrame>({
      captureEpoch: 3,
      onSubmit: (frame) => submitted.push(frame)
    });
    scheduler.offer(offered(new FakeFrame("active"), 200));
    scheduler.offer(offered(new FakeFrame("pending"), 233));

    expect(
      scheduler.discard({
        captureEpoch: 3,
        sequence: 1,
        acquisitionTimestampMs: 200
      })
    ).toBe(true);
    expect(submitted.at(-1)?.sequence).toBe(2);
    expect(scheduler.diagnostics(233)).toMatchObject({
      stale: 1,
      submitted: 2
    });
  });

  it("calculates source-time cadence, gaps, and rolling busy-drop fraction", () => {
    const scheduler = new LatestFrameScheduler<FakeFrame>({
      captureEpoch: 1,
      rollingWindowMs: 2_000,
      onSubmit: () => undefined
    });
    for (const timestamp of [0, 50, 100]) {
      scheduler.offer(offered(new FakeFrame(String(timestamp)), timestamp));
      scheduler.accept({
        captureEpoch: 1,
        sequence: timestamp / 50 + 1,
        acquisitionTimestampMs: timestamp
      });
    }
    scheduler.offer(offered(new FakeFrame("150"), 150));
    scheduler.offer(offered(new FakeFrame("175"), 175));
    scheduler.offer(offered(new FakeFrame("200"), 200));

    expect(scheduler.diagnostics(200)).toMatchObject({
      analyzedCadenceHz: 20,
      latestInterResultGapMs: 50,
      maximumInterResultGapMs: 50,
      busyDropFraction: 1 / 6
    });
  });

  it("closes pending data and starts sequence numbers over for a new epoch", () => {
    const submitted: ScheduledVisualFrame<FakeFrame>[] = [];
    const scheduler = new LatestFrameScheduler<FakeFrame>({
      captureEpoch: 1,
      onSubmit: (frame) => submitted.push(frame)
    });
    scheduler.offer(offered(new FakeFrame("active"), 100));
    const pending = new FakeFrame("pending");
    scheduler.offer(offered(pending, 110));

    scheduler.reset(2);
    scheduler.offer(offered(new FakeFrame("new"), 5));

    expect(pending.closed).toBe(true);
    expect(submitted.at(-1)).toMatchObject({
      captureEpoch: 2,
      sequence: 1,
      acquisitionTimestampMs: 5
    });
    expect(scheduler.diagnostics(5)).toMatchObject({
      presented: 1,
      submitted: 1,
      processed: 0,
      skipped: 0,
      stale: 0,
      failed: 0
    });
  });

  it("does not retain transferred frames and closes pending frames on stop", () => {
    const submitted: ScheduledVisualFrame<FakeFrame>[] = [];
    const scheduler = new LatestFrameScheduler<FakeFrame>({
      captureEpoch: 1,
      onSubmit: (frame) => submitted.push(frame)
    });
    const transferred = new FakeFrame("transferred");
    const pending = new FakeFrame("pending");
    scheduler.offer(offered(transferred, 100));
    scheduler.offer(offered(pending, 110));

    scheduler.stop();

    expect(pending.closed).toBe(true);
    expect(transferred.closed).toBe(false);
    expect(scheduler.activeRequest).toBeNull();
    expect(scheduler.diagnostics(110).skipped).toBe(1);
  });

  it("closes an untransferred frame when worker submission throws", () => {
    const frame = new FakeFrame("post-message-failed");
    const scheduler = new LatestFrameScheduler<FakeFrame>({
      captureEpoch: 1,
      onSubmit: () => {
        throw new Error("worker terminated");
      }
    });

    expect(scheduler.offer(offered(frame, 100))).toBe(true);
    expect(frame.closed).toBe(true);
    expect(scheduler.activeRequest).toBeNull();
    expect(scheduler.diagnostics(100)).toMatchObject({
      presented: 1,
      submitted: 1,
      failed: 1
    });
  });
});

describe("visual lane resilience", () => {
  it("rejects same-epoch results acquired before an external withholding boundary", () => {
    const guard = new VisualResultAcceptanceGuard();

    expect(guard.accepts(100)).toBe(true);
    guard.invalidateThrough(150);
    expect(guard.accepts(100)).toBe(false);
    expect(guard.accepts(150)).toBe(false);
    expect(guard.accepts(151)).toBe(true);

    guard.invalidateThrough(125);
    expect(guard.accepts(149)).toBe(false);
    guard.reset();
    expect(guard.accepts(149)).toBe(true);
  });

  it("permits exactly one worker restart per capture", () => {
    const budget = new VisualWorkerRestartBudget();
    expect(budget.requestRestart()).toBe("restart");
    expect(budget.requestRestart()).toBe("withhold");
    budget.reset();
    expect(budget.requestRestart()).toBe("restart");
  });

  it("withholds on visibility, camera, worker, and result-gap failures", () => {
    const guard = new VisualLaneGuard();
    guard.markProcessed(1_000);
    expect(guard.evaluate(1_200).measurable).toBe(true);
    expect(guard.evaluate(1_201).reasons).toEqual(["visual-frame-gap"]);

    guard.markPageVisible(false);
    guard.markCameraAvailable(false);
    guard.markWorkerAvailable(false);
    expect(guard.evaluate(1_201).reasons).toEqual([
      "page-hidden",
      "camera-unavailable",
      "worker-unavailable",
      "visual-frame-gap"
    ]);
  });

  it("throttles overlays independently from inference ingestion", () => {
    const throttle = new OverlayRenderThrottle(12);
    expect(throttle.shouldRender(0)).toBe(true);
    expect(throttle.shouldRender(50)).toBe(false);
    expect(throttle.shouldRender(84)).toBe(true);
    throttle.reset();
    expect(throttle.shouldRender(10)).toBe(true);
  });
});

describe("VideoFramePump", () => {
  it("uses requestVideoFrameCallback presentation time as acquisition time", async () => {
    let callback:
      | ((
          now: number,
          metadata: VideoFrameCallbackMetadataLike
        ) => void)
      | undefined;
    const source = {
      videoWidth: 1280,
      videoHeight: 720,
      requestVideoFrameCallback: vi.fn(
        (
          next: (
            now: number,
            metadata: VideoFrameCallbackMetadataLike
          ) => void
        ) => {
          callback = next;
          return 1;
        }
      ),
      cancelVideoFrameCallback: vi.fn()
    };
    const submitted: ScheduledVisualFrame<FakeFrame>[] = [];
    const scheduler = new LatestFrameScheduler<FakeFrame>({
      captureEpoch: 4,
      onSubmit: (frame) => submitted.push(frame)
    });
    const pump = new VideoFramePump({
      source,
      scheduler,
      capture: async () => new FakeFrame("bitmap")
    });

    pump.start();
    callback?.(880, {
      presentationTime: 875,
      expectedDisplayTime: 900,
      width: 640,
      height: 480
    });
    await Promise.resolve();

    expect(submitted[0]).toMatchObject({
      acquisitionTimestampMs: 875,
      width: 640,
      height: 480
    });
    expect(source.requestVideoFrameCallback).toHaveBeenCalledTimes(2);
    pump.stop();
    expect(source.cancelVideoFrameCallback).toHaveBeenCalled();
  });

  it("falls back to animation frames and ignores unchanged video time", async () => {
    const callbacks: Array<(now: number) => void> = [];
    const source = {
      videoWidth: 1280,
      videoHeight: 720,
      currentTime: 1,
      requestAnimationFrame: vi.fn((callback: (now: number) => void) => {
        callbacks.push(callback);
        return callbacks.length;
      }),
      cancelAnimationFrame: vi.fn()
    };
    const submitted: ScheduledVisualFrame<FakeFrame>[] = [];
    const scheduler = new LatestFrameScheduler<FakeFrame>({
      captureEpoch: 5,
      onSubmit: (frame) => submitted.push(frame)
    });
    const capture = vi.fn(async () => new FakeFrame("fallback"));
    const pump = new VideoFramePump({ source, scheduler, capture });

    pump.start();
    callbacks.shift()!(100);
    await Promise.resolve();
    callbacks.shift()!(116);
    await Promise.resolve();
    source.currentTime = 1.033;
    callbacks.shift()!(133);
    await Promise.resolve();

    expect(capture).toHaveBeenCalledTimes(2);
    expect(submitted[0].acquisitionTimestampMs).toBe(100);
    pump.stop();
    expect(source.cancelAnimationFrame).toHaveBeenCalled();
  });

  it("closes a captured bitmap that resolves after stop", async () => {
    let callback:
      | ((
          now: number,
          metadata: VideoFrameCallbackMetadataLike
        ) => void)
      | undefined;
    let resolveFrame: ((frame: FakeFrame) => void) | undefined;
    const source = {
      videoWidth: 1280,
      videoHeight: 720,
      requestVideoFrameCallback: (
        next: (
          now: number,
          metadata: VideoFrameCallbackMetadataLike
        ) => void
      ) => {
        callback = next;
        return 1;
      },
      cancelVideoFrameCallback: vi.fn()
    };
    const scheduler = new LatestFrameScheduler<FakeFrame>({
      captureEpoch: 1,
      onSubmit: () => undefined
    });
    const pump = new VideoFramePump({
      source,
      scheduler,
      capture: () =>
        new Promise<FakeFrame>((resolve) => {
          resolveFrame = resolve;
        })
    });
    const late = new FakeFrame("late");

    pump.start();
    callback?.(100, {});
    pump.stop();
    resolveFrame?.(late);
    await Promise.resolve();

    expect(late.closed).toBe(true);
    expect(scheduler.diagnostics(100).submitted).toBe(0);
  });

  it("preserves task context from acquisition across async capture", async () => {
    let callback:
      | ((
          now: number,
          metadata: VideoFrameCallbackMetadataLike
        ) => void)
      | undefined;
    let resolveFrame: ((frame: FakeFrame) => void) | undefined;
    let taskContext: "neutral-face" | "smile" = "neutral-face";
    const source = {
      videoWidth: 1280,
      videoHeight: 720,
      requestVideoFrameCallback: (
        next: (
          now: number,
          metadata: VideoFrameCallbackMetadataLike
        ) => void
      ) => {
        callback = next;
        return 1;
      },
      cancelVideoFrameCallback: vi.fn()
    };
    const submitted: ScheduledVisualFrame<FakeFrame>[] = [];
    const scheduler = new LatestFrameScheduler<FakeFrame>({
      captureEpoch: 1,
      onSubmit: (frame) => submitted.push(frame)
    });
    const pump = new VideoFramePump({
      source,
      scheduler,
      taskContextAtAcquisition: () => taskContext,
      capture: () =>
        new Promise<FakeFrame>((resolve) => {
          resolveFrame = resolve;
        })
    });

    pump.start();
    callback?.(100, { presentationTime: 95 });
    taskContext = "smile";
    resolveFrame?.(new FakeFrame("captured-before-transition"));
    await Promise.resolve();

    expect(submitted[0].taskContext).toBe("neutral-face");
    pump.stop();
  });
});
