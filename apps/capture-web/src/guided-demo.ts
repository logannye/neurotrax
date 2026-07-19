import type {
  ConfirmationState,
  TimedEncounterPhase,
  TimedEncounterPolicy
} from "@neurotrax/contracts";

export type GuidedPhase = TimedEncounterPhase | "complete";

export interface GuidedPhaseTransition {
  id: number;
  from: TimedEncounterPhase;
  to: GuidedPhase;
  atMs: number;
  outcome: "confirmed" | "timed-out";
}

export interface GuidedDemoSnapshot {
  phase: GuidedPhase;
  phaseStartedAt: number;
  remainingMs: number;
  speechWindowObserved: boolean;
  initialFaceWindowObserved: boolean;
  withholdingObserved: boolean;
  recoveryObserved: boolean;
  postRecoveryWindowObserved: boolean;
  confirmations: {
    establishing: ConfirmationState;
    withholding: ConfirmationState;
    recovery: ConfirmationState;
    postRecovery: ConfirmationState;
  };
  lastTransition: GuidedPhaseTransition | null;
  canComplete: boolean;
}

export interface GuidedDemoController {
  tick(tMs: number): GuidedDemoSnapshot;
  noteSpeechWindow(): GuidedDemoSnapshot;
  noteInitialFaceWindow(): GuidedDemoSnapshot;
  noteWithholding(speechContinued: boolean): GuidedDemoSnapshot;
  noteRecovery(): GuidedDemoSnapshot;
  notePostRecoveryWindow(): GuidedDemoSnapshot;
  reset(startedAtMs?: number): void;
  snapshot(tMs?: number): GuidedDemoSnapshot;
}

export const JUDGE_READY_TIMED_POLICY: TimedEncounterPolicy = {
  id: "judge-ready-timed-v0.1",
  systemCheckMaximumMs: 5_000,
  quietCalibrationMs: 1_500,
  reliablePitchFramesForStrong: 8,
  minimumSpeechEnergyFrames: 1,
  faceFramesForStrong: 12,
  faceFramesForLimited: 3,
  phases: [
    {
      phase: "establishing",
      minimumDurationMs: 7_000,
      maximumDurationMs: 7_000,
      successCondition: "speech-and-initial-face-window",
      timeoutBehavior: "advance-and-record-not-confirmed"
    },
    {
      phase: "turn-away",
      minimumDurationMs: 4_000,
      maximumDurationMs: 4_000,
      successCondition: "facial-withholding-while-speech-continues",
      timeoutBehavior: "advance-and-record-not-confirmed"
    },
    {
      phase: "return",
      minimumDurationMs: 7_000,
      maximumDurationMs: 7_000,
      successCondition: "facial-quality-restored",
      timeoutBehavior: "advance-and-record-not-confirmed"
    },
    {
      phase: "post-recovery",
      minimumDurationMs: 6_000,
      maximumDurationMs: 6_000,
      successCondition: "post-recovery-face-window",
      timeoutBehavior: "advance-and-record-not-confirmed"
    }
  ]
};

function confirmationFor(
  phase: TimedEncounterPhase,
  observed: {
    speechWindow: boolean;
    initialFaceWindow: boolean;
    withholding: boolean;
    recovery: boolean;
    postRecoveryWindow: boolean;
  }
): ConfirmationState {
  if (phase === "establishing") {
    return observed.speechWindow && observed.initialFaceWindow
      ? "confirmed"
      : "not-confirmed";
  }
  if (phase === "turn-away") {
    return observed.withholding ? "confirmed" : "not-confirmed";
  }
  if (phase === "return") {
    return observed.recovery ? "confirmed" : "not-confirmed";
  }
  return observed.postRecoveryWindow ? "confirmed" : "not-confirmed";
}

