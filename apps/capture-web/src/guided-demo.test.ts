import type {
  VisualQualityReasonCode
} from "@phenometric/contracts";
import { describe, expect, it } from "vitest";
import {
  createGuidedDemoController,
  JUDGE_READY_COMPLETION_POLICY,
  type GuidedDemoController,
  type GuidedGateSignal
} from "./guided-demo.js";

function usableSignal(
  tMs: number,
  overrides: Partial<GuidedGateSignal> = {}
): GuidedGateSignal {
  return {
    tMs,
    audioAvailable: true,
    audioVoiced: false,
    audioClipped: false,
    visualUsable: true,
    visualReasonCodes: [],
    processorRef: "mediapipe:test",
    ...overrides
  };
}

function observeContinuous(
  controller: GuidedDemoController,
  startMs: number,
  endMs: number,
  signalAt: (tMs: number) => GuidedGateSignal,
  cadenceMs = 50
) {
  let result = controller.snapshot(startMs);
  for (let tMs = startMs; tMs < endMs; tMs += cadenceMs) {
    result = controller.observe(signalAt(tMs));
  }
  return controller.observe(signalAt(endMs));
}

function establish(
  controller: GuidedDemoController,
  startMs = 0,
  processorRef = "mediapipe:test"
): number {
  const endMs = startMs + 1_500;
  observeContinuous(controller, startMs, endMs, (tMs) =>
    usableSignal(tMs, {
      audioVoiced: true,
      processorRef
    })
  );
  expect(controller.snapshot().phase).toBe("turn-away");
  return endMs;
}

function turnAway(
  controller: GuidedDemoController,
  startMs: number,
  processorRef = "mediapipe:test"
): number {
  const signal = (tMs: number) =>
    usableSignal(tMs, {
      audioVoiced: true,
      visualUsable: false,
      visualReasonCodes: ["face-not-visible"],
      processorRef
    });
  const endMs = startMs + 750;
  observeContinuous(controller, startMs, endMs, signal);
  expect(controller.snapshot().phase).toBe("neutral-face");
  return endMs;
}

function captureNeutral(
  controller: GuidedDemoController,
  startMs: number,
  processorRef = "mediapipe:test"
): number {
  const endMs = startMs + 1_500;
  observeContinuous(controller, startMs, endMs, (tMs) =>
    usableSignal(tMs, { processorRef })
  );
  expect(controller.snapshot().phase).toBe("smile");
  return endMs;
}

function reachNeutral(
  controller: GuidedDemoController,
  processorRef = "mediapipe:test"
): number {
  return turnAway(
    controller,
    establish(controller, 0, processorRef) + 100,
    processorRef
  );
}

function reachSmile(
  controller: GuidedDemoController,
  processorRef = "mediapipe:test"
): number {
  return captureNeutral(
    controller,
    reachNeutral(controller, processorRef) + 100,
    processorRef
  );
}

function reachEyeClosure(
  controller: GuidedDemoController,
  processorRef = "mediapipe:test"
): number {
  const smileStart = reachSmile(controller, processorRef) + 100;
  observeContinuous(
    controller,
    smileStart,
    smileStart + 500,
    (tMs) =>
      usableSignal(tMs, {
        processorRef,
        smile: { leftAdherent: true, rightAdherent: false }
      })
  );
  observeContinuous(
    controller,
    smileStart + 500,
    smileStart + 1_500,
    (tMs) => usableSignal(tMs, { processorRef })
  );
  expect(controller.snapshot().phase).toBe("eye-closure");
  return smileStart + 1_500;
}

