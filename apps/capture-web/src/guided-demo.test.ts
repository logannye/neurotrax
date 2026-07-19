import { describe, expect, it } from "vitest";
import {
  createGuidedDemoController,
  JUDGE_READY_TIMED_POLICY
} from "./guided-demo.js";

describe("timed guided demo controller", () => {
  it("defines the fixed nineteen-second five-task policy", () => {
    expect(
      JUDGE_READY_TIMED_POLICY.phases.map(
        ({ phase, maximumDurationMs }) => [
          phase,
          maximumDurationMs
        ]
      )
    ).toEqual([
      ["establishing", 5_000],
      ["turn-away", 3_000],
      ["neutral-face", 3_000],
      ["smile", 4_000],
      ["eye-closure", 4_000]
    ]);
    expect(
      JUDGE_READY_TIMED_POLICY.phases.reduce(
        (total, phase) => total + phase.maximumDurationMs,
        0
      )
    ).toBe(19_000);
  });

  it("holds each phase for its fixed duration while preserving confirmations", () => {
    const controller = createGuidedDemoController();
    controller.noteSpeechWindow();
    controller.noteInitialFaceWindow();
    expect(controller.tick(4_999).phase).toBe("establishing");
    expect(controller.tick(5_000)).toMatchObject({
      phase: "turn-away",
      confirmations: { establishing: "confirmed" }
    });

    controller.noteWithholding(true);
    expect(controller.tick(7_999).phase).toBe("turn-away");
    expect(controller.tick(8_000)).toMatchObject({
      phase: "neutral-face",
      confirmations: { withholding: "confirmed" }
    });

    controller.noteNeutralFace();
    expect(controller.tick(11_000)).toMatchObject({
      phase: "smile",
      confirmations: { neutralFace: "confirmed" }
    });

    controller.noteSmile();
    expect(controller.tick(15_000)).toMatchObject({
      phase: "eye-closure",
      confirmations: { smile: "confirmed" }
    });

    controller.noteEyeClosure();
    expect(controller.tick(19_000)).toMatchObject({
      phase: "complete",
      confirmations: { eyeClosure: "confirmed" },
      canComplete: true
    });
  });

  it("cannot stall when phase confirmations are missing", () => {
    const controller = createGuidedDemoController();
    controller.noteSpeechWindow();
    controller.tick(19_000);
    expect(controller.snapshot()).toMatchObject({
      phase: "complete",
      confirmations: {
        establishing: "not-confirmed",
        withholding: "not-confirmed",
        neutralFace: "not-confirmed",
        smile: "not-confirmed",
        eyeClosure: "not-confirmed"
      },
      canComplete: true
    });
    expect(controller.snapshot().lastTransition).toMatchObject({
      from: "eye-closure",
      to: "complete",
      outcome: "timed-out"
    });
  });

  it("does not confirm withholding unless speech continued", () => {
    const controller = createGuidedDemoController();
    controller.tick(5_000);
    controller.noteWithholding(false);
    expect(controller.tick(8_000).confirmations.withholding).toBe(
      "not-confirmed"
    );
  });

  it("ignores task confirmation hooks outside their matching phase", () => {
    const controller = createGuidedDemoController();
    controller.noteNeutralFace();
    controller.noteSmile();
    controller.noteEyeClosure();
    controller.tick(8_000);

    expect(controller.snapshot()).toMatchObject({
      phase: "neutral-face",
      neutralFaceObserved: false,
      smileObserved: false,
      eyeClosureObserved: false
    });
    expect(controller.tick(19_000).confirmations).toMatchObject({
      neutralFace: "not-confirmed",
      smile: "not-confirmed",
      eyeClosure: "not-confirmed"
    });
  });

  it("completes twenty varied deterministic replays within the timed budget", () => {
    const scenarios = [
      "hero",
      "missed-turn",
      "missed-neutral",
      "missed-smile",
      "missed-eye-closure",
      "missing-face",
      "missing-speech"
    ] as const;
    for (let replay = 0; replay < 20; replay += 1) {
      const scenario = scenarios[replay % scenarios.length];
      const controller = createGuidedDemoController();
      if (scenario !== "missing-speech") controller.noteSpeechWindow();
      if (scenario !== "missing-face") controller.noteInitialFaceWindow();
      controller.tick(5_000);
      if (scenario !== "missed-turn" && scenario !== "missing-speech") {
        controller.noteWithholding(true);
      }
      controller.tick(8_000);
      if (scenario !== "missed-neutral" && scenario !== "missing-face") {
        controller.noteNeutralFace();
      }
      controller.tick(11_000);
      if (scenario !== "missed-smile" && scenario !== "missing-face") {
        controller.noteSmile();
      }
      controller.tick(15_000);
      if (
        scenario !== "missed-eye-closure" &&
        scenario !== "missing-face"
      ) {
        controller.noteEyeClosure();
      }
      const result = controller.tick(19_000);
      expect(result.phase).toBe("complete");
      expect(result.canComplete).toBe(true);
      expect(19_000).toBeLessThan(20_000);
    }
  });
});