export function createGuidedDemoController(
  policy: TimedEncounterPolicy = JUDGE_READY_TIMED_POLICY
): GuidedDemoController {
  let phaseIndex = 0;
  let phaseStartedAt = 0;
  let lastTickMs = 0;
  let transitionId = 0;
  let lastTransition: GuidedPhaseTransition | null = null;
  let speechWindowObserved = false;
  let initialFaceWindowObserved = false;
  let withholdingObserved = false;
  let recoveryObserved = false;
  let postRecoveryWindowObserved = false;
  const confirmations: GuidedDemoSnapshot["confirmations"] = {
    establishing: "pending",
    withholding: "pending",
    recovery: "pending",
    postRecovery: "pending"
  };

  const currentPhase = (): GuidedPhase =>
    policy.phases[phaseIndex]?.phase ?? "complete";

  const phaseConfirmation = (
    phase: TimedEncounterPhase
  ): ConfirmationState =>
    confirmationFor(phase, {
      speechWindow: speechWindowObserved,
      initialFaceWindow: initialFaceWindowObserved,
      withholding: withholdingObserved,
      recovery: recoveryObserved,
      postRecoveryWindow: postRecoveryWindowObserved
    });

  const setConfirmation = (
    phase: TimedEncounterPhase,
    value: ConfirmationState
  ): void => {
    if (phase === "establishing") confirmations.establishing = value;
    else if (phase === "turn-away") confirmations.withholding = value;
    else if (phase === "return") confirmations.recovery = value;
    else confirmations.postRecovery = value;
  };

  const snapshot = (tMs = lastTickMs): GuidedDemoSnapshot => {
    const phase = currentPhase();
    const phasePolicy =
      phase === "complete" ? null : policy.phases[phaseIndex];
    return {
      phase,
      phaseStartedAt,
      remainingMs: phasePolicy
        ? Math.max(
            0,
            phaseStartedAt + phasePolicy.maximumDurationMs - tMs
          )
        : 0,
      speechWindowObserved,
      initialFaceWindowObserved,
      withholdingObserved,
      recoveryObserved,
      postRecoveryWindowObserved,
      confirmations: { ...confirmations },
      lastTransition,
      canComplete: phase === "complete"
    };
  };

  const tick = (tMs: number): GuidedDemoSnapshot => {
    lastTickMs = Math.max(lastTickMs, tMs);
    while (phaseIndex < policy.phases.length) {
      const phasePolicy = policy.phases[phaseIndex];
      const deadline = phaseStartedAt + phasePolicy.maximumDurationMs;
      if (lastTickMs < deadline) break;
      const confirmation = phaseConfirmation(phasePolicy.phase);
      setConfirmation(phasePolicy.phase, confirmation);
      const from = phasePolicy.phase;
      phaseIndex += 1;
      phaseStartedAt = deadline;
      transitionId += 1;
      lastTransition = {
        id: transitionId,
        from,
        to: currentPhase(),
        atMs: deadline,
        outcome:
          confirmation === "confirmed" ? "confirmed" : "timed-out"
      };
    }
    return snapshot(lastTickMs);
  };

  const note = (apply: () => void): GuidedDemoSnapshot => {
    apply();
    const phase = currentPhase();
    if (phase !== "complete") {
      const confirmation = phaseConfirmation(phase);
      if (confirmation === "confirmed") {
        setConfirmation(phase, confirmation);
      }
    }
    return snapshot();
  };

  const reset = (startedAtMs = 0): void => {
    phaseIndex = 0;
    phaseStartedAt = startedAtMs;
    lastTickMs = startedAtMs;
    transitionId = 0;
    lastTransition = null;
    speechWindowObserved = false;
    initialFaceWindowObserved = false;
    withholdingObserved = false;
    recoveryObserved = false;
    postRecoveryWindowObserved = false;
    confirmations.establishing = "pending";
    confirmations.withholding = "pending";
    confirmations.recovery = "pending";
    confirmations.postRecovery = "pending";
  };

  return {
    tick,
    noteSpeechWindow: () =>
      note(() => {
        speechWindowObserved = true;
      }),
    noteInitialFaceWindow: () =>
      note(() => {
        initialFaceWindowObserved = true;
      }),
    noteWithholding: (speechContinued) =>
      note(() => {
        if (speechContinued) withholdingObserved = true;
      }),
    noteRecovery: () =>
      note(() => {
        recoveryObserved = true;
      }),
    notePostRecoveryWindow: () =>
      note(() => {
        postRecoveryWindowObserved = true;
      }),
    reset,
    snapshot
  };
}
