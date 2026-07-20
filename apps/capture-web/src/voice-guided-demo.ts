import type {
  CompletionGatedVoicePolicy,
  GuidedVoiceTaskContext,
  GuidedVoiceTaskEvidenceInterval,
  VoiceCompletionGateProgress
} from "@phenometric/contracts";

export const VOICE_FOUNDATION_POLICY: CompletionGatedVoicePolicy = {
  id: "voice-completion-gated-v1",
  maximumContinuousSignalGapMs: 40,
  assistanceAfterMs: 12_000,
  phases: [
    {
      phase: "sustained-vowel-1",
      evidenceDurationMs: 3_000,
      assistanceAfterMs: 12_000,
      requiredPeriodicityCoverage: 0.8,
      permitsNaturalPauses: false,
      successCondition:
        "continuous-voiced-vowel-with-reliable-periodicity"
    },
    {
      phase: "sustained-vowel-2",
      evidenceDurationMs: 3_000,
      assistanceAfterMs: 12_000,
      requiredPeriodicityCoverage: 0.8,
      permitsNaturalPauses: false,
      successCondition:
        "second-continuous-voiced-vowel-with-reliable-periodicity"
    },
    {
      phase: "standardized-reading",
      evidenceDurationMs: 4_000,
      assistanceAfterMs: 12_000,
      permitsNaturalPauses: false,
      successCondition: "continuous-usable-voiced-reading"
    },
    {
      phase: "rapid-syllables",
      evidenceDurationMs: 4_000,
      assistanceAfterMs: 12_000,
      requiredSyllabicNuclei: 6,
      permitsNaturalPauses: false,
      successCondition:
        "continuous-usable-rapid-syllable-evidence-with-six-nuclei"
    },
    {
      phase: "spontaneous-response",
      evidenceDurationMs: 8_000,
      assistanceAfterMs: 12_000,
      permitsNaturalPauses: true,
      successCondition:
        "usable-spontaneous-response-with-natural-pauses"
    }
  ]
};

export type GuidedVoicePhase = GuidedVoiceTaskContext | "complete";

export interface VoiceGateSignal {
  tMs: number;
  voiced: boolean;
  periodicityReliable: boolean;
  syllabicNucleus: boolean;
  qualityUsable: boolean;
  quietPauseUsable: boolean;
  processorRef: string;
}

export interface VoiceGuidedSnapshot {
  phase: GuidedVoicePhase;
  phaseStartedAtMs: number;
  phaseElapsedMs: number;
  progress: VoiceCompletionGateProgress;
  needsAssistance: boolean;
  assistanceText: string | null;
  acceptedEvidenceIntervals:
    readonly GuidedVoiceTaskEvidenceInterval[];
  transitionId: number;
  lastCompletedPhase: GuidedVoiceTaskContext | null;
  canComplete: boolean;
}

export interface VoiceGuidedController {
  observe(signal: VoiceGateSignal): VoiceGuidedSnapshot;
  tick(tMs: number): VoiceGuidedSnapshot;
  resetCurrentGate(tMs: number): VoiceGuidedSnapshot;
  reset(tMs?: number): void;
  snapshot(tMs?: number): VoiceGuidedSnapshot;
}

function assistanceFor(phase: GuidedVoiceTaskContext): string {
  if (
    phase === "sustained-vowel-1" ||
    phase === "sustained-vowel-2"
  ) {
    return "Take a comfortable breath, then sustain “ah” steadily. Keep a consistent distance from the microphone.";
  }
  if (phase === "standardized-reading") {
    return "Read the displayed sentence at a comfortable pace and volume.";
  }
  if (phase === "rapid-syllables") {
    return "Repeat “pa-ta-ka” clearly and continuously until the progress completes.";
  }
  return "Describe a familiar daily routine in your natural voice. Brief natural pauses are allowed.";
}

