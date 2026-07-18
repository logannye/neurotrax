export type GuidedPhase =
  | "establishing"
  | "turn-away"
  | "return"
  | "post-recovery"
  | "complete";

export interface GuidedDemoSnapshot {
  phase: GuidedPhase;
  speechWindowObserved: boolean;
  initialFaceWindowObserved: boolean;
  withholdingObserved: boolean;
  recoveryObserved: boolean;
  postRecoveryWindowObserved: boolean;
  canComplete: boolean;
}

export interface GuidedDemoController {
  ingest(input: {
    tMs: number;
    speechActive: boolean;
    faceUsable: boolean;
  }): GuidedDemoSnapshot;
  noteSpeechWindow(): GuidedDemoSnapshot;
  reset(): void;
  snapshot(): GuidedDemoSnapshot;
}

const INITIAL_FACE_MS = 1500;
const WITHHOLD_MS = 750;
const RECOVERY_MS = 750;
const POST_RECOVERY_MS = 1500;

export function createGuidedDemoController(): GuidedDemoController {
  let phase: GuidedPhase = "establishing";
  let speechWindowObserved = false;
  let faceGoodSince: number | null = null;
  let faceBadSince: number | null = null;
  let initialFaceWindowObserved = false;
  let withholdingObserved = false;
  let recoveryObserved = false;
  let postRecoveryWindowObserved = false;
  let lastSpeechActiveMs: number | null = null;

  const snapshot = (): GuidedDemoSnapshot => ({
    phase,
    speechWindowObserved,
    initialFaceWindowObserved,
    withholdingObserved,
    recoveryObserved,
    postRecoveryWindowObserved,
    canComplete:
      speechWindowObserved &&
      initialFaceWindowObserved &&
      withholdingObserved &&
      recoveryObserved &&
      postRecoveryWindowObserved
  });

  const reset = (): void => {
    phase = "establishing";
    speechWindowObserved = false;
    faceGoodSince = null;
    faceBadSince = null;
    initialFaceWindowObserved = false;
    withholdingObserved = false;
    recoveryObserved = false;
    postRecoveryWindowObserved = false;
    lastSpeechActiveMs = null;
  };

  return {
    ingest({ tMs, speechActive, faceUsable }) {
      if (speechActive) lastSpeechActiveMs = tMs;
      const speechIsContinuing =
        lastSpeechActiveMs !== null && tMs - lastSpeechActiveMs <= 300;

      if (phase === "establishing") {
        if (faceUsable) {
          faceGoodSince ??= tMs;
          if (
            speechWindowObserved &&
            tMs - faceGoodSince >= INITIAL_FACE_MS
          ) {
            initialFaceWindowObserved = true;
            phase = "turn-away";
            faceBadSince = null;
          }
        } else {
          faceGoodSince = null;
        }
      } else if (phase === "turn-away") {
        if (!faceUsable && speechIsContinuing) {
          faceBadSince ??= tMs;
          if (tMs - faceBadSince >= WITHHOLD_MS) {
            withholdingObserved = true;
            phase = "return";
            faceGoodSince = null;
          }
        } else {
          faceBadSince = null;
        }
      } else if (phase === "return") {
        if (faceUsable) {
          faceGoodSince ??= tMs;
          if (tMs - faceGoodSince >= RECOVERY_MS) {
            recoveryObserved = true;
            phase = "post-recovery";
            faceGoodSince = tMs;
          }
        } else {
          faceGoodSince = null;
        }
      } else if (phase === "post-recovery") {
        if (faceUsable) {
          faceGoodSince ??= tMs;
          if (tMs - faceGoodSince >= POST_RECOVERY_MS) {
            postRecoveryWindowObserved = true;
            phase = "complete";
          }
        } else {
          faceGoodSince = null;
        }
      }

      return snapshot();
    },
    noteSpeechWindow() {
      speechWindowObserved = true;
      return snapshot();
    },
    reset,
    snapshot
  };
}
