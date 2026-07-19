import type {
  CompletionGateProgress,
  CompletionGatedEncounterPhase,
  CompletionGatedEncounterPolicy,
  ConfirmationState,
  GuidedTaskEvidenceInterval,
  VisualQualityReasonCode
} from "@phenometric/contracts";

export type GuidedPhase = CompletionGatedEncounterPhase | "complete";

export type GuidedAssistanceCode =
  | "keep-face-visible-and-speak"
  | "turn-away-and-keep-speaking"
  | "hold-quiet-neutral-reference"
  | "hold-smile-quietly"
  | "close-then-reopen-eyes-quietly";

export interface GuidedEyeGateSignal {
  closed: boolean;
  recovered: boolean;
}

export interface GuidedGateSignal {
  tMs: number;
  audioAvailable: boolean;
  audioVoiced: boolean;
  audioClipped: boolean;
  visualUsable: boolean;
  visualReasonCodes: readonly VisualQualityReasonCode[];
  processorRef?: string;
  smile?: {
    leftAdherent: boolean;
    rightAdherent: boolean;
  };
  eyeClosure?: {
    left: GuidedEyeGateSignal;
    right: GuidedEyeGateSignal;
  };
}

export interface GuidedPhaseTransition {
  id: number;
  from: CompletionGatedEncounterPhase;
  to: GuidedPhase;
  atMs: number;
  outcome: "confirmed";
  acceptedEvidenceInterval: GuidedTaskEvidenceInterval;
}

export interface GuidedDemoSnapshot {
  phase: GuidedPhase;
  phaseStartedAt: number;
  phaseElapsedMs: number;
  progress: CompletionGateProgress;
  needsAssistance: boolean;
  assistanceCode: GuidedAssistanceCode | null;
  assistanceText: string | null;
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
  acceptedEvidenceIntervals: readonly GuidedTaskEvidenceInterval[];
  lastTransition: GuidedPhaseTransition | null;
  canComplete: boolean;
}

export interface GuidedDemoController {
  observe(signal: GuidedGateSignal): GuidedDemoSnapshot;
  tick(tMs: number): GuidedDemoSnapshot;
  resetCurrentGate(tMs: number, processorRef?: string): GuidedDemoSnapshot;
  reset(startedAtMs?: number): void;
  snapshot(tMs?: number): GuidedDemoSnapshot;
}

export const JUDGE_READY_COMPLETION_POLICY: CompletionGatedEncounterPolicy = {
  id: "completion-gated-v0.3",
  systemCheckMaximumMs: 5_000,
  quietCalibrationMs: 1_500,
  maximumContinuousSignalGapMs: 200,
  reliablePitchFramesForStrong: 8,
  minimumSpeechEnergyFrames: 1,
  faceFramesForStrong: 12,
  faceFramesForLimited: 3,
  phases: [
    {
      phase: "establishing",
      evidenceDurationMs: 1_500,
      adherenceHoldMs: 0,
      assistanceAfterMs: 12_000,
      successCondition:
        "continuous-usable-face-and-voiced-unclipped-speech"
    },
    {
      phase: "turn-away",
      evidenceDurationMs: 750,
      adherenceHoldMs: 0,
      assistanceAfterMs: 12_000,
      successCondition:
        "intentional-face-withholding-while-speech-remains-voiced"
    },
    {
      phase: "neutral-face",
      evidenceDurationMs: 1_500,
      adherenceHoldMs: 0,
      assistanceAfterMs: 12_000,
      successCondition: "continuous-usable-face-and-non-voiced-audio"
    },
    {
      phase: "smile",
      evidenceDurationMs: 1_500,
      adherenceHoldMs: 500,
      assistanceAfterMs: 12_000,
      successCondition:
        "continuous-usable-silent-evidence-and-either-mouth-corner-smile-adherence"
    },
    {
      phase: "eye-closure",
      evidenceDurationMs: 1_500,
      adherenceHoldMs: 300,
      assistanceAfterMs: 12_000,
      successCondition:
        "continuous-usable-silent-evidence-and-same-eye-close-then-reopen"
    }
  ]
};

const BEHAVIORAL_WITHHOLDING_REASONS =
  new Set<VisualQualityReasonCode>([
    "face-not-visible",
    "pose-out-of-range"
  ]);

interface HoldState {
  samples: Array<{ tMs: number; adherent: boolean }>;
  elapsedMs: number;
  complete: boolean;
}

interface EyeSequenceState {
  samples: Array<GuidedEyeGateSignal & { tMs: number }>;
  closureElapsedMs: number;
  recoveryElapsedMs: number;
  complete: boolean;
}

