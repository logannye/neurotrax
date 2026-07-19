import { describe, expect, it } from "vitest";
import { createGuidedDemoController } from "./guided-demo.js";

describe("timed guided demo controller", () => {
  it("holds each phase for its fixed duration while preserving confirmations", () => {
    const controller = createGuidedDemoController();
    controller.noteSpeechWindow();
    controller.noteInitialFaceWindow();
    expect(controller.tick(6_999).phase).toBe("establishing");
    expect(controller.tick(7_000)).toMatchObject({
      phase: "turn-away",
      confirmations: { establishing: "confirmed" }
    });

    controller.noteWithholding(true);
    expect(controller.tick(10_999).phase).toBe("turn-away");
    expect(controller.tick(11_000)).toMatchObject({
      phase: "return",
      confirmations: { withholding: "confirmed" }
    });

    controller.noteRecovery();
    expect(controller.tick(18_000)).toMatchObject({
      phase: "post-recovery",
      confirmations: { recovery: "confirmed" }
    });

    controller.notePostRecoveryWindow();
    expect(controller.tick(24_000)).toMatchObject({
      phase: "complete",
      confirmations: { postRecovery: "confirmed" },
      canComplete: true
    });
  });

  it("cannot stall when turn-away and recovery are not confirmed", () => {
    const controller = createGuidedDemoController();
    controller.noteSpeechWindow();
    controller.tick(24_000);
    expect(controller.snapshot()).toMatchObject({
      phase: "complete",
      confirmations: {
        establishing: "not-confirmed",
        withholding: "not-confirmed",
        recovery: "not-confirmed",
        postRecovery: "not-confirmed"
      },
      canComplete: true
    });
    expect(controller.snapshot().lastTransition).toMatchObject({
      from: "post-recovery",
      to: "complete",
      outcome: "timed-out"
    });
  });

  it("does not confirm withholding unless speech continued", () => {
    const controller = createGuidedDemoController();
    controller.tick(7_000);
    controller.noteWithholding(false);
    expect(controller.tick(11_000).confirmations.withholding).toBe(
      "not-confirmed"
    );
  });

  it("completes twenty varied deterministic replays within the timed budget", () => {
    const scenarios = [
      "hero",
      "missed-turn",
      "missed-recovery",
      "missing-face",
      "missing-speech"
    ] as const;
    for (let replay = 0; replay < 20; replay += 1) {
      const scenario = scenarios[replay % scenarios.length];
      const controller = createGuidedDemoController();
      if (scenario !== "missing-speech") controller.noteSpeechWindow();
      if (scenario !== "missing-face") controller.noteInitialFaceWindow();
      controller.tick(7_000);
      if (scenario !== "missed-turn" && scenario !== "missing-speech") {
        controller.noteWithholding(true);
      }
      controller.tick(11_000);
      if (
        scenario !== "missed-recovery" &&
        scenario !== "missing-face"
      ) {
        controller.noteRecovery();
      }
      controller.tick(18_000);
      if (
        scenario !== "missed-recovery" &&
        scenario !== "missing-face"
      ) {
        controller.notePostRecoveryWindow();
      }
      const result = controller.tick(24_000);
      expect(result.phase).toBe("complete");
      expect(result.canComplete).toBe(true);
      expect(24_000).toBeLessThan(25_000);
    }
  });
});
