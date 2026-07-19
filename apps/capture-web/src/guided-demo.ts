import type {
  ConfirmationState,
  TimedEncounterPhase,
  TimedEncounterPolicy
} from "@phenometric/contracts";

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
  neutralFaceObserved: boolean;
  smileObserved: boolean;
  eyeClosureObserved: boolean;
  confirmations: {
    establishing: ConfirmationState;
    withholding: ConfirmationState;
    neutralFace: ConfirmationState;
    smile: ConfirmationState;
    eyeClosure: ConfirmationState;
  };
  lastTransition: GuidedPhaseTransition | null;
  canComplete: boolean;
}

export interface GuidedDemoController {
  tick(tMs: number): GuidedDemoSnapshot;
  noteSpeechWindow(): GuidedDemoSnapshot;
  noteInitialFaceWindow(): GuidedDemoSnapshot;
  noteWithholding(speechContinued: boolean): GuidedDemoSnapshot;
  noteNeutralFace(): GuidedDemoSnapshot;
  noteSmile(): GuidedDemoSnapshot;
  noteEyeClosure(): GuidedDemoSnapshot;
  reset(startedAtMs?: number): void;
  snapshot(tMs?: number): GuidedDemoSnapshot;
}

export const JUDGE_READY_TIMED_POLICY: TimedEncounterPolicy = {
  id: "judge-ready-timed-v0.2",
  systemCheckMaximumMs: 5_000,
  quietCalibrationMs: 1_500,
  reliablePitchFramesForStrong: 8,
  minimumSpeechEnergyFrames: 1,
  faceFramesForStrong: 12,
  faceFramesForLimited: 3,
  phases: [
    {
      phase: "establishing",
      minimumDurationMs: 5_000,
      maximumDurationMs: 5_000,
      successCondition: "speech-and-initial-face-window",
      timeoutBehavior: "advance-and-record-not-confirmed"
    },
    {
      phase: "turn-away",
      minimumDurationMs: 3_000,
      maximumDurationMs: 3_000,
      successCondition: "facial-withholding-while-speech-continues",
      timeoutBehavior: "advance-and-record-not-confirmed"
    },
    {
      phase: "neutral-face",
      minimumDurationMs: 3_000,
      maximumDurationMs: 3_000,
      successCondition: "usable-neutral-face-evidence",
      timeoutBehavior: "advance-and-record-not-confirmed"
    },
    {
      phase: "smile",
      minimumDurationMs: 4_000,
      maximumDurationMs: 4_000,
      successCondition: "usable-smile-evidence",
      timeoutBehavior: "advance-and-record-not-confirmed"
    },
    {
      phase: "eye-closure",
      minimumDurationMs: 4_000,
      maximumDurationMs: 4_000,
      successCondition: "usable-eye-closure-evidence",
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
    neutralFace: boolean;
    smile: boolean;
    eyeClosure: boolean;
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
  if (phase === "neutral-face") {
    return observed.neutralFace ? "confirmed" : "not-confirmed";
  }
  if (phase === "smile") {
    return observed.smile ? "confirmed" : "not-confirmed";
  }
  return observed.eyeClosure ? "confirmed" : "not-confirmed";
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
  let neutralFaceObserved = false;
  let smileObserved = false;
  let eyeClosureObserved = false;
  const confirmations: GuidedDemoSnapshot["confirmations"] = {
    establishing: "pending",
    withholding: "pending",
    neutralFace: "pending",
    smile: "pending",
    eyeClosure: "pending"
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
      neutralFace: neutralFaceObserved,
      smile: smileObserved,
      eyeClosure: eyeClosureObserved
    });

  const setConfirmation = (
    phase: TimedEncounterPhase,
    value: ConfirmationState
  ): void => {
    if (phase === "establishing") confirmations.establishing = value;
    else if (phase === "turn-away") confirmations.withholding = value;
    else if (phase === "neutral-face") confirmations.neutralFace = value;
    else if (phase === "smile") confirmations.smile = value;
    else confirmations.eyeClosure = value;
  };

  const snapshot = (tMs = lastTickMs): GuidedDemoSnapshot => {
    const phase = currentPhase();
    const phasePolicy =
      phase === "complete" ? null : policy.phases[phaseIndex];
    const snapshotTime = Math.max(lastTickMs, tMs);
    return {
      phase,
      phaseStartedAt,
      remainingMs: phasePolicy
        ? Math.max(
            0,
            phaseStartedAt +
              phasePolicy.maximumDurationMs -
              snapshotTime
          )
        : 0,
      speechWindowObserved,
      initialFaceWindowObserved,
      withholdingObserved,
      neutralFaceObserved,
      smileObserved,
      eyeClosureObserved,
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

  const note = (
    expectedPhase: TimedEncounterPhase,
    apply: () => void
  ): GuidedDemoSnapshot => {
    if (currentPhase() !== expectedPhase) return snapshot();
    apply();
    const confirmation = phaseConfirmation(expectedPhase);
    if (confirmation === "confirmed") {
      setConfirmation(expectedPhase, confirmation);
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
    neutralFaceObserved = false;
    smileObserved = false;
    eyeClosureObserved = false;
    confirmations.establishing = "pending";
    confirmations.withholding = "pending";
    confirmations.neutralFace = "pending";
    confirmations.smile = "pending";
    confirmations.eyeClosure = "pending";
  };

  return {
    tick,
    noteSpeechWindow: () =>
      note("establishing", () => {
        speechWindowObserved = true;
      }),
    noteInitialFaceWindow: () =>
      note("establishing", () => {
        initialFaceWindowObserved = true;
      }),
    noteWithholding: (speechContinued) =>
      note("turn-away", () => {
        if (speechContinued) withholdingObserved = true;
      }),
    noteNeutralFace: () =>
      note("neutral-face", () => {
        neutralFaceObserved = true;
      }),
    noteSmile: () =>
      note("smile", () => {
        smileObserved = true;
      }),
    noteEyeClosure: () =>
      note("eye-closure", () => {
        eyeClosureObserved = true;
      }),
    reset,
    snapshot
  };
}