function emptyHoldState(): HoldState {
  return { samples: [], elapsedMs: 0, complete: false };
}

function emptyEyeSequenceState(): EyeSequenceState {
  return {
    samples: [],
    closureElapsedMs: 0,
    recoveryElapsedMs: 0,
    complete: false
  };
}

function elapsedSince(startedAt: number | null, tMs: number): number {
  return startedAt === null ? 0 : Math.max(0, tMs - startedAt);
}

function assistanceFor(
  phase: CompletionGatedEncounterPhase
): GuidedAssistanceCode {
  if (phase === "establishing") {
    return "keep-face-visible-and-speak";
  }
  if (phase === "turn-away") {
    return "turn-away-and-keep-speaking";
  }
  if (phase === "neutral-face") {
    return "hold-quiet-neutral-reference";
  }
  if (phase === "smile") return "hold-smile-quietly";
  return "close-then-reopen-eyes-quietly";
}

function assistanceTextFor(
  code: GuidedAssistanceCode
): string {
  if (code === "keep-face-visible-and-speak") {
    return "Keep your face centered and continue speaking naturally. Move a little farther from the camera if your face does not fit.";
  }
  if (code === "turn-away-and-keep-speaking") {
    return "Keep speaking while turning far enough away that your face is no longer usable. Camera, lighting, and connection problems do not count.";
  }
  if (code === "hold-quiet-neutral-reference") {
    return "Face the camera, stay quiet, and hold still while a quiet neutral reference is captured.";
  }
  if (code === "hold-smile-quietly") {
    return "Stay quiet and hold a comfortable smile until the progress completes.";
  }
  return "Stay quiet, gently close at least one eye, hold briefly, then reopen that same eye fully.";
}

function isBehavioralWithholding(
  reasonCodes: readonly VisualQualityReasonCode[]
): boolean {
  return (
    reasonCodes.length > 0 &&
    reasonCodes.some((reason) =>
      BEHAVIORAL_WITHHOLDING_REASONS.has(reason)
    ) &&
    reasonCodes.every((reason) =>
      BEHAVIORAL_WITHHOLDING_REASONS.has(reason)
    )
  );
}

