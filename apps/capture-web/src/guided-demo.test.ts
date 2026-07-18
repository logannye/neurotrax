import { describe, expect, it } from "vitest";
import { createGuidedDemoController } from "./guided-demo.js";

describe("guided demo controller", () => {
  it("requires speech, initial face, withholding, recovery, and a final window", () => {
    const controller = createGuidedDemoController();
    controller.noteSpeechWindow();
    for (let tMs = 0; tMs <= 1600; tMs += 100) {
      controller.ingest({ tMs, speechActive: true, faceUsable: true });
    }
    expect(controller.snapshot().phase).toBe("turn-away");

    for (let tMs = 1700; tMs <= 2600; tMs += 100) {
      controller.ingest({ tMs, speechActive: true, faceUsable: false });
    }
    expect(controller.snapshot().withholdingObserved).toBe(true);
    expect(controller.snapshot().phase).toBe("return");

    for (let tMs = 2700; tMs <= 3600; tMs += 100) {
      controller.ingest({ tMs, speechActive: true, faceUsable: true });
    }
    expect(controller.snapshot().recoveryObserved).toBe(true);

    for (let tMs = 3700; tMs <= 5300; tMs += 100) {
      controller.ingest({ tMs, speechActive: true, faceUsable: true });
    }
    expect(controller.snapshot()).toMatchObject({
      phase: "complete",
      postRecoveryWindowObserved: true,
      canComplete: true
    });
  });

  it("does not count a turn-away when speech is not continuing", () => {
    const controller = createGuidedDemoController();
    controller.noteSpeechWindow();
    for (let tMs = 0; tMs <= 1600; tMs += 100) {
      controller.ingest({ tMs, speechActive: true, faceUsable: true });
    }
    for (let tMs = 1700; tMs <= 2800; tMs += 100) {
      controller.ingest({ tMs, speechActive: false, faceUsable: false });
    }
    expect(controller.snapshot().withholdingObserved).toBe(false);
  });
});