export function createVoiceGuidedController(
  policy: CompletionGatedVoicePolicy = VOICE_FOUNDATION_POLICY
): VoiceGuidedController {
  let phaseIndex = 0;
  let phaseStartedAtMs = 0;
  let lastSignalAtMs = Number.NEGATIVE_INFINITY;
  let gateStartedAtMs: number | null = null;
  let lastAcceptedAtMs: number | null = null;
  let voicedEvidenceMs = 0;
  let periodicFrames = 0;
  let eligibleFrames = 0;
  let nuclei = 0;
  let processorRef: string | null = null;
  let transitionId = 0;
  let lastCompletedPhase: GuidedVoiceTaskContext | null = null;
  let lastSnapshotAtMs = 0;
  const accepted: GuidedVoiceTaskEvidenceInterval[] = [];

  const phase = (): GuidedVoicePhase =>
    policy.phases[phaseIndex]?.phase ?? "complete";

  const resetGate = (tMs: number): void => {
    gateStartedAtMs = null;
    lastAcceptedAtMs = null;
    voicedEvidenceMs = 0;
    periodicFrames = 0;
    eligibleFrames = 0;
    nuclei = 0;
    processorRef = null;
    lastSnapshotAtMs = Math.max(lastSnapshotAtMs, tMs);
  };

  const snapshot = (tMs = lastSnapshotAtMs): VoiceGuidedSnapshot => {
    const current = phase();
    const config = policy.phases[phaseIndex];
    const now = Math.max(lastSnapshotAtMs, tMs);
    const evidenceMs =
      gateStartedAtMs === null || lastAcceptedAtMs === null
        ? 0
        : Math.min(
            config?.evidenceDurationMs ?? 0,
            lastAcceptedAtMs - gateStartedAtMs
          );
    const periodicityCoverage =
      eligibleFrames === 0 ? 0 : periodicFrames / eligibleFrames;
    const evidenceFraction =
      !config || config.evidenceDurationMs === 0
        ? 1
        : evidenceMs / config.evidenceDurationMs;
    const periodicityFraction =
      !config?.requiredPeriodicityCoverage
        ? 1
        : Math.min(
            1,
            periodicityCoverage /
              config.requiredPeriodicityCoverage
          );
    const nucleiFraction =
      !config?.requiredSyllabicNuclei
        ? 1
        : Math.min(1, nuclei / config.requiredSyllabicNuclei);
    const phaseElapsedMs =
      current === "complete"
        ? 0
        : Math.max(0, now - phaseStartedAtMs);
    return {
      phase: current,
      phaseStartedAtMs,
      phaseElapsedMs,
      progress: {
        usableEvidenceMs: evidenceMs,
        evidenceRequiredMs: config?.evidenceDurationMs ?? 0,
        voicedEvidenceMs,
        periodicityCoverage,
        syllabicNuclei: nuclei,
        requiredSyllabicNuclei:
          config?.requiredSyllabicNuclei ?? 0,
        fraction:
          current === "complete"
            ? 1
            : Math.min(
                evidenceFraction,
                periodicityFraction,
                nucleiFraction
              )
      },
      needsAssistance:
        current !== "complete" &&
        phaseElapsedMs >=
          (config?.assistanceAfterMs ?? policy.assistanceAfterMs),
      assistanceText:
        current !== "complete" &&
        phaseElapsedMs >=
          (config?.assistanceAfterMs ?? policy.assistanceAfterMs)
          ? assistanceFor(current)
          : null,
      acceptedEvidenceIntervals: accepted.map((interval) => ({
        ...interval
      })),
      transitionId,
      lastCompletedPhase,
      canComplete: current === "complete"
    };
  };

  const observe = (signal: VoiceGateSignal): VoiceGuidedSnapshot => {
    if (
      !Number.isFinite(signal.tMs) ||
      signal.tMs < lastSignalAtMs ||
      phase() === "complete"
    ) {
      return snapshot();
    }
    const priorAt = lastSignalAtMs;
    lastSignalAtMs = signal.tMs;
    lastSnapshotAtMs = Math.max(lastSnapshotAtMs, signal.tMs);
    const current = phase();
    if (current === "complete") return snapshot();
    const config = policy.phases[phaseIndex];

    if (
      Number.isFinite(priorAt) &&
      signal.tMs - priorAt >
        policy.maximumContinuousSignalGapMs
    ) {
      resetGate(signal.tMs);
    }
    if (processorRef && processorRef !== signal.processorRef) {
      resetGate(signal.tMs);
    }
    processorRef ??= signal.processorRef;

    const signalAllowed =
      signal.qualityUsable ||
      (config.permitsNaturalPauses &&
        !signal.voiced &&
        signal.quietPauseUsable);
    const behaviorAllowed =
      config.permitsNaturalPauses || signal.voiced;
    if (!signalAllowed || !behaviorAllowed) {
      resetGate(signal.tMs);
      return snapshot();
    }

    gateStartedAtMs ??= signal.tMs;
    const deltaMs =
      lastAcceptedAtMs === null
        ? 0
        : Math.max(0, signal.tMs - lastAcceptedAtMs);
    lastAcceptedAtMs = signal.tMs;
    eligibleFrames += 1;
    if (signal.voiced) voicedEvidenceMs += deltaMs;
    if (signal.periodicityReliable) periodicFrames += 1;
    if (signal.syllabicNucleus) nuclei += 1;

    const evidenceMs = signal.tMs - gateStartedAtMs;
    const periodicityCoverage =
      periodicFrames / Math.max(1, eligibleFrames);
    const periodicityReady =
      config.requiredPeriodicityCoverage === undefined ||
      periodicityCoverage >= config.requiredPeriodicityCoverage;
    const nucleiReady =
      config.requiredSyllabicNuclei === undefined ||
      nuclei >= config.requiredSyllabicNuclei;
    const voicedReady =
      !config.permitsNaturalPauses ||
      voicedEvidenceMs >= config.evidenceDurationMs * 0.5;
    if (
      evidenceMs >= config.evidenceDurationMs &&
      periodicityReady &&
      nucleiReady &&
      voicedReady
    ) {
      accepted.push({
        taskContext: current,
        startMs: signal.tMs - config.evidenceDurationMs,
        endMs: signal.tMs,
        taskStartedAtMs: phaseStartedAtMs,
        processorRef: signal.processorRef
      });
      lastCompletedPhase = current;
      transitionId += 1;
      phaseIndex += 1;
      phaseStartedAtMs = signal.tMs;
      resetGate(signal.tMs);
    }
    return snapshot();
  };

  return {
    observe,
    tick(tMs) {
      if (Number.isFinite(tMs)) {
        lastSnapshotAtMs = Math.max(lastSnapshotAtMs, tMs);
      }
      return snapshot();
    },
    resetCurrentGate(tMs) {
      resetGate(tMs);
      return snapshot(tMs);
    },
    reset(tMs = 0) {
      phaseIndex = 0;
      phaseStartedAtMs = tMs;
      lastSignalAtMs = Number.NEGATIVE_INFINITY;
      transitionId = 0;
      lastCompletedPhase = null;
      lastSnapshotAtMs = tMs;
      accepted.length = 0;
      resetGate(tMs);
    },
    snapshot
  };
}