export function createGuidedDemoController(
  policy: CompletionGatedEncounterPolicy =
    JUDGE_READY_COMPLETION_POLICY
): GuidedDemoController {
  let phaseIndex = 0;
  let phaseStartedAt = 0;
  let lastTickMs = 0;
  let lastSignalAt = Number.NEGATIVE_INFINITY;
  let transitionId = 0;
  let lastTransition: GuidedPhaseTransition | null = null;
  let evidenceStartedAt: number | null = null;
  let lastValidEvidenceAt: number | null = null;
  let gateProcessorRef: string | undefined;
  let neutralProcessorRef: string | undefined;
  let smileLeft = emptyHoldState();
  let smileRight = emptyHoldState();
  let eyeLeft = emptyEyeSequenceState();
  let eyeRight = emptyEyeSequenceState();
  let speechWindowObserved = false;
  let initialFaceWindowObserved = false;
  let withholdingObserved = false;
  let neutralFaceObserved = false;
  let smileObserved = false;
  let eyeClosureObserved = false;
  const acceptedEvidence = new Map<
    CompletionGatedEncounterPhase,
    GuidedTaskEvidenceInterval
  >();
  const confirmations: GuidedDemoSnapshot["confirmations"] = {
    establishing: "pending",
    withholding: "pending",
    neutralFace: "pending",
    smile: "pending",
    eyeClosure: "pending"
  };

  const currentPhase = (): GuidedPhase =>
    policy.phases[phaseIndex]?.phase ?? "complete";

  const currentPolicy = () => policy.phases[phaseIndex] ?? null;

  const resetGateTracking = (processorRef?: string): void => {
    evidenceStartedAt = null;
    lastValidEvidenceAt = null;
    gateProcessorRef = processorRef;
    smileLeft = emptyHoldState();
    smileRight = emptyHoldState();
    eyeLeft = emptyEyeSequenceState();
    eyeRight = emptyEyeSequenceState();
  };

  const setConfirmation = (
    phase: CompletionGatedEncounterPhase,
    value: ConfirmationState
  ): void => {
    if (phase === "establishing") confirmations.establishing = value;
    else if (phase === "turn-away") {
      confirmations.withholding = value;
    } else if (phase === "neutral-face") {
      confirmations.neutralFace = value;
    } else if (phase === "smile") confirmations.smile = value;
    else confirmations.eyeClosure = value;
  };

  const markObserved = (
    phase: CompletionGatedEncounterPhase
  ): void => {
    if (phase === "establishing") {
      speechWindowObserved = true;
      initialFaceWindowObserved = true;
    } else if (phase === "turn-away") {
      withholdingObserved = true;
    } else if (phase === "neutral-face") {
      neutralFaceObserved = true;
    } else if (phase === "smile") {
      smileObserved = true;
    } else {
      eyeClosureObserved = true;
    }
  };

  const adherenceProgress = (
    phase: GuidedPhase,
    tMs: number
  ): { elapsedMs: number; requiredMs: number; complete: boolean } => {
    const phasePolicy = currentPolicy();
    if (phase === "complete" || !phasePolicy) {
      return { elapsedMs: 0, requiredMs: 0, complete: true };
    }
    if (phase === "smile") {
      const requiredMs = phasePolicy.adherenceHoldMs;
      const elapsedMs = Math.max(
        smileLeft.elapsedMs,
        smileRight.elapsedMs
      );
      return {
        elapsedMs: Math.min(requiredMs, elapsedMs),
        requiredMs,
        complete: smileLeft.complete || smileRight.complete
      };
    }
    if (phase === "eye-closure") {
      const holdMs = phasePolicy.adherenceHoldMs;
      const progressFor = (state: EyeSequenceState): number => {
        return (
          Math.min(holdMs, state.closureElapsedMs) +
          Math.min(holdMs, state.recoveryElapsedMs)
        );
      };
      const requiredMs = holdMs * 2;
      return {
        elapsedMs: Math.min(
          requiredMs,
          Math.max(progressFor(eyeLeft), progressFor(eyeRight))
        ),
        requiredMs,
        complete: eyeLeft.complete || eyeRight.complete
      };
    }
    return { elapsedMs: 0, requiredMs: 0, complete: true };
  };

  const snapshot = (tMs = lastTickMs): GuidedDemoSnapshot => {
    const phase = currentPhase();
    const phasePolicy = currentPolicy();
    const snapshotTime = Math.max(lastTickMs, tMs);
    const evidenceMs = Math.min(
      phasePolicy?.evidenceDurationMs ?? 0,
      evidenceStartedAt === null || lastValidEvidenceAt === null
        ? 0
        : Math.max(0, lastValidEvidenceAt - evidenceStartedAt)
    );
    const evidenceRequiredMs =
      phasePolicy?.evidenceDurationMs ?? 0;
    const adherence = adherenceProgress(
      phase,
      lastValidEvidenceAt ?? snapshotTime
    );
    const evidenceFraction =
      evidenceRequiredMs === 0 ? 1 : evidenceMs / evidenceRequiredMs;
    const adherenceFraction =
      adherence.requiredMs === 0
        ? 1
        : adherence.elapsedMs / adherence.requiredMs;
    const phaseElapsedMs =
      phase === "complete"
        ? 0
        : Math.max(0, snapshotTime - phaseStartedAt);
    const needsAssistance =
      phasePolicy !== null &&
      phaseElapsedMs >= phasePolicy.assistanceAfterMs;
    const assistanceCode =
      needsAssistance && phase !== "complete"
        ? assistanceFor(phase)
        : null;

    return {
      phase,
      phaseStartedAt,
      phaseElapsedMs,
      progress: {
        evidenceMs,
        evidenceRequiredMs,
        adherenceMs: adherence.elapsedMs,
        adherenceRequiredMs: adherence.requiredMs,
        fraction:
          phase === "complete"
            ? 1
            : Math.min(evidenceFraction, adherenceFraction)
      },
      needsAssistance,
      assistanceCode,
      assistanceText: assistanceCode
        ? assistanceTextFor(assistanceCode)
        : null,
      speechWindowObserved,
      initialFaceWindowObserved,
      withholdingObserved,
      neutralFaceObserved,
      smileObserved,
      eyeClosureObserved,
      confirmations: { ...confirmations },
      acceptedEvidenceIntervals: policy.phases.flatMap(({ phase }) => {
        const interval = acceptedEvidence.get(phase);
        return interval ? [{ ...interval }] : [];
      }),
      lastTransition,
      canComplete: phase === "complete"
    };
  };

  const rewindToNeutral = (
    tMs: number,
    processorRef?: string
  ): void => {
    const neutralIndex = policy.phases.findIndex(
      ({ phase }) => phase === "neutral-face"
    );
    if (neutralIndex < 0) return;
    phaseIndex = neutralIndex;
    phaseStartedAt = tMs;
    neutralProcessorRef = undefined;
    neutralFaceObserved = false;
    smileObserved = false;
    eyeClosureObserved = false;
    confirmations.neutralFace = "pending";
    confirmations.smile = "pending";
    confirmations.eyeClosure = "pending";
    acceptedEvidence.delete("neutral-face");
    acceptedEvidence.delete("smile");
    acceptedEvidence.delete("eye-closure");
    resetGateTracking(processorRef);
  };

  const maybeHandleProcessor = (
    tMs: number,
    processorRef?: string
  ): "none" | "reset" | "rewound" => {
    if (!processorRef) return "none";
    const phase = currentPhase();
    if (
      neutralProcessorRef &&
      processorRef !== neutralProcessorRef &&
      (phase === "smile" ||
        phase === "eye-closure" ||
        phase === "complete")
    ) {
      rewindToNeutral(tMs, processorRef);
      return "rewound";
    }
    if (gateProcessorRef && processorRef !== gateProcessorRef) {
      resetGateTracking(processorRef);
      return "reset";
    }
    gateProcessorRef ??= processorRef;
    return "none";
  };

  const updateHold = (
    state: HoldState,
    adherent: boolean,
    tMs: number,
    holdMs: number,
    evidenceDurationMs: number
  ): void => {
    state.samples.push({ tMs, adherent });
    const acceptedStartMs = tMs - evidenceDurationMs;
    state.samples = state.samples.filter(
      (sample) => sample.tMs >= acceptedStartMs
    );
    let runStartedAt: number | null = null;
    state.elapsedMs = 0;
    state.complete = false;
    for (const sample of state.samples) {
      if (!sample.adherent) {
        runStartedAt = null;
        continue;
      }
      runStartedAt ??= sample.tMs;
      state.elapsedMs = Math.max(
        state.elapsedMs,
        sample.tMs - runStartedAt
      );
      if (state.elapsedMs >= holdMs) state.complete = true;
    }
  };

  const updateEyeSequence = (
    state: EyeSequenceState,
    signal: GuidedEyeGateSignal,
    tMs: number,
    holdMs: number,
    evidenceDurationMs: number
  ): void => {
    state.samples.push({ tMs, ...signal });
    const acceptedStartMs = tMs - evidenceDurationMs;
    state.samples = state.samples.filter(
      (sample) => sample.tMs >= acceptedStartMs
    );

    let closureStartedAt: number | null = null;
    let closureQualified = false;
    let recoveryStartedAt: number | null = null;
    state.closureElapsedMs = 0;
    state.recoveryElapsedMs = 0;
    state.complete = false;

    for (const sample of state.samples) {
      if (sample.closed) {
        closureStartedAt ??= sample.tMs;
        state.closureElapsedMs = Math.max(
          state.closureElapsedMs,
          sample.tMs - closureStartedAt
        );
        if (sample.tMs - closureStartedAt >= holdMs) {
          closureQualified = true;
        }
        recoveryStartedAt = null;
        state.recoveryElapsedMs = 0;
        continue;
      }

      closureStartedAt = null;
      if (!closureQualified) continue;
      if (!sample.recovered) {
        recoveryStartedAt = null;
        state.recoveryElapsedMs = 0;
        continue;
      }

      recoveryStartedAt ??= sample.tMs;
      state.recoveryElapsedMs =
        sample.tMs - recoveryStartedAt;
      if (state.recoveryElapsedMs >= holdMs) {
        state.complete = true;
        return;
      }
    }
  };

  const criterionMatches = (
    phase: CompletionGatedEncounterPhase,
    signal: GuidedGateSignal
  ): boolean => {
    if (phase === "establishing") {
      return (
        signal.visualUsable &&
        signal.audioAvailable &&
        signal.audioVoiced &&
        !signal.audioClipped
      );
    }
    if (phase === "turn-away") {
      return (
        signal.audioAvailable &&
        signal.audioVoiced &&
        isBehavioralWithholding(signal.visualReasonCodes)
      );
    }
    return (
      signal.visualUsable &&
      signal.audioAvailable &&
      !signal.audioVoiced &&
      !signal.audioClipped
    );
  };

  const completeCurrentPhase = (
    phase: CompletionGatedEncounterPhase,
    tMs: number
  ): void => {
    const phasePolicy = currentPolicy();
    if (!phasePolicy) return;
    const interval: GuidedTaskEvidenceInterval = {
      taskContext: phase,
      startMs: tMs - phasePolicy.evidenceDurationMs,
      endMs: tMs,
      ...(gateProcessorRef
        ? { processorRef: gateProcessorRef }
        : {})
    };
    acceptedEvidence.set(phase, interval);
    if (phase === "neutral-face") {
      neutralProcessorRef = gateProcessorRef;
    }
    setConfirmation(phase, "confirmed");
    markObserved(phase);
    const from = phase;
    phaseIndex += 1;
    phaseStartedAt = tMs;
    transitionId += 1;
    resetGateTracking();
    lastTransition = {
      id: transitionId,
      from,
      to: currentPhase(),
      atMs: tMs,
      outcome: "confirmed",
      acceptedEvidenceInterval: { ...interval }
    };
  };

  const observe = (signal: GuidedGateSignal): GuidedDemoSnapshot => {
    if (!Number.isFinite(signal.tMs)) return snapshot();
    if (signal.tMs < lastSignalAt) return snapshot();
    const priorSignalAt = lastSignalAt;
    lastSignalAt = signal.tMs;
    lastTickMs = Math.max(lastTickMs, signal.tMs);

    const processorChange = maybeHandleProcessor(
      signal.tMs,
      signal.processorRef
    );
    if (processorChange === "rewound") return snapshot();
    if (currentPhase() === "complete") return snapshot();
    if (
      Number.isFinite(priorSignalAt) &&
      signal.tMs - priorSignalAt >
        policy.maximumContinuousSignalGapMs
    ) {
      resetGateTracking(signal.processorRef ?? gateProcessorRef);
    }
    const phase = currentPhase();
    const phasePolicy = currentPolicy();
    if (phase === "complete" || !phasePolicy) return snapshot();

    if (!criterionMatches(phase, signal)) {
      resetGateTracking(signal.processorRef ?? gateProcessorRef);
      return snapshot();
    }

    evidenceStartedAt ??= signal.tMs;
    lastValidEvidenceAt = signal.tMs;

    if (phase === "smile") {
      updateHold(
        smileLeft,
        signal.smile?.leftAdherent ?? false,
        signal.tMs,
        phasePolicy.adherenceHoldMs,
        phasePolicy.evidenceDurationMs
      );
      updateHold(
        smileRight,
        signal.smile?.rightAdherent ?? false,
        signal.tMs,
        phasePolicy.adherenceHoldMs,
        phasePolicy.evidenceDurationMs
      );
    } else if (phase === "eye-closure") {
      updateEyeSequence(
        eyeLeft,
        signal.eyeClosure?.left ?? {
          closed: false,
          recovered: false
        },
        signal.tMs,
        phasePolicy.adherenceHoldMs,
        phasePolicy.evidenceDurationMs
      );
      updateEyeSequence(
        eyeRight,
        signal.eyeClosure?.right ?? {
          closed: false,
          recovered: false
        },
        signal.tMs,
        phasePolicy.adherenceHoldMs,
        phasePolicy.evidenceDurationMs
      );
    }

    const evidenceComplete =
      elapsedSince(evidenceStartedAt, signal.tMs) >=
      phasePolicy.evidenceDurationMs;
    const adherenceComplete = adherenceProgress(
      phase,
      signal.tMs
    ).complete;
    if (evidenceComplete && adherenceComplete) {
      completeCurrentPhase(phase, signal.tMs);
    }
    return snapshot();
  };

  const tick = (tMs: number): GuidedDemoSnapshot => {
    if (Number.isFinite(tMs)) lastTickMs = Math.max(lastTickMs, tMs);
    return snapshot();
  };

  const resetCurrentGate = (
    tMs: number,
    processorRef?: string
  ): GuidedDemoSnapshot => {
    if (Number.isFinite(tMs)) {
      lastTickMs = Math.max(lastTickMs, tMs);
      if (
        neutralProcessorRef &&
        processorRef &&
        processorRef !== neutralProcessorRef &&
        (currentPhase() === "smile" ||
          currentPhase() === "eye-closure" ||
          currentPhase() === "complete")
      ) {
        rewindToNeutral(tMs, processorRef);
        return snapshot();
      }
    }
    resetGateTracking(processorRef);
    return snapshot();
  };

  const reset = (startedAtMs = 0): void => {
    phaseIndex = 0;
    phaseStartedAt = startedAtMs;
    lastTickMs = startedAtMs;
    lastSignalAt = Number.NEGATIVE_INFINITY;
    transitionId = 0;
    lastTransition = null;
    neutralProcessorRef = undefined;
    speechWindowObserved = false;
    initialFaceWindowObserved = false;
    withholdingObserved = false;
    neutralFaceObserved = false;
    smileObserved = false;
    eyeClosureObserved = false;
    acceptedEvidence.clear();
    confirmations.establishing = "pending";
    confirmations.withholding = "pending";
    confirmations.neutralFace = "pending";
    confirmations.smile = "pending";
    confirmations.eyeClosure = "pending";
    resetGateTracking();
  };

  return {
    observe,
    tick,
    resetCurrentGate,
    reset,
    snapshot
  };
}