describe("completion-gated guided demo controller", () => {
  it("defines signal criteria without phase deadlines or skips", () => {
    expect(
      JUDGE_READY_COMPLETION_POLICY.maximumContinuousSignalGapMs
    ).toBe(200);
    expect(
      JUDGE_READY_COMPLETION_POLICY.phases.map(
        ({
          phase,
          evidenceDurationMs,
          adherenceHoldMs,
          assistanceAfterMs
        }) => [
          phase,
          evidenceDurationMs,
          adherenceHoldMs,
          assistanceAfterMs
        ]
      )
    ).toEqual([
      ["establishing", 1_500, 0, 12_000],
      ["turn-away", 750, 0, 12_000],
      ["neutral-face", 1_500, 0, 12_000],
      ["smile", 1_500, 500, 12_000],
      ["eye-closure", 1_500, 300, 12_000]
    ]);
  });

  it("never advances from elapsed time alone and exposes assistance", () => {
    const controller = createGuidedDemoController();
    expect(controller.tick(60_000)).toMatchObject({
      phase: "establishing",
      phaseElapsedMs: 60_000,
      progress: { fraction: 0 },
      needsAssistance: true,
      assistanceCode: "keep-face-visible-and-speak",
      canComplete: false,
      lastTransition: null
    });
  });

  it("shows criterion assistance at 12 seconds, not before", () => {
    const controller = createGuidedDemoController();
    expect(controller.tick(11_999).needsAssistance).toBe(false);
    expect(controller.tick(12_000)).toMatchObject({
      phase: "establishing",
      needsAssistance: true,
      assistanceCode: "keep-face-visible-and-speak"
    });
  });

  it("advances establishing only after 1.5 seconds of simultaneous valid evidence", () => {
    const controller = createGuidedDemoController();
    const establishingSignal = (tMs: number) =>
      usableSignal(tMs, {
        audioVoiced: true,
        audioClipped: false
      });
    const beforeBoundary = observeContinuous(
      controller,
      0,
      1_499,
      establishingSignal
    );
    expect(beforeBoundary).toMatchObject({
      phase: "establishing",
      progress: { evidenceMs: 1_499, fraction: 1_499 / 1_500 }
    });
    const result = controller.observe(establishingSignal(1_500));
    expect(result).toMatchObject({
      phase: "turn-away",
      confirmations: { establishing: "confirmed" },
      speechWindowObserved: true,
      initialFaceWindowObserved: true
    });
    expect(result.lastTransition).toEqual({
      id: 1,
      from: "establishing",
      to: "turn-away",
      atMs: 1_500,
      outcome: "confirmed",
      acceptedEvidenceInterval: {
        taskContext: "establishing",
        startMs: 0,
        endMs: 1_500,
        processorRef: "mediapipe:test"
      }
    });
  });

  it("resets the continuous evidence streak on a quality break", () => {
    const controller = createGuidedDemoController();
    const valid = (tMs: number) =>
      usableSignal(tMs, { audioVoiced: true });
    observeContinuous(controller, 0, 1_000, valid);
    controller.observe(
      usableSignal(1_001, {
        audioVoiced: true,
        visualUsable: false,
        visualReasonCodes: ["blur"]
      })
    );
    expect(
      observeContinuous(controller, 2_000, 3_499, valid).phase
    ).toBe("establishing");
    expect(controller.observe(valid(3_500)).phase).toBe("turn-away");
    expect(
      controller.snapshot().lastTransition?.acceptedEvidenceInterval
    ).toMatchObject({ startMs: 2_000, endMs: 3_500 });
  });

  it.each([50, 1_000 / 30])(
    "accepts a continuous establishing chain at %d ms cadence",
    (cadenceMs) => {
      const controller = createGuidedDemoController();
      const result = observeContinuous(
        controller,
        0,
        1_500,
        (tMs) => usableSignal(tMs, { audioVoiced: true }),
        cadenceMs
      );
      expect(result.phase).toBe("turn-away");
    }
  );

  it("does not treat sparse matching endpoints as continuous evidence", () => {
    const controller = createGuidedDemoController();
    controller.observe(usableSignal(0, { audioVoiced: true }));
    const result = controller.observe(
      usableSignal(1_500, { audioVoiced: true })
    );
    expect(result).toMatchObject({
      phase: "establishing",
      progress: { evidenceMs: 0 }
    });
  });

  it.each<{
    reasons: VisualQualityReasonCode[];
    label: string;
  }>([
    { label: "blur", reasons: ["blur"] },
    {
      label: "lighting",
      reasons: ["illumination-out-of-range"]
    },
    {
      label: "cadence",
      reasons: ["frame-rate-below-minimum"]
    },
    { label: "frame gap", reasons: ["visual-frame-gap"] },
    { label: "worker", reasons: ["worker-unavailable"] },
    { label: "camera", reasons: ["camera-unavailable"] },
    { label: "hidden tab", reasons: ["document-hidden"] },
    {
      label: "mixed behavioral and technical",
      reasons: ["face-not-visible", "blur"]
    }
  ])(
    "does not count $label as intentional turn-away",
    ({ reasons }) => {
      const controller = createGuidedDemoController();
      const establishedAt = establish(controller);
      const signal = (tMs: number) =>
        usableSignal(tMs, {
          audioVoiced: true,
          visualUsable: false,
          visualReasonCodes: reasons
        });
      controller.observe(signal(establishedAt + 100));
      controller.observe(signal(establishedAt + 850));
      expect(controller.snapshot()).toMatchObject({
        phase: "turn-away",
        withholdingObserved: false,
        progress: { evidenceMs: 0 }
      });
    }
  );

  it.each<VisualQualityReasonCode>([
    "face-not-visible",
    "pose-out-of-range"
  ])(
    "counts sustained %s with voiced speech as intentional turn-away",
    (reason) => {
      const controller = createGuidedDemoController();
      const establishedAt = establish(controller);
      const signal = (tMs: number) =>
        usableSignal(tMs, {
          audioVoiced: true,
          visualUsable: false,
          visualReasonCodes: [reason]
        });
      const result = observeContinuous(
        controller,
        establishedAt + 100,
        establishedAt + 850,
        signal
      );
      expect(result).toMatchObject({
        phase: "neutral-face",
        withholdingObserved: true,
        confirmations: { withholding: "confirmed" }
      });
    }
  );

  it("uses the inclusive 750 ms intentional turn-away boundary", () => {
    const controller = createGuidedDemoController();
    const startMs = establish(controller) + 100;
    const intentional = (tMs: number) =>
      usableSignal(tMs, {
        audioVoiced: true,
        visualUsable: false,
        visualReasonCodes: ["face-not-visible"]
      });
    expect(
      observeContinuous(
        controller,
        startMs,
        startMs + 749,
        intentional
      ).phase
    ).toBe("turn-away");
    expect(controller.observe(intentional(startMs + 750)).phase).toBe(
      "neutral-face"
    );
  });

  it("does not count turn-away when speech is unavailable or unvoiced", () => {
    for (const overrides of [
      { audioAvailable: false, audioVoiced: true },
      { audioAvailable: true, audioVoiced: false }
    ]) {
      const controller = createGuidedDemoController();
      const establishedAt = establish(controller);
      const signal = (tMs: number) =>
        usableSignal(tMs, {
          ...overrides,
          visualUsable: false,
          visualReasonCodes: ["face-not-visible"]
        });
      controller.observe(signal(establishedAt + 100));
      controller.observe(signal(establishedAt + 850));
      expect(controller.snapshot().phase).toBe("turn-away");
    }
  });

  it("captures a quiet neutral reference without inferring relaxation", () => {
    const controller = createGuidedDemoController();
    const neutralStart = reachNeutral(controller) + 100;
    observeContinuous(
      controller,
      neutralStart,
      neutralStart + 1_000,
      (tMs) => usableSignal(tMs, { audioVoiced: false })
    );
    controller.observe(
      usableSignal(neutralStart + 1_000, { audioVoiced: true })
    );
    expect(
      observeContinuous(
        controller,
        neutralStart + 2_000,
        neutralStart + 3_499,
        (tMs) => usableSignal(tMs, { audioVoiced: false })
      ).phase
    ).toBe("neutral-face");
    expect(
      controller.observe(
        usableSignal(neutralStart + 3_500, {
          audioVoiced: false
        })
      )
    ).toMatchObject({
      phase: "smile",
      neutralFaceObserved: true
    });
  });

  it("describes neutral assistance as reference capture, not expression detection", () => {
    const controller = createGuidedDemoController();
    const neutralStartedAt = reachNeutral(controller);
    const snapshot = controller.tick(neutralStartedAt + 12_000);

    expect(snapshot.assistanceText).toContain(
      "quiet neutral reference is captured"
    );
    expect(snapshot.assistanceText).not.toContain("neutral expression");
    expect(snapshot.assistanceText).not.toContain("relax");
  });

  it("requires a 500 ms hold from either one smile side plus 1.5 seconds of evidence", () => {
    const controller = createGuidedDemoController();
    const smileStart = reachSmile(controller) + 100;
    const smile = (tMs: number, leftAdherent: boolean) =>
      usableSignal(tMs, {
        smile: {
          leftAdherent,
          rightAdherent: false
        }
      });
    observeContinuous(
      controller,
      smileStart,
      smileStart + 400,
      (tMs) => smile(tMs, false)
    );
    observeContinuous(
      controller,
      smileStart + 400,
      smileStart + 899,
      (tMs) => smile(tMs, true)
    );
    expect(controller.snapshot().phase).toBe("smile");
    controller.observe(smile(smileStart + 900, true));
    expect(controller.snapshot()).toMatchObject({
      phase: "smile",
      progress: {
        adherenceMs: 500,
        adherenceRequiredMs: 500
      }
    });
    const result = observeContinuous(
      controller,
      smileStart + 900,
      smileStart + 1_500,
      (tMs) => smile(tMs, false)
    );
    expect(result).toMatchObject({
      phase: "eye-closure",
      smileObserved: true,
      confirmations: { smile: "confirmed" }
    });
    expect(
      result.lastTransition?.acceptedEvidenceInterval
    ).toMatchObject({
      taskContext: "smile",
      startMs: smileStart,
      endMs: smileStart + 1_500
    });
  });

  it("keeps the qualifying smile hold inside the accepted 1.5-second interval", () => {
    const controller = createGuidedDemoController();
    const smileStart = reachSmile(controller) + 100;
    for (let offsetMs = 0; offsetMs <= 1_530; offsetMs += 34) {
      controller.observe(
        usableSignal(smileStart + offsetMs, {
          smile: {
            leftAdherent: offsetMs <= 510,
            rightAdherent: false
          }
        })
      );
    }
    expect(controller.snapshot()).toMatchObject({
      phase: "smile",
      progress: { adherenceMs: 476 }
    });
  });

  it("requires close and reopen holds on the same anatomical eye", () => {
    const controller = createGuidedDemoController();
    const taskStart = reachEyeClosure(controller) + 100;
    const eyes = (
      tMs: number,
      left: { closed: boolean; recovered: boolean },
      right: { closed: boolean; recovered: boolean }
    ) =>
      usableSignal(tMs, {
        eyeClosure: { left, right }
      });
    observeContinuous(
      controller,
      taskStart,
      taskStart + 400,
      (tMs) =>
        eyes(
          tMs,
          { closed: false, recovered: false },
          { closed: false, recovered: true }
        )
    );
    observeContinuous(
      controller,
      taskStart + 400,
      taskStart + 699,
      (tMs) =>
        eyes(
          tMs,
          { closed: true, recovered: false },
          { closed: false, recovered: false }
        )
    );
    expect(controller.snapshot().progress.adherenceMs).toBe(299);
    controller.observe(
      eyes(
        taskStart + 700,
        { closed: true, recovered: false },
        { closed: false, recovered: false }
      )
    );
    observeContinuous(
      controller,
      taskStart + 700,
      taskStart + 1_000,
      (tMs) =>
        eyes(
          tMs,
          { closed: false, recovered: false },
          { closed: false, recovered: true }
        )
    );
    expect(controller.snapshot().phase).toBe("eye-closure");

    observeContinuous(
      controller,
      taskStart + 1_000,
      taskStart + 1_299,
      (tMs) =>
        eyes(
          tMs,
          { closed: false, recovered: true },
          { closed: false, recovered: false }
        )
    );
    expect(controller.snapshot().progress.adherenceMs).toBe(599);
    controller.observe(
      eyes(
        taskStart + 1_300,
        { closed: false, recovered: true },
        { closed: false, recovered: false }
      )
    );
    const result = observeContinuous(
      controller,
      taskStart + 1_300,
      taskStart + 1_500,
      (tMs) =>
        eyes(
          tMs,
          { closed: false, recovered: true },
          { closed: false, recovered: false }
        )
    );
    expect(result).toMatchObject({
      phase: "complete",
      eyeClosureObserved: true,
      canComplete: true
    });
    expect(
      result.lastTransition?.acceptedEvidenceInterval
    ).toMatchObject({
      taskContext: "eye-closure",
      startMs: taskStart,
      endMs: taskStart + 1_500
    });
  });

  it("does not combine close and reopen holds from different anatomical eyes", () => {
    const controller = createGuidedDemoController();
    const taskStart = reachEyeClosure(controller) + 100;
    const eyes = (
      tMs: number,
      left: { closed: boolean; recovered: boolean },
      right: { closed: boolean; recovered: boolean }
    ) =>
      usableSignal(tMs, {
        eyeClosure: { left, right }
      });
    observeContinuous(
      controller,
      taskStart,
      taskStart + 300,
      (tMs) =>
        eyes(
          tMs,
          { closed: true, recovered: false },
          { closed: false, recovered: false }
        )
    );
    observeContinuous(
      controller,
      taskStart + 300,
      taskStart + 1_000,
      (tMs) =>
        eyes(
          tMs,
          { closed: false, recovered: false },
          { closed: false, recovered: false }
        )
    );
    expect(controller.snapshot().phase).toBe("eye-closure");

    observeContinuous(
      controller,
      taskStart + 1_000,
      taskStart + 1_500,
      (tMs) =>
        eyes(
          tMs,
          { closed: false, recovered: false },
          { closed: false, recovered: true }
        )
    );
    expect(controller.snapshot()).toMatchObject({
      phase: "eye-closure",
      eyeClosureObserved: false
    });
  });

  it("rejects a close-reopen sequence whose closure has left the accepted interval", () => {
    const controller = createGuidedDemoController();
    const taskStart = reachEyeClosure(controller) + 100;
    const eyeSignal = (
      tMs: number,
      closed: boolean,
      recovered: boolean
    ) =>
      usableSignal(tMs, {
        eyeClosure: {
          left: { closed, recovered },
          right: { closed: false, recovered: false }
        }
      });

    observeContinuous(
      controller,
      taskStart,
      taskStart + 300,
      (tMs) => eyeSignal(tMs, true, false)
    );
    observeContinuous(
      controller,
      taskStart + 300,
      taskStart + 2_000,
      (tMs) => eyeSignal(tMs, false, false)
    );
    observeContinuous(
      controller,
      taskStart + 2_000,
      taskStart + 2_300,
      (tMs) => eyeSignal(tMs, false, true)
    );

    expect(controller.snapshot()).toMatchObject({
      phase: "eye-closure",
      eyeClosureObserved: false
    });
  });

  it("does not combine a stale closure with a later brief re-close", () => {
    const controller = createGuidedDemoController();
    const taskStart = reachEyeClosure(controller) + 100;
    const signal = (
      tMs: number,
      closed: boolean,
      recovered: boolean
    ) =>
      usableSignal(tMs, {
        eyeClosure: {
          left: { closed, recovered },
          right: { closed: false, recovered: false }
        }
      });

    observeContinuous(
      controller,
      taskStart,
      taskStart + 300,
      (tMs) => signal(tMs, true, false)
    );
    observeContinuous(
      controller,
      taskStart + 300,
      taskStart + 2_000,
      (tMs) => signal(tMs, false, false)
    );
    observeContinuous(
      controller,
      taskStart + 2_000,
      taskStart + 2_050,
      (tMs) => signal(tMs, true, false)
    );
    observeContinuous(
      controller,
      taskStart + 2_050,
      taskStart + 2_350,
      (tMs) => signal(tMs, false, true)
    );

    expect(controller.snapshot().phase).toBe("eye-closure");
  });

  it("resets smile adherence after a quality break", () => {
    const controller = createGuidedDemoController();
    const smileStart = reachSmile(controller) + 100;
    const adherent = (tMs: number) =>
      usableSignal(tMs, {
        smile: { leftAdherent: true, rightAdherent: false }
      });
    observeContinuous(
      controller,
      smileStart,
      smileStart + 499,
      adherent
    );
    controller.observe(
      usableSignal(smileStart + 500, {
        visualUsable: false,
        visualReasonCodes: ["blur"],
        smile: { leftAdherent: true, rightAdherent: false }
      })
    );
    observeContinuous(
      controller,
      smileStart + 1_000,
      smileStart + 1_499,
      adherent
    );
    expect(controller.snapshot()).toMatchObject({
      phase: "smile",
      progress: { adherenceMs: 499 }
    });
  });

  it("returns to neutral and invalidates dependent evidence after a processor change", () => {
    const controller = createGuidedDemoController();
    const smileStart = reachSmile(controller, "processor:a") + 100;
    observeContinuous(
      controller,
      smileStart,
      smileStart + 500,
      (tMs) => usableSignal(tMs, {
        processorRef: "processor:a",
        smile: { leftAdherent: true, rightAdherent: false }
      })
    );
    observeContinuous(
      controller,
      smileStart + 500,
      smileStart + 1_500,
      (tMs) => usableSignal(tMs, {
        processorRef: "processor:a"
      })
    );
    expect(controller.snapshot().phase).toBe("eye-closure");

    const result = controller.observe(
      usableSignal(smileStart + 1_600, {
        processorRef: "processor:b"
      })
    );
    expect(result).toMatchObject({
      phase: "neutral-face",
      progress: { evidenceMs: 0 },
      confirmations: {
        neutralFace: "pending",
        smile: "pending",
        eyeClosure: "pending"
      },
      neutralFaceObserved: false,
      smileObserved: false,
      eyeClosureObserved: false
    });
    expect(
      result.acceptedEvidenceIntervals.map(
        ({ taskContext }) => taskContext
      )
    ).toEqual(["establishing", "turn-away"]);
  });

  it("resets the current gate after a worker restart without advancing", () => {
    const controller = createGuidedDemoController();
    const valid = (tMs: number) =>
      usableSignal(tMs, { audioVoiced: true });
    observeContinuous(controller, 0, 1_000, valid);
    controller.resetCurrentGate(1_001, "mediapipe:test");
    observeContinuous(controller, 2_000, 3_499, valid);
    expect(controller.snapshot().phase).toBe("establishing");
    controller.observe(valid(3_500));
    expect(controller.snapshot().phase).toBe("turn-away");
  });

  it("ignores regressing signal timestamps", () => {
    const controller = createGuidedDemoController();
    controller.observe(usableSignal(1_000, { audioVoiced: true }));
    controller.observe(usableSignal(500, { audioVoiced: true }));
    expect(controller.snapshot()).toMatchObject({
      phase: "establishing",
      progress: { evidenceMs: 0 }
    });
  });
});
