import "./styles.css";
import {
  createNeutralFacialBaseline,
  createConductorSession,
  createEventFactory,
  evaluateEyeClosureAdherence,
  evaluateSmileAdherence,
  evaluateVisualQuality,
  type AudioFeatureFrame,
  type ConductorSession,
  type FacialKinematicsFrameV1,
  type NeutralFacialBaseline
} from "@phenometric/ambient-core";
import {
  createModalityOutcomes,
  EVIDENCE_BOUNDARY
} from "@phenometric/evidence-core";
import type {
  AmbientActorId,
  AmbientEventType,
  CalibrationQuality,
  CaptureCalibration,
  EncounterObservation,
  EvidenceCardClaim,
  EvidenceCardDraft,
  EvidenceSynthesisTiming,
  EventEnvelope,
  GroundingResult,
  ModalityOutcome,
  ReviewDecision,
  VideoCaptureSettings,
  VisualPipelineProvenance,
  VisualQualityReasonCode,
  VisualTaskContext,
  WorkflowStage
} from "@phenometric/contracts";
import {
  calculateRms,
  createVoiceActivityTracker,
  type DerivedAudioFeature
} from "./audio-features.js";
import {
  calibrateFaceFrame,
  classifyAudioCalibration,
  classifyFaceCalibration,
  createCaptureCalibration,
  preflightFaceGuidance
} from "./capture-calibration.js";
import {
  createGuidedDemoController,
  JUDGE_READY_COMPLETION_POLICY,
  type GuidedPhase,
  type GuidedDemoSnapshot
} from "./guided-demo.js";
import {
  FRAME_STREAM_SCHEMA_VERSION,
  LatestFrameScheduler,
  OverlayRenderThrottle,
  VideoFramePump,
  VisualLaneGuard,
  VisualResultAcceptanceGuard,
  VisualWorkerRestartBudget,
  type FrameStreamDiagnostics
} from "./visual-frame-pump.js";
import {
  VISUAL_WORKER_MESSAGE_VERSION,
  createVisualWorkerAttachOverlayMessage,
  createVisualWorkerClearOverlayMessage,
  visualPipelineProvenance,
  visualWorkerMessage,
  type VisualWorkerFrameMessage,
  type VisualWorkerResponse
} from "./face-worker-protocol.js";

type CaptureState =
  | "idle"
  | "requesting"
  | "calibrating-quiet"
  | "calibrating-voice"
  | "ready"
  | "capturing"
  | "analyzing"
  | "review"
  | "reviewed"
  | "error";

interface EvidenceApiResult {
  draft: EvidenceCardDraft;
  grounding: GroundingResult;
  model: string;
  promptVersion: string;
  responseId: string;
  attemptCount: number;
  timing: EvidenceSynthesisTiming;
}

function element<T extends HTMLElement>(id: string): T {
  const value = document.getElementById(id);
  if (!value) throw new Error(`Missing required element #${id}`);
  return value as T;
}

const cameraPreview = element<HTMLVideoElement>("camera-preview");
const faceOverlay = element<HTMLCanvasElement>("face-overlay");
let landmarkOverlay = element<HTMLCanvasElement>("landmark-overlay");
const meshDisclosure = element<HTMLDivElement>("mesh-disclosure");
const cameraEmpty = element<HTMLDivElement>("camera-empty");
const liveStrip = element<HTMLDivElement>("live-strip");
const cameraCallout = element<HTMLDivElement>("camera-callout");
const cameraCalloutText = element<HTMLElement>("camera-callout-text");
const sessionClock = element<HTMLDivElement>("session-clock");
const guidanceCard = element<HTMLDivElement>("guidance-card");
const guidanceStep = element<HTMLElement>("guidance-step");
const guidanceTitle = element<HTMLElement>("guidance-title");
const guidanceDetail = element<HTMLElement>("guidance-detail");
const guidanceProgressFill =
  element<HTMLSpanElement>("guidance-progress-fill");
const guidanceProgress =
  element<HTMLDivElement>("guidance-progress");
const consentCheckbox = element<HTMLInputElement>("consent-checkbox");
const startButton = element<HTMLButtonElement>("start-button");
const stopButton = element<HTMLButtonElement>("stop-button");
const resetButton = element<HTMLButtonElement>("reset-button");
const captureHint = element<HTMLParagraphElement>("capture-hint");
const headerMode = element<HTMLSpanElement>("header-mode");
const headerPrivacyState =
  element<HTMLSpanElement>("header-privacy-state");
const privacyStatus = element<HTMLSpanElement>("privacy-status");
const voiceState = element<HTMLElement>("voice-state");
const speechDurationValue =
  element<HTMLElement>("speech-duration-value");
const pitchCoverageValue =
  element<HTMLElement>("pitch-coverage-value");
const speechSignalCaption =
  element<HTMLParagraphElement>("speech-signal-caption");
const micMeter = element<HTMLDivElement>("mic-meter");
const micMeterFill = element<HTMLSpanElement>("mic-meter-fill");
const faceState = element<HTMLElement>("face-state");
const faceQualityFill = element<HTMLSpanElement>("face-quality-fill");
const faceUsabilityValue =
  element<HTMLElement>("face-usability-value");
const faceRecoveryValue =
  element<HTMLElement>("face-recovery-value");
const faceSignalCaption =
  element<HTMLParagraphElement>("face-signal-caption");
const conductorStatus = element<HTMLParagraphElement>("conductor-status");
const conductorState = element<HTMLSpanElement>("conductor-state");
const speechStatus = element<HTMLParagraphElement>("speech-status");
const speechState = element<HTMLSpanElement>("speech-state");
const faceStatus = element<HTMLParagraphElement>("face-status");
const faceLaneState = element<HTMLSpanElement>("face-lane-state");
const evidenceStatus = element<HTMLParagraphElement>("evidence-status");
const evidenceState = element<HTMLSpanElement>("evidence-state");
const reviewStatus = element<HTMLParagraphElement>("review-status");
const reviewState = element<HTMLSpanElement>("review-state");
const eventCount = element<HTMLSpanElement>("event-count");
const eventList = element<HTMLOListElement>("event-list");
const coordinatorDecision =
  element<HTMLParagraphElement>("coordinator-decision");
const evidencePacket = element<HTMLDivElement>("evidence-packet");
const resultsPanel = element<HTMLElement>("results-panel");
const resultSummary = element<HTMLDivElement>("result-summary");
const captureHandoff = element<HTMLElement>("capture-handoff");
const groundingHandoff = element<HTMLElement>("grounding-handoff");
const reviewHandoff = element<HTMLElement>("review-handoff");
const aggregateGrid = element<HTMLDivElement>("aggregate-grid");
const evidenceLoading = element<HTMLDivElement>("evidence-loading");
const evidenceError = element<HTMLDivElement>("evidence-error");
const retryEvidenceButton =
  element<HTMLButtonElement>("retry-evidence-button");
const evidenceCard = element<HTMLElement>("evidence-card");
const evidenceHeadline = element<HTMLElement>("evidence-headline");
const evidenceSummary = element<HTMLElement>("evidence-summary");
const reportMetricGrid =
  element<HTMLDivElement>("report-metric-grid");
const evidenceClaims = element<HTMLDivElement>("evidence-claims");
const evidenceStatusChip = element<HTMLElement>("evidence-status-chip");
const boundaryStatement = element<HTMLElement>("boundary-statement");
const copyReportButton =
  element<HTMLButtonElement>("copy-report-button");
const acceptButton = element<HTMLButtonElement>("accept-button");
const rejectButton = element<HTMLButtonElement>("reject-button");
const reviewControls = element<HTMLDivElement>("review-controls");
const approvalConfirmation =
  element<HTMLDivElement>("approval-confirmation");
const reviewOutcome = element<HTMLParagraphElement>("review-outcome");
const traceDrawer = element<HTMLElement>("trace-drawer");
const traceBackdrop = element<HTMLDivElement>("trace-backdrop");
const traceCloseButton = element<HTMLButtonElement>("trace-close-button");
const traceTitle = element<HTMLElement>("trace-title");
const traceContent = element<HTMLDivElement>("trace-content");
const baselinePanel = element<HTMLElement>("baseline-panel");
const operatorDiagnostics =
  element<HTMLDetailsElement>("operator-diagnostics");
const operatorOutput = element<HTMLPreElement>("operator-output");

const query = new URLSearchParams(window.location.search);
const testCaptureMode =
  import.meta.env.DEV && query.get("testCapture") === "1";
const fastTestCapture = query.get("fast") === "1";
const observeTestTransitions = query.get("observe") === "1";
const testScenario = query.get("scenario") ?? "hero";
const operatorMode = query.get("operator") === "1";
const visualWorkerSmokeMode =
  import.meta.env.DEV && query.get("visualWorkerSmoke") === "1";
let testVisualCaptureSuspended = false;

const REQUESTED_VIDEO_CAPTURE = {
  width: 1280,
  height: 720,
  frameRate: 30
} as const;

function defaultVideoCaptureSettings(): VideoCaptureSettings {
  return {
    requested: { ...REQUESTED_VIDEO_CAPTURE },
    actual: {
      width: REQUESTED_VIDEO_CAPTURE.width,
      height: REQUESTED_VIDEO_CAPTURE.height,
      frameRate: REQUESTED_VIDEO_CAPTURE.frameRate
    },
    facingMode: "user",
    coordinateSpace: "normalized-unmirrored-image",
    displayMirrored: true,
    lateralityConvention: "subject-anatomical"
  };
}

let state: CaptureState = "idle";
let lifecycleGeneration = 0;
let mediaStream: MediaStream | null = null;
const pendingMediaStreams = new Set<MediaStream>();
let audioContext: AudioContext | null = null;
let audioSource: MediaStreamAudioSourceNode | null = null;
let analyser: AnalyserNode | null = null;
let sampleBuffer: Float32Array | null = null;
let sampleInterval: number | null = null;
let clockInterval: number | null = null;
let preflightStartedAt = 0;
let voiceCalibrationStartedAt = 0;
let systemCheckTimer: number | null = null;
let sessionStartedAtPerformance = 0;
let sessionStartedAtEpoch = 0;
let quietRmsSamples: number[] = [];
let preflightFaceFrames: FacialKinematicsFrameV1[] = [];
let preflightPitchedFrames = 0;
let preflightSpeechEnergyFrames = 0;
let calibration: CaptureCalibration | null = null;
let audioFrames: AudioFeatureFrame[] = [];
let receivedFaceFrameCount = 0;
let usableFaceFrameCount = 0;
let latestAudioFeature: DerivedAudioFeature | null = null;
let latestAudioFeatureAtMs = Number.NEGATIVE_INFINITY;
let latestFaceUsable = false;
let guidedPhaseFaceFrames: FacialKinematicsFrameV1[] = [];
let neutralFacialBaseline: NeutralFacialBaseline | null = null;
let faceWorkerReady = false;
let visualCaptureEpoch = 1;
let visualPipeline: VisualPipelineProvenance | null = null;
let videoCaptureSettings: VideoCaptureSettings =
  defaultVideoCaptureSettings();
let visualScheduler: LatestFrameScheduler<ImageBitmap> | null = null;
let visualFramePump: VideoFramePump<ImageBitmap> | null = null;
let visualSmokeSubmitted = false;
let landmarkOverlayAttached = false;
let landmarkOverlayTransferred = false;
let externalVisualWithholdingActive = false;
let latestVisualRuntimeDiagnostics: {
  acquiredAtMs: number;
  analyzedFrameRate: number;
  interResultGapMs: number | null;
  processingLatencyMs: number;
  qualityReasons: FacialKinematicsFrameV1["qualityReasons"];
} | null = null;
let lastOperatorDiagnosticsRenderAtMs = Number.NEGATIVE_INFINITY;
let synthesisReady = false;
let readinessChecked = false;
let conductorSession: ConductorSession | null = null;
let allEvents: EventEnvelope[] = [];
let latestObservation: EncounterObservation | null = null;
let latestOutcomes: [ModalityOutcome, ModalityOutcome] | null = null;
let latestEvidence: EvidenceApiResult | null = null;
let evidenceReviewReady = false;
let captureFinalizationScheduled = false;
let resultsVisible = false;
let captureVisitId = "";
let captureParticipantId = "developer-self-demo";
let lastGuidedTransitionId = 0;
let lastAssistancePhase: GuidedPhase | null = null;
let lastFaceQuality: "unknown" | "measurable" | "withheld" = "unknown";
let faceWindowOpen = false;
let packetTimer: number | null = null;
let cameraCalloutTimer: number | null = null;
let traceCloseTimer: number | null = null;
let resetCaptureOperation: Promise<void> | null = null;
let testProcessorChangeInjected = false;
const voiceTracker = createVoiceActivityTracker();
const guidedDemo = createGuidedDemoController();
const visualLaneGuard = new VisualLaneGuard();
const visualResultAcceptanceGuard =
  new VisualResultAcceptanceGuard();
const visualWorkerRestartBudget = new VisualWorkerRestartBudget();
const overlayRenderThrottle = new OverlayRenderThrottle(12);

type HandoffState = "pending" | "active" | "complete";

function setHandoffStep(
  step: HTMLElement,
  nextState: HandoffState,
  label: string,
  eventId?: string
): void {
  step.classList.remove("is-pending", "is-active", "is-complete");
  step.classList.add(`is-${nextState}`);
  const stateLabel = step.querySelector<HTMLElement>(".handoff-state");
  if (stateLabel) stateLabel.textContent = label;
  if (eventId) step.dataset.eventId = eventId;
  else delete step.dataset.eventId;
}

function resetHandoff(): void {
  setHandoffStep(captureHandoff, "pending", "Next");
  setHandoffStep(groundingHandoff, "pending", "Next");
  setHandoffStep(reviewHandoff, "pending", "Next");
}

function createFaceWorker(): Worker {
  return new Worker(new URL("./face-worker.ts", import.meta.url), {
    type: "module"
  });
}

let faceWorker = createFaceWorker();

function replaceLandmarkOverlayCanvas(): void {
  const replacement = document.createElement("canvas");
  replacement.id = "landmark-overlay";
  replacement.className = "landmark-overlay";
  replacement.setAttribute("aria-hidden", "true");
  replacement.hidden = true;
  landmarkOverlay.replaceWith(replacement);
  landmarkOverlay = replacement;
  landmarkOverlayAttached = false;
  landmarkOverlayTransferred = false;
  meshDisclosure.hidden = true;
}

function attachLandmarkOverlay(worker: Worker): boolean {
  const transferableCanvas = landmarkOverlay as HTMLCanvasElement & {
    transferControlToOffscreen?: () => OffscreenCanvas;
  };
  if (typeof transferableCanvas.transferControlToOffscreen !== "function") {
    landmarkOverlay.hidden = true;
    meshDisclosure.hidden = true;
    return false;
  }
  try {
    const offscreen = transferableCanvas.transferControlToOffscreen();
    landmarkOverlayTransferred = true;
    worker.postMessage(
      createVisualWorkerAttachOverlayMessage(
        visualCaptureEpoch,
        offscreen,
        12
      ),
      [offscreen]
    );
    // The worker confirms that a 2D context was created before the UI claims
    // that the mesh is live.
    landmarkOverlayAttached = false;
    landmarkOverlay.hidden = true;
    meshDisclosure.hidden = true;
    return true;
  } catch {
    landmarkOverlayAttached = false;
    landmarkOverlay.hidden = true;
    meshDisclosure.hidden = true;
    return false;
  }
}

function clearLandmarkOverlay(): void {
  landmarkOverlay.hidden = true;
  meshDisclosure.hidden = true;
  if (landmarkOverlayTransferred) {
    try {
      faceWorker.postMessage(
        createVisualWorkerClearOverlayMessage(visualCaptureEpoch)
      );
    } catch {
      // A terminated worker already releases its transferred display surface.
    }
    return;
  }
  const context = landmarkOverlay.getContext("2d");
  context?.clearRect(
    0,
    0,
    landmarkOverlay.width,
    landmarkOverlay.height
  );
}

function clearAllVisualOverlays(): void {
  clearLandmarkOverlay();
  faceOverlay.getContext("2d")?.clearRect(
    0,
    0,
    faceOverlay.width,
    faceOverlay.height
  );
}

function showLandmarkOverlay(): void {
  if (!landmarkOverlayAttached) return;
  landmarkOverlay.hidden = false;
  meshDisclosure.hidden = false;
}

function formatElapsed(elapsedMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  return `${Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, "0")}:${(totalSeconds % 60)
    .toString()
    .padStart(2, "0")}`;
}

function formatValue(value: number, unit: string): string {
  if (unit === "count") return Math.round(value).toString();
  if (Math.abs(value) >= 10) return value.toFixed(1);
  return value.toFixed(3);
}

function displayUnit(unit: string): string {
  if (unit === "semitone-stddev") return "semitone variation";
  if (unit === "pauses-per-minute") return "pauses/min";
  if (unit === "inter-eye-normalized-distance") {
    return "inter-eye normalized";
  }
  if (unit === "fraction") return "fraction";
  if (unit === "hertz") return "Hz";
  if (unit === "seconds") return "sec";
  if (unit === "ratio") return "voiced";
  return unit;
}

function formatDisplayMetric(
  value: number,
  unit: string
): { value: string; unit: string } {
  if (unit === "ratio") {
    return {
      value: `${Math.round(value * 100)}%`,
      unit: displayUnit(unit)
    };
  }
  if (unit === "seconds") {
    return {
      value: value < 1 ? value.toFixed(2) : value.toFixed(1),
      unit: displayUnit(unit)
    };
  }
  return { value: formatValue(value, unit), unit: displayUnit(unit) };
}

function humanizeMeasurementText(text: string): string {
  return text
    .replaceAll("semitone-stddev", "semitone variation")
    .replaceAll("pauses-per-minute", "pauses/min")
    .replaceAll(
      "inter-eye-normalized-distance",
      "inter-eye normalized distance"
    );
}

function metricCategory(code: string): string {
  if (
    code.includes("onset_latency") ||
    code.includes("pause_rate") ||
    code.includes("voiced_time")
  ) {
    return "Speech timing + fluency";
  }
  if (code.startsWith("prototype.speech.")) {
    return "Voice modulation";
  }
  return "Facial motor function";
}

function biomarkerOrder(code: string): number {
  const order = [
    "prototype.speech.onset_latency",
    "prototype.speech.voiced_time_fraction",
    "prototype.speech.pause_rate",
    "prototype.speech.pitch_center",
    "prototype.speech.pitch_variability",
    "prototype.face.smile_excursion.left",
    "prototype.face.smile_excursion.right",
    "prototype.face.smile_excursion.asymmetry",
    "prototype.face.eye_closure_fraction.left",
    "prototype.face.eye_closure_fraction.right",
    "prototype.face.eye_closure_fraction.asymmetry"
  ];
  const index = order.indexOf(code);
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

function formatTraceQualityFacts(
  qualityFacts: Record<string, string | number | boolean>
): string {
  const labels: Record<string, string> = {
    activeFrames: "Analyzed speech samples",
    pitchCoverage: "Pitch coverage",
    recoveryConfirmed: "Facial task evidence",
    usableFraction: "Facial usability",
    usableWindows: "Accepted windows",
    withholdingMs: "Paused interval"
  };
  const formatFact = (
    key: string,
    value: string | number | boolean
  ): string => {
    if (key === "pitchCoverage" || key === "usableFraction") {
      return `${Math.round(Number(value) * 100)}%`;
    }
    if (key === "withholdingMs") {
      return `${(Number(value) / 1000).toFixed(1)} seconds`;
    }
    if (key === "recoveryConfirmed") {
      return value ? "Available" : "Not observed";
    }
    return String(value);
  };
  return Object.entries(qualityFacts)
    .map(
      ([key, value]) =>
        `${labels[key] ?? "Signal quality"}: ${formatFact(key, value)}`
    )
    .join("\n");
}

function setHeaderPrivacy(label: string): void {
  const dot = headerPrivacyState.querySelector("span");
  headerPrivacyState.replaceChildren();
  if (dot) headerPrivacyState.append(dot);
  headerPrivacyState.append(document.createTextNode(label));
}

function showCameraCallout(
  text: string,
  tone: "teal" | "amber",
  eventId: string,
  durationMs?: number
): void {
  window.clearTimeout(cameraCalloutTimer ?? undefined);
  cameraCallout.dataset.tone = tone;
  cameraCallout.dataset.eventId = eventId;
  cameraCalloutText.textContent = text;
  cameraCallout.hidden = false;
  cameraCallout.classList.remove("is-entering");
  requestAnimationFrame(() => cameraCallout.classList.add("is-entering"));
  if (durationMs !== undefined) {
    cameraCalloutTimer = window.setTimeout(() => {
      cameraCallout.hidden = true;
      cameraCalloutTimer = null;
    }, durationMs);
  }
}

function setCoordinatorDecision(
  text: string,
  eventId: string
): void {
  coordinatorDecision.textContent = text;
  coordinatorDecision.dataset.eventId = eventId;
  coordinatorDecision.classList.remove("is-updated");
  requestAnimationFrame(() =>
    coordinatorDecision.classList.add("is-updated")
  );
}

function setLane(
  stateElement: HTMLElement,
  statusElement: HTMLElement,
  label: string,
  detail: string,
  status: "active" | "complete" | "warning" | "quiet"
): void {
  stateElement.textContent = label;
  stateElement.dataset.status = status;
  statusElement.textContent = detail;
  const node = stateElement.closest<HTMLElement>(".agent-node");
  node?.classList.toggle("is-processing", status === "active");
  node?.classList.toggle("is-warning", status === "warning");
}

function refreshStartAvailability(): void {
  if (state === "idle") {
    startButton.textContent = "Run system check";
    startButton.disabled = !consentCheckbox.checked;
  } else if (state === "ready") {
    startButton.textContent = "Begin assessment";
    startButton.disabled = false;
  }
}

function updateState(nextState: CaptureState, detail?: string): void {
  state = nextState;
  document.body.dataset.captureState = nextState;
  const labels: Record<CaptureState, string> = {
    idle: "Ready",
    requesting: "Connecting",
    "calibrating-quiet": "System check",
    "calibrating-voice": "System check",
    ready: "Check complete",
    capturing: "Assessment live",
    analyzing: "Preparing summary",
    review: "Review ready",
    reviewed: "Complete",
    error: "Needs attention"
  };
  headerMode.textContent = labels[nextState];
  setHeaderPrivacy(
    ["requesting", "calibrating-quiet", "calibrating-voice", "ready", "capturing"].includes(
      nextState
    )
      ? "Processing in session"
      : ["analyzing", "review", "reviewed"].includes(nextState)
        ? "Devices released"
        : "Devices off"
  );

  startButton.disabled = true;
  stopButton.disabled = true;
  stopButton.hidden = true;
  resetButton.hidden = !["review", "reviewed", "error"].includes(nextState);

  if (nextState === "idle" || nextState === "ready") {
    refreshStartAvailability();
  }
  if (nextState === "capturing") {
    stopButton.textContent = "End assessment";
    stopButton.hidden = false;
    stopButton.disabled = false;
  }
  if (nextState === "analyzing") {
    stopButton.textContent = "Summary in progress";
    stopButton.hidden = true;
    stopButton.disabled = true;
  }
  if (detail) captureHint.textContent = detail;
}

function clearEventList(): void {
  eventList.replaceChildren();
  eventCount.textContent = "Agents ready";
  coordinatorDecision.textContent =
    "Waiting to coordinate the assessment.";
  delete coordinatorDecision.dataset.eventId;
}

function milestone(name: string): HTMLElement | null {
  return document.querySelector(`[data-milestone="${name}"]`);
}

function updateMilestones(snapshot: GuidedDemoSnapshot): void {
  milestone("speech")?.classList.toggle(
    "is-complete",
    snapshot.confirmations.establishing === "confirmed" ||
      snapshot.phase !== "establishing"
  );
  milestone("withheld")?.classList.toggle(
    "is-complete",
    snapshot.confirmations.withholding === "confirmed" ||
      ["neutral-face", "smile", "eye-closure", "complete"].includes(
        snapshot.phase
      )
  );
  milestone("neutral")?.classList.toggle(
    "is-complete",
    snapshot.confirmations.neutralFace === "confirmed" ||
      ["smile", "eye-closure", "complete"].includes(snapshot.phase)
  );
  milestone("smile")?.classList.toggle(
    "is-complete",
    snapshot.confirmations.smile === "confirmed" ||
      ["eye-closure", "complete"].includes(snapshot.phase)
  );
  milestone("eye-closure")?.classList.toggle(
    "is-complete",
    snapshot.confirmations.eyeClosure === "confirmed" ||
      snapshot.phase === "complete"
  );
  const progressPercent = Math.round(snapshot.progress.fraction * 100);
  guidanceProgressFill.style.width = `${progressPercent}%`;
  guidanceProgress.setAttribute(
    "aria-valuenow",
    progressPercent.toString()
  );

  if (snapshot.phase === "establishing") {
    guidanceStep.textContent = "Step 1 of 5";
    guidanceTitle.textContent = "Speak naturally";
    guidanceDetail.textContent =
      snapshot.assistanceText ??
      "Keep your face centered and continue speaking until the signal is confirmed.";
  } else if (snapshot.phase === "turn-away") {
    guidanceStep.textContent = "Step 2 of 5";
    guidanceTitle.textContent = "Briefly turn away";
    guidanceDetail.textContent =
      snapshot.assistanceText ??
      "Continue speaking and turn away until Facial Analysis pauses.";
  } else if (snapshot.phase === "neutral-face") {
    guidanceStep.textContent = "Step 3 of 5";
    guidanceTitle.textContent = "Hold a quiet neutral reference";
    guidanceDetail.textContent =
      snapshot.assistanceText ??
      "Face the camera, stop speaking, and hold still while a neutral reference is captured.";
  } else if (snapshot.phase === "smile") {
    guidanceStep.textContent = "Step 4 of 5";
    guidanceTitle.textContent = "Smile comfortably";
    guidanceDetail.textContent =
      snapshot.assistanceText ??
      "Stay quiet and hold a comfortable smile until the signal is confirmed.";
  } else if (snapshot.phase === "eye-closure") {
    guidanceStep.textContent = "Step 5 of 5";
    guidanceTitle.textContent = "Close and reopen your eyes";
    guidanceDetail.textContent =
      snapshot.assistanceText ??
      "Stay quiet, gently close your eyes, hold briefly, then reopen them fully.";
  } else {
    guidanceStep.textContent = "Capture complete";
    guidanceTitle.textContent = "Preparing encounter summary";
    guidanceDetail.textContent =
      "The assessment is complete. Camera and microphone access will now be released.";
    captureHint.textContent =
      "All assessment requirements are complete. Preparing the encounter summary.";
  }

  if (
    snapshot.canComplete &&
    state === "capturing" &&
    !captureFinalizationScheduled
  ) {
    captureFinalizationScheduled = true;
    queueMicrotask(() => void finalizeCapture());
  }
}

function recordGuidedTransition(snapshot: GuidedDemoSnapshot): void {
  const transition = snapshot.lastTransition;
  if (!transition || transition.id <= lastGuidedTransitionId) return;
  lastGuidedTransitionId = transition.id;
  lastAssistancePhase = null;
  const completion = emitWorkflowEvent(
    "capture-conductor",
    "demo.phase.completed",
    "ambient-capture",
    `Completed the ${transition.from} phase with its target signal confirmed.`,
    {
      phase: transition.from,
      confirmation: "confirmed",
      transitionAtMs: transition.atMs,
      acceptedEvidenceInterval: transition.acceptedEvidenceInterval
    }
  );
  const decisionSummary =
    `Coordinator advanced after confirming ${transition.from.replaceAll("-", " ")}.`;
  emitWorkflowEvent(
    "capture-conductor",
    "coordinator.decision.recorded",
    "ambient-capture",
    decisionSummary,
    {
      phase: transition.from,
      decision: "advance",
      confirmation: "confirmed"
    },
    [],
    completion.eventId
  );
  if (transition.to !== "complete") {
    emitWorkflowEvent(
      "capture-conductor",
      "demo.phase.started",
      "ambient-capture",
      `Started the ${transition.to} phase.`,
      { phase: transition.to },
      [],
      completion.eventId
    );
  }
}

function recordGuidedAssistance(snapshot: GuidedDemoSnapshot): void {
  if (
    !snapshot.needsAssistance ||
    snapshot.phase === "complete" ||
    lastAssistancePhase === snapshot.phase
  ) {
    return;
  }
  lastAssistancePhase = snapshot.phase;
  const event = emitWorkflowEvent(
    "capture-conductor",
    "coordinator.decision.recorded",
    "ambient-capture",
    `Corrective guidance shown for the ${snapshot.phase} criterion.`,
    {
      phase: snapshot.phase,
      decision: "corrective-guidance",
      assistanceCode: snapshot.assistanceCode,
      criterionProgress: snapshot.progress.fraction
    }
  );
  setCoordinatorDecision(
    "Current exercise needs a little adjustment",
    event.eventId
  );
  showCameraCallout(
    "Adjust and repeat the current exercise",
    "amber",
    event.eventId,
    2_500
  );
}

function advanceGuidedEncounter(tMs: number): void {
  if (state !== "capturing") return;
  const snapshot = guidedDemo.tick(tMs);
  recordGuidedAssistance(snapshot);
  updateMilestones(snapshot);
  const confirmedTasks = [
    snapshot.confirmations.neutralFace,
    snapshot.confirmations.smile,
    snapshot.confirmations.eyeClosure
  ].filter((confirmation) => confirmation === "confirmed").length;
  faceRecoveryValue.textContent = `${confirmedTasks}/3`;
}

function acceptedFramesForTransition(
  snapshot: GuidedDemoSnapshot
): FacialKinematicsFrameV1[] {
  const interval = snapshot.lastTransition?.acceptedEvidenceInterval;
  if (!interval) return [];
  return guidedPhaseFaceFrames.filter(
    (frame) =>
      frame.taskContext === interval.taskContext &&
      frame.tMs >= interval.startMs &&
      frame.tMs <= interval.endMs &&
      (interval.processorRef === undefined ||
        frame.processorRef === interval.processorRef)
  );
}

function observeGuidedFaceFrame(
  frame: FacialKinematicsFrameV1,
  usable: boolean
): void {
  if (state !== "capturing") return;
  const before = guidedDemo.snapshot(frame.tMs);
  if (
    before.phase === "complete" ||
    frame.taskContext !== before.phase
  ) {
    return;
  }

  guidedPhaseFaceFrames.push(frame);
  guidedPhaseFaceFrames = guidedPhaseFaceFrames.filter(
    (candidate) => frame.tMs - candidate.tMs <= 4_000
  );
  const audioAvailable =
    latestAudioFeature !== null &&
    Math.abs(frame.tMs - latestAudioFeatureAtMs) <= 250;
  const smile =
    neutralFacialBaseline === null
      ? null
      : evaluateSmileAdherence(neutralFacialBaseline, [frame]);
  const eyeClosure =
    neutralFacialBaseline === null
      ? null
      : evaluateEyeClosureAdherence(neutralFacialBaseline, [frame]);
  const snapshot = guidedDemo.observe({
    tMs: frame.tMs,
    audioAvailable,
    audioVoiced: latestAudioFeature?.voiced ?? false,
    audioClipped: latestAudioFeature?.clipped ?? false,
    visualUsable: usable,
    visualReasonCodes: frame.qualityReasons,
    processorRef: frame.processorRef,
    smile: {
      leftAdherent: smile?.adherent.left ?? false,
      rightAdherent: smile?.adherent.right ?? false
    },
    eyeClosure: {
      left: {
        closed: eyeClosure?.closed.left ?? false,
        recovered: eyeClosure?.recovered.left ?? false
      },
      right: {
        closed: eyeClosure?.closed.right ?? false,
        recovered: eyeClosure?.recovered.right ?? false
      }
    }
  });

  const transitioned =
    snapshot.lastTransition !== null &&
    snapshot.lastTransition.id > lastGuidedTransitionId;
  if (transitioned && snapshot.lastTransition?.from === "neutral-face") {
    neutralFacialBaseline = createNeutralFacialBaseline(
      acceptedFramesForTransition(snapshot)
    );
  } else if (
    !transitioned &&
    before.phase !== snapshot.phase &&
    snapshot.phase === "neutral-face"
  ) {
    neutralFacialBaseline = null;
  }
  if (before.phase !== snapshot.phase) {
    guidedPhaseFaceFrames =
      !transitioned && snapshot.phase === "neutral-face" ? [frame] : [];
  }
  recordGuidedTransition(snapshot);
  updateMilestones(snapshot);
  const confirmedTasks = [
    snapshot.confirmations.neutralFace,
    snapshot.confirmations.smile,
    snapshot.confirmations.eyeClosure
  ].filter((confirmation) => confirmation === "confirmed").length;
  faceRecoveryValue.textContent = `${confirmedTasks}/3`;
}

function applyEventToLanes(event: EventEnvelope): void {
  const actorNode = document.querySelector<HTMLElement>(
    `[data-lane="${event.actor.id}"]`
  );
  if (actorNode) {
    actorNode.dataset.eventId = event.eventId;
    actorNode.classList.remove("has-new-event");
    requestAnimationFrame(() => actorNode.classList.add("has-new-event"));
  }
  if (event.type === "capture.window.opened") {
    evidencePacket.dataset.eventId = event.eventId;
    evidencePacket.dataset.modality = String(event.payload.modality ?? "");
    evidencePacket.textContent = `${
      event.payload.modality === "face" ? "Facial" : "Speech"
    } window accepted`;
    evidencePacket.hidden = true;
    actorNode?.classList.add("has-new-evidence");
    window.clearTimeout(packetTimer ?? undefined);
    requestAnimationFrame(() => {
      evidencePacket.hidden = false;
      packetTimer = window.setTimeout(() => {
        evidencePacket.hidden = true;
        actorNode?.classList.remove("has-new-evidence");
      }, 1_100);
    });
    eventCount.textContent = "Agents active";
  }
  if (
    event.type === "capture.window.opened" &&
    event.payload.modality === "face"
  ) {
    faceWindowOpen = true;
  }
  if (
    event.type === "capture.window.closed" &&
    event.payload.modality === "face"
  ) {
    faceWindowOpen = false;
  }
  if (event.type === "capture.quality.changed") {
    const quality = event.payload.quality;
    if (event.actor.id === "speech-acoustic") {
      setLane(
        speechState,
        speechStatus,
        quality === "measurable" ? "Active" : "Listening",
        quality === "measurable"
          ? "Speech window active."
          : "Monitoring for the next speech window.",
        quality === "measurable" ? "active" : "quiet"
      );
    }
    if (event.actor.id === "facial-expressivity") {
      const nextFaceQuality =
        quality === "measurable" ? "measurable" : "withheld";
      const snapshot = guidedDemo.snapshot();
      if (nextFaceQuality === "withheld") {
        document
          .querySelector<HTMLElement>(".agent-graph")
          ?.setAttribute("data-face-path", "paused");
        setCoordinatorDecision(
          "Facial Analysis paused · Speech continues",
          event.eventId
        );
        showCameraCallout(
          "Facial Analysis paused · Speech continues",
          "amber",
          event.eventId
        );
        eventCount.textContent = "Facial path paused";
      } else if (
        lastFaceQuality === "withheld" &&
        ["neutral-face", "smile", "eye-closure"].includes(snapshot.phase)
      ) {
        document
          .querySelector<HTMLElement>(".agent-graph")
          ?.setAttribute("data-face-path", "connected");
        setCoordinatorDecision(
          "Facial Analysis reconnected",
          event.eventId
        );
        showCameraCallout(
          "Facial Analysis reconnected",
          "teal",
          event.eventId,
          1_300
        );
        eventCount.textContent = "Signal restored";
      }
      lastFaceQuality = nextFaceQuality;
      setLane(
        faceLaneState,
        faceStatus,
        quality === "measurable" ? "Connected" : "Paused",
        quality === "measurable"
          ? "Facial window active."
          : "Paused while Speech Analysis continues.",
        quality === "measurable" ? "active" : "warning"
      );
    }
  }
  if (event.type === "evidence-card.requested") {
    eventCount.textContent = "Grounding evidence";
    setHandoffStep(
      groundingHandoff,
      "active",
      "Working",
      event.eventId
    );
    setLane(
      evidenceState,
      evidenceStatus,
      "Preparing",
      "Assembling a grounded summary from measured signals.",
      "active"
    );
  }
  if (event.type === "evidence.grounding.completed") {
    eventCount.textContent = "Evidence grounded";
    setHandoffStep(
      groundingHandoff,
      "complete",
      "Grounded",
      event.eventId
    );
  }
  if (event.type === "human-review.pending") {
    eventCount.textContent = "Review ready";
    setHandoffStep(
      reviewHandoff,
      "complete",
      "Ready",
      event.eventId
    );
    setLane(
      evidenceState,
      evidenceStatus,
      "Ready",
      "Every displayed statement passed grounding checks.",
      "complete"
    );
    setLane(
      reviewState,
      reviewStatus,
      "Pending",
      "The encounter summary is ready for review.",
      "active"
    );
  }
  if (
    event.type === "human-review.accepted" ||
    event.type === "human-review.rejected"
  ) {
    eventCount.textContent = "Complete";
    setHandoffStep(
      reviewHandoff,
      "complete",
      event.type === "human-review.accepted" ? "Approved" : "Dismissed",
      event.eventId
    );
  }
  if (
    event.type === "coordinator.decision.recorded" &&
    (event.payload.decision === "start-parallel-analysis" ||
      Array.isArray(event.payload.outcomes))
  ) {
    coordinatorDecision.dataset.eventId = event.eventId;
  }
}

function appendEvent(event: EventEnvelope): void {
  const sequence = allEvents.length + 1;
  const priorOccurredAt = allEvents.at(-1)?.occurredAt;
  const occurredAt = new Date(
    Math.max(
      priorOccurredAt ? Date.parse(priorOccurredAt) : 0,
      Date.parse(event.occurredAt)
    )
  ).toISOString();
  const normalized: EventEnvelope = {
    ...event,
    sequence,
    eventId: `${sequence}-${event.type}`,
    occurredAt
  };
  allEvents.push(normalized);
  renderOperatorDiagnostics(normalized, true);
  applyEventToLanes(normalized);
  eventList.querySelector(".event-placeholder")?.remove();

  const visibleTypes = new Set<AmbientEventType>([
    "capture.window.opened",
    "capture.quality.changed",
    "coordinator.decision.recorded",
    "modality.outcome.created",
    "evidence.grounding.completed",
    "human-review.pending",
    "human-review.accepted",
    "human-review.rejected",
    "baseline.established"
  ]);
  if (!visibleTypes.has(normalized.type)) {
    return;
  }
  if (
    normalized.type === "modality.outcome.created" &&
    normalized.payload.status !== "measured"
  ) {
    return;
  }
  if (
    normalized.type === "coordinator.decision.recorded" &&
    normalized.payload.decision === "advance"
  ) {
    return;
  }

  const item = document.createElement("li");
  item.className = "event-item";
  const marker = document.createElement("span");
  marker.className = "event-marker";
  marker.setAttribute("aria-hidden", "true");
  const copy = document.createElement("div");
  const meta = document.createElement("span");
  meta.className = "event-meta";
  meta.textContent = normalized.actor.lane
    .replace("capture-conductor", "Encounter Coordinator")
    .replace("speech-acoustic", "Speech Analysis")
    .replace("facial-expressivity", "Facial Analysis")
    .replace("evidence-card", "Clinical Synthesis")
    .replace("clinician-review", "Clinician Review")
    .replace("capture-web", "Assessment");
  const summary = document.createElement("p");
  summary.textContent =
    normalized.type === "capture.window.opened"
      ? `${
          normalized.payload.modality === "face" ? "Facial" : "Speech"
        } window accepted.`
      : normalized.type === "evidence.grounding.completed"
        ? "Evidence matched to source measurements."
        : normalized.type === "human-review.pending"
          ? "Summary ready for clinician review."
          : normalized.type === "baseline.established"
            ? "Visit 1 established."
      : normalized.type === "capture.quality.changed" &&
          normalized.payload.quality !== "measurable"
        ? normalized.actor.id === "facial-expressivity"
          ? "Facial Analysis paused while Speech Analysis continued."
          : "Speech Analysis continued monitoring."
        : normalized.type === "coordinator.decision.recorded" &&
            Array.isArray(normalized.payload.outcomes)
          ? "Measurements routed to Clinical Synthesis."
        : normalized.summary;
  copy.append(meta, summary);
  item.append(marker, copy);
  eventList.prepend(item);
  while (eventList.children.length > 3) {
    eventList.lastElementChild?.remove();
  }
}

function renderOperatorDiagnostics(
  latestEvent: EventEnvelope | undefined = allEvents.at(-1),
  force = false
): void {
  if (!operatorMode) return;
  const now = performance.now();
  if (!force && now - lastOperatorDiagnosticsRenderAtMs < 250) return;
  lastOperatorDiagnosticsRenderAtMs = now;
  operatorOutput.textContent = JSON.stringify(
    {
      policy: JUDGE_READY_COMPLETION_POLICY,
      calibration,
      visualPipeline,
      videoCaptureSettings,
      visualFrameStream: visualScheduler?.diagnostics(now),
      latestVisualResult: latestVisualRuntimeDiagnostics,
      latestEvent: latestEvent ?? null,
      eventCount: allEvents.length
    },
    null,
    2
  );
}

function workflowFactory() {
  if (!captureVisitId) {
    throw new Error("An active encounter is required.");
  }
  return createEventFactory({
    visitId: captureVisitId,
    participantId: captureParticipantId,
    baseTimeMs: sessionStartedAtEpoch,
    initialSequence: allEvents.length
  });
}

function emitWorkflowEvent(
  actorId: AmbientActorId,
  type: AmbientEventType,
  stage: WorkflowStage,
  summary: string,
  payload: Record<string, unknown> = {},
  evidenceRefs: string[] = [],
  causedByEventId?: string
): EventEnvelope {
  const event = workflowFactory().next(
    actorId,
    type,
    stage,
    summary,
    Math.round(performance.now() - sessionStartedAtPerformance),
    payload,
    evidenceRefs,
    causedByEventId
  );
  appendEvent(event);
  return allEvents.at(-1)!;
}

function updateLiveAudio(feature: DerivedAudioFeature): void {
  const meterPercent = Math.min(100, Math.round(feature.rms * 900));
  micMeterFill.style.width = `${meterPercent}%`;
  micMeter.setAttribute("aria-valuenow", meterPercent.toString());
  voiceState.textContent = feature.clipped
    ? "Too loud"
    : feature.voiced
      ? "Active"
      : "Listening";
  voiceState.dataset.status = feature.clipped
    ? "warning"
    : feature.voiced
      ? "active"
      : "quiet";
  const activeFrames =
    state === "capturing"
      ? audioFrames.filter((frame) => frame.voiced).length
      : preflightSpeechEnergyFrames;
  const pitchedFrames =
    state === "capturing"
      ? audioFrames.filter((frame) => frame.pitchHz !== null).length
      : preflightPitchedFrames;
  speechDurationValue.textContent = `${(activeFrames / 10).toFixed(1)} s`;
  pitchCoverageValue.textContent = `${
    activeFrames === 0
      ? 0
      : Math.round((pitchedFrames / activeFrames) * 100)
  }%`;
}

function updateLiveFace(
  frame: FacialKinematicsFrameV1,
  usable: boolean,
  guidance: string
): void {
  receivedFaceFrameCount += 1;
  if (state === "capturing" && usable) usableFaceFrameCount += 1;
  faceQualityFill.style.width = `${usable ? 100 : frame.faceVisible ? 35 : 0}%`;
  const sourceFrames =
    state === "capturing"
      ? receivedFaceFrameCount
      : Math.max(1, preflightFaceFrames.length);
  const usableFrames =
    state === "capturing"
      ? usableFaceFrameCount
      : preflightFaceFrames.filter(
          (candidate) =>
            preflightFaceGuidance(candidate) === "Face ready"
        ).length;
  faceUsabilityValue.textContent = `${Math.round(
    (usableFrames / Math.max(1, sourceFrames)) * 100
  )}%`;
  faceState.textContent = usable ? "Measurable" : "Paused";
  faceState.dataset.status = usable ? "active" : "warning";
  if (state.startsWith("calibrating")) {
    guidanceTitle.textContent = guidance;
  }
}

function drawFaceOverlay(
  box: FacialKinematicsFrameV1["boundingBox"],
  measurable: boolean
): void {
  const width = cameraPreview.videoWidth || 1280;
  const height = cameraPreview.videoHeight || 720;
  if (faceOverlay.width !== width || faceOverlay.height !== height) {
    faceOverlay.width = width;
    faceOverlay.height = height;
  }
  const context = faceOverlay.getContext("2d");
  if (!context) return;
  context.clearRect(0, 0, width, height);
  if (!box) return;
  context.save();
  context.strokeStyle = measurable ? "#63d7c5" : "#f0aa62";
  context.lineWidth = 4;
  context.shadowColor = measurable
    ? "rgba(77, 182, 165, 0.72)"
    : "rgba(211, 145, 77, 0.72)";
  context.shadowBlur = 9;
  context.setLineDash(measurable ? [] : [12, 8]);
  context.strokeRect(
    box.x * width,
    box.y * height,
    box.width * width,
    box.height * height
  );
  context.restore();
}

function completeSystemCheck(generation: number): void {
  if (
    generation !== lifecycleGeneration ||
    !consentCheckbox.checked ||
    !["calibrating-quiet", "calibrating-voice"].includes(state)
  ) {
    return;
  }
  if (calibration) return;
  if (quietRmsSamples.length === 0) {
    quietRmsSamples = [0.002, 0.002, 0.002];
  }
  voiceTracker.calibrate(quietRmsSamples);
  const audioQuality: CalibrationQuality = classifyAudioCalibration(
    preflightPitchedFrames,
    preflightSpeechEnergyFrames
  );
  const faceResult = faceWorkerReady
    ? classifyFaceCalibration(preflightFaceFrames)
    : {
        quality: "unavailable" as const,
        calibration: null,
        usableFrameCount: 0
      };
  calibration = createCaptureCalibration(
    voiceTracker.getCalibration(),
    audioQuality,
    faceResult
  );
  window.clearInterval(sampleInterval ?? undefined);
  clearAllVisualOverlays();
  stopVisualFramePump();
  window.clearTimeout(systemCheckTimer ?? undefined);
  sampleInterval = null;
  systemCheckTimer = null;
  guidanceStep.textContent = "System check complete";
  guidanceTitle.textContent = "Ready to begin";
  guidanceDetail.textContent = "The ambient assessment is ready to begin.";
  guidanceProgressFill.style.width = "100%";
  voiceState.textContent = "Ready";
  voiceState.dataset.status = "quiet";
  faceState.textContent = "Ready";
  faceState.dataset.status = "quiet";
  speechSignalCaption.textContent = "Analysis prepared";
  faceSignalCaption.textContent = "Analysis prepared";
  setLane(
    conductorState,
    conductorStatus,
    "Ready",
    "Ready to begin.",
    "complete"
  );
  setLane(
    speechState,
    speechStatus,
    "Ready",
    "System check complete.",
    "complete"
  );
  setLane(
    faceLaneState,
    faceStatus,
    "Ready",
    "System check complete.",
    "complete"
  );
  updateState(
    "ready",
    "System check complete. Begin the ambient assessment when ready."
  );
}

function sampleAudioFrame(): void {
  if (
    !["calibrating-quiet", "calibrating-voice", "capturing"].includes(state) ||
    !analyser ||
    !sampleBuffer ||
    !audioContext
  ) {
    return;
  }
  analyser.getFloatTimeDomainData(sampleBuffer);
  const now = performance.now();
  if (state === "calibrating-quiet" || state === "calibrating-voice") {
    guidanceProgressFill.style.width = `${Math.min(
      100,
      Math.round(
        ((now - preflightStartedAt) /
          JUDGE_READY_COMPLETION_POLICY.systemCheckMaximumMs) *
          100
      )
    )}%`;
  }

  if (state === "calibrating-quiet") {
    const rms = calculateRms(sampleBuffer);
    quietRmsSamples.push(rms);
    micMeterFill.style.width = `${Math.min(100, Math.round(rms * 900))}%`;
    if (
      now - preflightStartedAt >=
        JUDGE_READY_COMPLETION_POLICY.quietCalibrationMs &&
      quietRmsSamples.length >= 8
    ) {
      voiceTracker.calibrate(quietRmsSamples);
      voiceCalibrationStartedAt = now;
      state = "calibrating-voice";
      document.body.dataset.captureState = state;
      guidanceStep.textContent = "System check · speech";
      guidanceTitle.textContent = "Speak for a few seconds";
      guidanceDetail.textContent =
        "Use your natural voice while speech quality is verified.";
      setLane(
        speechState,
        speechStatus,
        "Calibrating",
        "Verifying speech energy and pitch coverage.",
        "active"
      );
    }
    return;
  }

  const derived = voiceTracker.derive(sampleBuffer, audioContext.sampleRate);
  latestAudioFeature = derived;
  updateLiveAudio(derived);

  if (state === "calibrating-voice") {
    if (derived.rms >= voiceTracker.getCalibration().entryThresholdRms) {
      preflightSpeechEnergyFrames += 1;
    }
    if (derived.voiced && derived.pitchConfidence >= 0.55) {
      preflightPitchedFrames += 1;
    }
    guidanceDetail.textContent =
      "Continue speaking naturally while Speech Analysis prepares.";
    return;
  }

  if (!conductorSession) return;
  const frame: AudioFeatureFrame = {
    tMs: Math.round(now - sessionStartedAtPerformance),
    ...derived
  };
  latestAudioFeatureAtMs = frame.tMs;
  audioFrames.push(frame);
  conductorSession.ingestAudio(frame);
}

function relativeVisualTimestamp(acquiredAtMs: number): number {
  const origin =
    state === "capturing"
      ? sessionStartedAtPerformance
      : preflightStartedAt;
  return Math.max(0, Math.round(acquiredAtMs - origin));
}

function currentVisualTask(): VisualTaskContext {
  if (state !== "capturing") return "establishing";
  const phase = guidedDemo.snapshot().phase;
  return phase === "complete" ? "eye-closure" : phase;
}

function stopVisualFramePump(): void {
  visualFramePump?.stop();
  visualFramePump = null;
  visualScheduler?.stop();
  visualScheduler = null;
}

function visualAcquisitionStateActive(): boolean {
  return [
    "calibrating-quiet",
    "calibrating-voice",
    "capturing"
  ].includes(state);
}

function cameraTrackAvailable(): boolean {
  return (
    mediaStream?.getVideoTracks().some(
      (track) =>
        track.readyState === "live" &&
        !track.muted
    ) ?? false
  );
}

function handleCameraUnavailable(): void {
  visualLaneGuard.markCameraAvailable(false);
  pauseVisualAcquisition("camera-unavailable");
}

function handleCameraAvailable(): void {
  visualLaneGuard.markCameraAvailable(true);
  resumeVisualAcquisition();
}

function pauseVisualAcquisition(
  reasonCode: VisualQualityReasonCode
): void {
  clearAllVisualOverlays();
  if (state === "capturing") noteVisualWithholding(reasonCode);
  stopVisualFramePump();
}

function resumeVisualAcquisition(): void {
  if (
    !visualAcquisitionStateActive() ||
    visualFramePump !== null ||
    document.hidden ||
    !cameraTrackAvailable() ||
    !faceWorkerReady
  ) {
    return;
  }
  // A fresh epoch makes the external withholding boundary explicit in every
  // downstream window, even when the interruption was shorter than 200 ms.
  beginVisualCaptureEpoch(false);
}

function configureVisualFramePump(): void {
  stopVisualFramePump();
  visualScheduler = new LatestFrameScheduler<ImageBitmap>({
    captureEpoch: visualCaptureEpoch,
    onSubmit: (scheduled) => {
      const tMs = relativeVisualTimestamp(
        scheduled.acquisitionTimestampMs
      );
      const message = visualWorkerMessage<VisualWorkerFrameMessage>({
        type: "frame",
        captureEpoch: scheduled.captureEpoch,
        sequence: scheduled.sequence,
        tMs,
        acquiredAtMs: scheduled.acquisitionTimestampMs,
        taskContext:
          scheduled.taskContext ?? currentVisualTask(),
        width: scheduled.width,
        height: scheduled.height,
        bitmap: scheduled.frame,
        stream: scheduled.stream,
        calibration: calibration?.face ?? null
      });
      faceWorker.postMessage(message, [scheduled.frame]);
    }
  });
  visualFramePump = new VideoFramePump<ImageBitmap>({
    source: cameraPreview,
    scheduler: visualScheduler,
    capture: async () => createImageBitmap(cameraPreview),
    taskContextAtAcquisition: currentVisualTask
  });
}

function initializeVisualWorkerForCurrentEpoch(): void {
  faceWorker.postMessage(
    visualWorkerMessage({
      type: "initialize",
      captureEpoch: visualCaptureEpoch,
      videoCaptureSettings
    })
  );
}

function beginVisualCaptureEpoch(
  initializeWorker: boolean
): void {
  clearAllVisualOverlays();
  visualCaptureEpoch += 1;
  visualResultAcceptanceGuard.reset();
  externalVisualWithholdingActive = false;
  configureVisualFramePump();
  visualLaneGuard.reset();
  visualLaneGuard.markPageVisible(!document.hidden);
  visualLaneGuard.markCameraAvailable(cameraTrackAvailable());
  visualLaneGuard.markWorkerAvailable(faceWorkerReady);
  visualLaneGuard.markProcessed(performance.now());
  if (initializeWorker) {
    faceWorkerReady = false;
    visualLaneGuard.markWorkerAvailable(false);
    initializeVisualWorkerForCurrentEpoch();
    return;
  }
  faceWorker.postMessage(
    visualWorkerMessage({
      type: "reset",
      captureEpoch: visualCaptureEpoch
    })
  );
  if (faceWorkerReady) visualFramePump?.start();
}

function noteVisualWithholding(
  reasonCode: VisualQualityReasonCode,
  atMs = Math.max(
    0,
    Math.round(performance.now() - sessionStartedAtPerformance)
  )
): void {
  latestFaceUsable = false;
  if (!externalVisualWithholdingActive) {
    visualResultAcceptanceGuard.invalidateThrough(performance.now());
    externalVisualWithholdingActive = true;
  }
  clearAllVisualOverlays();
  guidedPhaseFaceFrames = [];
  if (state === "capturing") {
    updateMilestones(
      guidedDemo.resetCurrentGate(
        atMs,
        visualPipeline?.processorRef
      )
    );
  }
  conductorSession?.ingestVisualWithholding({
    tMs: atMs,
    reasonCode,
    taskContext: currentVisualTask(),
    processorRef: visualPipeline?.processorRef
  });
}

function restartVisualWorker(): void {
  stopVisualFramePump();
  clearAllVisualOverlays();
  faceWorker.terminate();
  visualCaptureEpoch += 1;
  visualResultAcceptanceGuard.reset();
  externalVisualWithholdingActive = false;
  replaceLandmarkOverlayCanvas();
  faceWorker = createFaceWorker();
  bindFaceWorker(faceWorker);
  attachLandmarkOverlay(faceWorker);
  faceWorkerReady = false;
  visualLaneGuard.markWorkerAvailable(false);
  configureVisualFramePump();
  initializeVisualWorkerForCurrentEpoch();
}

function handleVisualWorkerFailure(): void {
  clearAllVisualOverlays();
  visualLaneGuard.markWorkerAvailable(false);
  noteVisualWithholding("worker-unavailable");
  if (
    state === "capturing" &&
    visualWorkerRestartBudget.requestRestart() === "restart"
  ) {
    restartVisualWorker();
    return;
  }
  stopVisualFramePump();
  setLane(
    faceLaneState,
    faceStatus,
    "Paused",
    "Facial Analysis is unavailable; Speech Analysis continues.",
    "warning"
  );
}

function processCapturedFace(
  rawFrame: FacialKinematicsFrameV1
): void {
  if (!calibration || !conductorSession) return;
  const calibrated = calibration.face
    ? calibrateFaceFrame(rawFrame, calibration.face)
    : {
        frame: {
          ...rawFrame,
          qualityReasons: evaluateVisualQuality(rawFrame).reasonCodes
        },
        usable: evaluateVisualQuality(rawFrame).usable,
        guidance: preflightFaceGuidance(rawFrame)
      };
  latestFaceUsable = calibrated.usable;
  conductorSession.ingestFace(calibrated.frame);
  observeGuidedFaceFrame(calibrated.frame, calibrated.usable);
  updateLiveFace(
    calibrated.frame,
    calibrated.usable,
    calibrated.guidance
  );
  if (
    calibrated.usable &&
    overlayRenderThrottle.shouldRender(rawFrame.acquiredAtMs)
  ) {
    drawFaceOverlay(rawFrame.boundingBox, calibrated.usable);
  }
  if (calibrated.usable) {
    showLandmarkOverlay();
  } else {
    clearAllVisualOverlays();
  }
}

function updateClock(): void {
  if (state !== "capturing") return;
  const now = performance.now();
  const elapsed = now - sessionStartedAtPerformance;
  sessionClock.textContent = formatElapsed(elapsed);
  advanceGuidedEncounter(elapsed);
  const laneHealth = visualLaneGuard.evaluate(now);
  for (const reason of laneHealth.reasons) {
    const reasonCode: VisualQualityReasonCode =
      reason === "page-hidden"
        ? "document-hidden"
        : reason === "camera-unavailable"
          ? "camera-unavailable"
          : reason === "worker-unavailable"
            ? "worker-unavailable"
            : "visual-frame-gap";
    noteVisualWithholding(reasonCode, Math.round(elapsed));
  }
}

function systemCheckRequestIsCurrent(generation: number): boolean {
  return (
    generation === lifecycleGeneration &&
    consentCheckbox.checked &&
    state === "requesting"
  );
}

function stopStream(stream: MediaStream): void {
  stream.getTracks().forEach((track) => track.stop());
}

async function initializeMedia(generation: number): Promise<boolean> {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: {
      facingMode: "user",
      width: { ideal: REQUESTED_VIDEO_CAPTURE.width },
      height: { ideal: REQUESTED_VIDEO_CAPTURE.height },
      frameRate: { ideal: REQUESTED_VIDEO_CAPTURE.frameRate }
    },
    audio: {
      echoCancellation: true,
      noiseSuppression: false,
      autoGainControl: false
    }
  });
  // Own the acquired tracks before awaiting playback or audio startup so a
  // consent withdrawal can stop them synchronously at either boundary.
  pendingMediaStreams.add(stream);
  let context: AudioContext | null = null;
  try {
    if (!systemCheckRequestIsCurrent(generation)) {
      pendingMediaStreams.delete(stream);
      stopStream(stream);
      return false;
    }

    cameraPreview.srcObject = stream;
    await cameraPreview.play();
    if (!systemCheckRequestIsCurrent(generation)) {
      cameraPreview.srcObject = null;
      pendingMediaStreams.delete(stream);
      stopStream(stream);
      return false;
    }

    context = new AudioContext({ latencyHint: "interactive" });
    await context.resume();
    if (!systemCheckRequestIsCurrent(generation)) {
      cameraPreview.srcObject = null;
      pendingMediaStreams.delete(stream);
      stopStream(stream);
      await context.close();
      return false;
    }

    const videoTrack = stream.getVideoTracks()[0];
    const settings = videoTrack?.getSettings();
    const source = context.createMediaStreamSource(stream);
    const nextAnalyser = context.createAnalyser();
    nextAnalyser.fftSize = 4096;
    nextAnalyser.smoothingTimeConstant = 0;
    source.connect(nextAnalyser);

    pendingMediaStreams.delete(stream);
    mediaStream = stream;
    audioContext = context;
    audioSource = source;
    analyser = nextAnalyser;
    sampleBuffer = new Float32Array(nextAnalyser.fftSize);
    videoCaptureSettings = {
      requested: { ...REQUESTED_VIDEO_CAPTURE },
      actual: {
        width:
          settings?.width ??
          cameraPreview.videoWidth ??
          REQUESTED_VIDEO_CAPTURE.width,
        height:
          settings?.height ??
          cameraPreview.videoHeight ??
          REQUESTED_VIDEO_CAPTURE.height,
        frameRate: settings?.frameRate ?? null
      },
      ...(settings?.facingMode
        ? { facingMode: settings.facingMode }
        : {}),
      coordinateSpace: "normalized-unmirrored-image",
      displayMirrored: true,
      lateralityConvention: "subject-anatomical"
    };
    if (videoTrack) {
      videoTrack.addEventListener("mute", handleCameraUnavailable);
      videoTrack.addEventListener("ended", handleCameraUnavailable);
      videoTrack.addEventListener("unmute", handleCameraAvailable);
    }
    return true;
  } catch (error) {
    pendingMediaStreams.delete(stream);
    if (cameraPreview.srcObject === stream) {
      cameraPreview.srcObject = null;
    }
    stopStream(stream);
    if (context && context.state !== "closed") {
      await context.close();
    }
    throw error;
  }
}

async function runSystemCheck(): Promise<void> {
  if (state !== "idle" || !consentCheckbox.checked) {
    return;
  }
  lifecycleGeneration += 1;
  const generation = lifecycleGeneration;
  updateState("requesting", "Allow camera and microphone access to continue.");
  voiceState.textContent = "Preparing";
  faceState.textContent = "Preparing";
  speechSignalCaption.textContent = "Preparing speech analysis";
  faceSignalCaption.textContent = "Preparing facial analysis";
  try {
    if (testCaptureMode) {
      videoCaptureSettings = defaultVideoCaptureSettings();
      visualPipeline = visualPipelineProvenance("GPU");
      voiceTracker.calibrate([
        0.002,
        0.0022,
        0.0021,
        0.0024,
        0.0023
      ]);
      calibration = createCaptureCalibration(
        voiceTracker.getCalibration(),
        testScenario === "limited-calibration" ? "limited" : "strong",
        {
          quality:
            testScenario === "missing-face"
              ? "unavailable"
              : testScenario === "limited-calibration"
                ? "limited"
                : "strong",
          calibration:
            testScenario === "missing-face"
              ? null
              : {
                  durationMs: 1_600,
                  totalFrameCount: 49,
                  usableFrameCount:
                    testScenario === "limited-calibration" ? 30 : 45,
                  usableFraction:
                    testScenario === "limited-calibration" ? 0.61 : 0.92,
                  analyzedFrameRate: 30,
                  baselineBoxWidthPixels: 384,
                  baselineBoxHeightPixels: 360,
                  baselineIlluminationMean: 0.58,
                  baselineSharpness: 0.01
                },
          usableFrameCount:
            testScenario === "missing-face" ? 0 : 45
        }
      );
      cameraEmpty.hidden = true;
      guidanceCard.hidden = false;
      guidanceStep.textContent = "System check complete";
      guidanceTitle.textContent = "Ready to begin";
      guidanceDetail.textContent =
        "The ambient assessment is ready.";
      voiceState.textContent = "Ready";
      voiceState.dataset.status = "quiet";
      faceState.textContent = "Ready";
      faceState.dataset.status = "quiet";
      speechSignalCaption.textContent = "Analysis prepared";
      faceSignalCaption.textContent = "Analysis prepared";
      setLane(
        conductorState,
        conductorStatus,
        "Ready",
        "Ready to begin.",
        "complete"
      );
      setLane(
        speechState,
        speechStatus,
        "Ready",
        "System check complete.",
        "complete"
      );
      setLane(
        faceLaneState,
        faceStatus,
        "Ready",
        "System check complete.",
        "complete"
      );
      updateState(
        "ready",
        "System check complete. Begin the ambient assessment when ready."
      );
      return;
    }

    const initialized = await initializeMedia(generation);
    if (!initialized || !systemCheckRequestIsCurrent(generation)) return;
    preflightStartedAt = performance.now();
    quietRmsSamples = [];
    preflightFaceFrames = [];
    preflightPitchedFrames = 0;
    preflightSpeechEnergyFrames = 0;
    calibration = null;
    voiceTracker.reset();
    cameraEmpty.hidden = true;
    guidanceCard.hidden = false;
    guidanceStep.textContent = "System check · room";
    guidanceTitle.textContent = "Remain quiet";
    guidanceDetail.textContent =
      "Calibrating ambient room conditions for 1.5 seconds.";
    privacyStatus.textContent =
      "Camera and microphone active · in-session processing";
    setLane(
      conductorState,
      conductorStatus,
      "Checking",
      "Calibrating the encounter environment.",
      "active"
    );
    setLane(
      speechState,
      speechStatus,
      "Calibrating",
      "Measuring ambient room conditions.",
      "active"
    );
    setLane(
      faceLaneState,
      faceStatus,
      "Calibrating",
      "Center your face and look toward the camera.",
      "active"
    );
    state = "calibrating-quiet";
    document.body.dataset.captureState = state;
    headerMode.textContent = "System check";
    beginVisualCaptureEpoch(true);
    sampleInterval = window.setInterval(sampleAudioFrame, 100);
    systemCheckTimer = window.setTimeout(
      () => completeSystemCheck(generation),
      JUDGE_READY_COMPLETION_POLICY.systemCheckMaximumMs
    );
  } catch {
    if (generation !== lifecycleGeneration) return;
    await releaseMedia();
    setLane(
      conductorState,
      conductorStatus,
      "Device access",
      "Camera and microphone access needs attention.",
      "warning"
    );
    updateState(
      "error",
      "Camera or microphone access is required for the system check."
    );
  }
}

function prepareConductor(): void {
  if (!calibration) throw new Error("System check is required.");
  lifecycleGeneration += 1;
  captureFinalizationScheduled = false;
  resultsVisible = false;
  audioFrames = [];
  receivedFaceFrameCount = 0;
  usableFaceFrameCount = 0;
  latestAudioFeature = null;
  latestAudioFeatureAtMs = Number.NEGATIVE_INFINITY;
  latestFaceUsable = false;
  guidedPhaseFaceFrames = [];
  neutralFacialBaseline = null;
  latestVisualRuntimeDiagnostics = null;
  lastOperatorDiagnosticsRenderAtMs = Number.NEGATIVE_INFINITY;
  testProcessorChangeInjected = false;
  testVisualCaptureSuspended = false;
  delete document.body.dataset.testProcessorChangeRewound;
  overlayRenderThrottle.reset();
  visualResultAcceptanceGuard.reset();
  externalVisualWithholdingActive = false;
  voiceTracker.reset();
  visualWorkerRestartBudget.reset();
  guidedDemo.reset(0);
  sessionStartedAtPerformance = performance.now();
  sessionStartedAtEpoch = Date.now();
  allEvents = [];
  clearEventList();
  latestObservation = null;
  latestOutcomes = null;
  latestEvidence = null;
  evidenceReviewReady = false;
  lastGuidedTransitionId = 0;
  lastAssistancePhase = null;
  lastFaceQuality = "unknown";
  faceWindowOpen = false;
  baselinePanel.hidden = true;
  captureVisitId = `visit-${crypto.randomUUID()}`;
  conductorSession = createConductorSession(
    {
      schemaVersion: "phenometric.frame-stream.v1",
      containsPHI: false,
      visitId: captureVisitId,
      participantId: captureParticipantId,
      captureMode: "live",
      occurredAt: new Date(sessionStartedAtEpoch).toISOString(),
      captureAdapter: { id: "macbook-browser", version: "0.4.0" },
      calibration,
      visualPipeline,
      videoCaptureSettings
    },
    {
      baseTimeMs: sessionStartedAtEpoch,
      onEvent: appendEvent
    }
  );
}

function startTestCapture(): void {
  let fixtureTimeMs = 0;
  let fixtureSequence = 0;
  const frameStepMs = 34;
  const intervalMs = observeTestTransitions
    ? 10
    : fastTestCapture
      ? 3
      : 10;
  visualCaptureEpoch += 1;
  sampleInterval = window.setInterval(() => {
    if (
      state !== "capturing" ||
      !conductorSession ||
      document.hidden ||
      testVisualCaptureSuspended
    ) {
      return;
    }
    const snapshot = guidedDemo.snapshot(fixtureTimeMs);
    if (snapshot.phase === "complete") {
      window.clearInterval(sampleInterval ?? undefined);
      sampleInterval = null;
      return;
    }
    const taskContext = snapshot.phase;
    const phaseElapsedMs = Math.max(
      0,
      fixtureTimeMs - snapshot.phaseStartedAt
    );
    const speechAvailable =
      testScenario !== "missing-speech" &&
      (taskContext === "establishing" ||
        taskContext === "turn-away");
    const audio: AudioFeatureFrame & DerivedAudioFeature = {
      tMs: fixtureTimeMs,
      voiced: speechAvailable,
      rms: speechAvailable ? 0.07 : 0.002,
      pitchHz:
        speechAvailable
          ? fixtureTimeMs % 400 < 200
            ? 122
            : 158
          : null,
      pitchConfidence: speechAvailable ? 0.92 : 0,
      clipped: false,
      snrDb: speechAvailable ? 24 : 0
    };
    latestAudioFeature = audio;
    latestAudioFeatureAtMs = fixtureTimeMs;
    audioFrames.push(audio);
    conductorSession.ingestAudio(audio);
    updateLiveAudio(audio);

    const intentionalTurnAway =
      taskContext === "turn-away" &&
      testScenario !== "unfinished-task" &&
      testScenario !== "technical-turn-away" &&
      (testScenario !== "missed-turn" || phaseElapsedMs >= 14_000);
    const technicalTurnAway =
      taskContext === "turn-away" &&
      testScenario === "technical-turn-away";
    const unavailableFace = testScenario === "missing-face";
    const faceWithheld =
      intentionalTurnAway || unavailableFace;
    const smiling =
      taskContext === "smile" &&
      testScenario !== "unfinished-smile";
    const closingEyes =
      taskContext === "eye-closure" &&
      phaseElapsedMs < 500;
    fixtureSequence += 1;
    const face: FacialKinematicsFrameV1 = {
      schemaVersion: "phenometric.facial-kinematics-frame.v1",
      tMs: fixtureTimeMs,
      acquiredAtMs: fixtureTimeMs,
      sequence: fixtureSequence,
      captureEpoch: visualCaptureEpoch,
      taskContext,
      faceVisible: !faceWithheld,
      boundingBox: faceWithheld
        ? null
        : {
            x: 0.35,
            y: 0.2,
            width: 0.3,
            height: 0.5,
            widthPixels: 384,
            heightPixels: 360,
            edgeMarginFraction: 0.2
          },
      anatomicalLaterality: "subject-anatomical",
      pose: faceWithheld
        ? null
        : {
            yawDegrees: 0,
            pitchDegrees: 0,
            rollDegrees: 0
          },
      eyeAperture: faceWithheld
        ? null
        : {
            left: closingEyes ? 0.06 : 0.3,
            right: closingEyes ? 0.09 : 0.3
          },
      mouthCorners: faceWithheld
        ? null
        : {
            left: smiling
              ? { x: 0.53, y: 0.17 }
              : { x: 0.5, y: 0.2 },
            right: smiling
              ? { x: -0.54, y: 0.16 }
              : { x: -0.5, y: 0.2 }
          },
      mouthApertureRatio: 0.12,
      regionalMovementSpeed: faceWithheld ? null : 0.04,
      imageQuality: {
        illuminationMean: 0.58,
        darkClippingFraction: 0.01,
        brightClippingFraction: 0.01,
        sharpness: technicalTurnAway ? 0.0001 : 0.01
      },
      analyzedFrameRate: 1_000 / frameStepMs,
      interResultGapMs:
        fixtureSequence === 1 ? null : frameStepMs,
      skippedFrameFraction: 0,
      processingLatencyMs: 8,
      qualityReasons: faceWithheld
        ? ["face-not-visible"]
        : [],
      processorRef:
        visualPipeline?.processorRef ??
        visualPipelineProvenance("GPU").processorRef
    };
    processCapturedFace(face);
    if (
      testScenario === "processor-change-after-completion" &&
      !testProcessorChangeInjected &&
      guidedDemo.snapshot(fixtureTimeMs).phase === "complete"
    ) {
      testProcessorChangeInjected = true;
      applyVisualPipelineProvenance(
        visualPipelineProvenance("CPU"),
        fixtureTimeMs
      );
      document.body.dataset.testProcessorChangeRewound =
        guidedDemo.snapshot(fixtureTimeMs).phase === "neutral-face"
          ? "true"
          : "false";
    }
    sessionClock.textContent = formatElapsed(fixtureTimeMs);
    advanceGuidedEncounter(fixtureTimeMs);
    fixtureTimeMs += frameStepMs;
  }, intervalMs);
}

function startAssessment(): void {
  if (state !== "ready" || !calibration) return;
  prepareConductor();
  cameraEmpty.hidden = !testCaptureMode;
  if (testCaptureMode) {
    cameraEmpty.querySelector("strong")!.textContent =
      "Guided assessment active";
    cameraEmpty.querySelector("span:last-child")!.textContent =
      "Speech and facial agents are analyzing in parallel.";
  }
  liveStrip.hidden = false;
  guidanceCard.hidden = false;
  privacyStatus.textContent =
    "Audio and video are processed during the encounter and are not stored.";
  setLane(
    conductorState,
    conductorStatus,
    "Active",
    "Coordinating signal windows.",
    "active"
  );
  setLane(
    speechState,
    speechStatus,
    "Listening",
    "Waiting for usable speech.",
    "quiet"
  );
  setLane(
    faceLaneState,
    faceStatus,
    "Observing",
    "Checking calibrated framing.",
    "active"
  );
  updateState(
    "capturing",
    "Complete each guided exercise; progress advances only when its signal criterion is confirmed."
  );
  updateMilestones(guidedDemo.snapshot());
  emitWorkflowEvent(
    "capture-conductor",
    "demo.phase.started",
    "ambient-capture",
    "Started the establishing phase.",
    {
      phase: "establishing",
      policyId: JUDGE_READY_COMPLETION_POLICY.id,
      advancement: "signal-gated",
      skipAvailable: false
    }
  );
  const startDecision = emitWorkflowEvent(
    "capture-conductor",
    "coordinator.decision.recorded",
    "ambient-capture",
    "Speech and Facial Analysis started in parallel.",
    { decision: "start-parallel-analysis" }
  );
  setCoordinatorDecision(
    "Speech and Facial Analysis started in parallel",
    startDecision.eventId
  );
  eventCount.textContent = "Agents active";
  if (testCaptureMode) {
    startTestCapture();
  } else {
    beginVisualCaptureEpoch(false);
    clockInterval = window.setInterval(updateClock, 100);
    sampleInterval = window.setInterval(sampleAudioFrame, 100);
  }
}

async function releaseMedia(): Promise<void> {
  stopButton.hidden = true;
  stopButton.disabled = true;
  for (const interval of [sampleInterval, clockInterval]) {
    if (interval !== null) window.clearInterval(interval);
  }
  sampleInterval = null;
  clockInterval = null;
  stopVisualFramePump();
  window.clearTimeout(systemCheckTimer ?? undefined);
  window.clearTimeout(packetTimer ?? undefined);
  window.clearTimeout(cameraCalloutTimer ?? undefined);
  window.clearTimeout(traceCloseTimer ?? undefined);
  systemCheckTimer = null;
  packetTimer = null;
  cameraCalloutTimer = null;
  traceCloseTimer = null;
  evidencePacket.hidden = true;
  for (const pendingStream of pendingMediaStreams) {
    stopStream(pendingStream);
  }
  pendingMediaStreams.clear();
  mediaStream?.getTracks().forEach((track) => track.stop());
  mediaStream = null;
  cameraPreview.srcObject = null;
  audioSource?.disconnect();
  analyser?.disconnect();
  audioSource = null;
  analyser = null;
  sampleBuffer = null;
  const context = audioContext;
  audioContext = null;
  clearAllVisualOverlays();
  visualCaptureEpoch += 1;
  faceWorker.postMessage(
    visualWorkerMessage({
      type: "dispose",
      captureEpoch: visualCaptureEpoch
    })
  );
  faceWorker.terminate();
  faceWorkerReady = false;
  visualLaneGuard.reset();
  visualResultAcceptanceGuard.reset();
  externalVisualWithholdingActive = false;
  if (context && context.state !== "closed") await context.close();
}

function renderObservation(
  observation: EncounterObservation,
  reveal = true
): void {
  aggregateGrid.replaceChildren();
  reportMetricGrid.replaceChildren();
  const aggregates = [...observation.aggregates].sort(
    (left, right) =>
      biomarkerOrder(left.code) - biomarkerOrder(right.code)
  );
  const measuredCount = aggregates.length;
  const summary = document.createElement("span");
  summary.textContent = `${measuredCount} encounter ${
    measuredCount === 1 ? "biomarker" : "biomarkers"
  } captured`;
  resultSummary.replaceChildren(summary);

  for (const aggregate of aggregates) {
    const display = formatDisplayMetric(aggregate.value, aggregate.unit);
    const card = document.createElement("article");
    card.className = "aggregate-card";
    card.dataset.measurementCode = aggregate.code;
    const header = document.createElement("div");
    const label = document.createElement("strong");
    label.textContent = aggregate.label;
    const context = document.createElement("span");
    context.textContent = aggregate.code.startsWith("prototype.speech.")
      ? "speech"
      : "facial";
    header.append(label, context);
    const value = document.createElement("p");
    value.className = "aggregate-value";
    const number = document.createElement("span");
    number.textContent = display.value;
    const unit = document.createElement("small");
    unit.textContent = display.unit;
    value.append(number, unit);
    const footer = document.createElement("div");
    footer.className = "aggregate-footer";
    footer.textContent = metricCategory(aggregate.code);
    card.append(header, value, footer);
    aggregateGrid.append(card);

    const reportMetric = document.createElement("button");
    reportMetric.type = "button";
    reportMetric.className = "report-metric";
    reportMetric.dataset.measurementCode = aggregate.code;
    reportMetric.setAttribute(
      "aria-label",
      `Open evidence chain for ${aggregate.label}`
    );
    const reportMetricLabel = document.createElement("strong");
    reportMetricLabel.textContent = aggregate.label;
    const reportMetricValue = document.createElement("span");
    reportMetricValue.textContent = `${display.value} ${display.unit}`;
    const reportMetricContext = document.createElement("small");
    reportMetricContext.textContent = metricCategory(aggregate.code);
    reportMetric.append(
      reportMetricLabel,
      reportMetricValue,
      reportMetricContext
    );
    reportMetric.addEventListener("click", () =>
      openMeasurementTrace(aggregate.code)
    );
    reportMetricGrid.append(reportMetric);
  }
  if (measuredCount === 0) {
    const card = document.createElement("article");
    card.className = "aggregate-card aggregate-card-complete";
    const header = document.createElement("div");
    const label = document.createElement("strong");
    label.textContent = "Encounter capture complete";
    const context = document.createElement("span");
    context.textContent = "complete";
    header.append(label, context);
    const footer = document.createElement("div");
    footer.className = "aggregate-footer";
    footer.textContent =
      "The encounter report is ready for clinician review.";
    card.append(header, footer);
    aggregateGrid.append(card);
  }
  if (reveal) {
    resultsPanel.hidden = false;
    resultsVisible = true;
  }
}

function renderClaimButtons(claims: EvidenceCardClaim[]): void {
  evidenceClaims.replaceChildren();

  for (const claim of claims) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "evidence-claim";
    button.dataset.claimId = claim.claimId;
    const marker = document.createElement("span");
    marker.textContent = "Grounded measurement";
    const statement = document.createElement("strong");
    statement.textContent = humanizeMeasurementText(claim.statement);
    const trace = document.createElement("small");
    trace.textContent = "Open evidence chain";
    button.append(marker, statement, trace);
    button.addEventListener("click", () => openTrace(claim.claimId));
    evidenceClaims.append(button);
  }
}

function renderSynthesisSkeleton(): void {
  evidenceLoading.replaceChildren();
  const label = document.createElement("span");
  label.className = "skeleton-label";
  label.textContent = "Clinical Synthesis is preparing the clinician note";
  const title = document.createElement("span");
  title.className = "skeleton-line skeleton-title";
  const summary = document.createElement("span");
  summary.className = "skeleton-line skeleton-summary";
  const claims = document.createElement("div");
  claims.className = "skeleton-claims";
  for (let index = 0; index < 2; index += 1) {
    const claim = document.createElement("span");
    claim.className = "skeleton-claim";
    claims.append(claim);
  }
  evidenceLoading.append(label, title, summary, claims);
}

function renderPendingEvidence(): void {
  evidenceLoading.hidden = false;
  renderSynthesisSkeleton();
  evidenceError.hidden = true;
  retryEvidenceButton.hidden = true;
  evidenceCard.hidden = true;
  evidenceStatusChip.textContent = "Preparing summary";
  reviewOutcome.textContent = "";
  acceptButton.disabled = true;
  rejectButton.disabled = true;
  copyReportButton.disabled = true;
  approvalConfirmation.hidden = true;
}

function renderEvidence(result: EvidenceApiResult): void {
  evidenceLoading.hidden = true;
  evidenceError.hidden = true;
  retryEvidenceButton.hidden = true;
  evidenceCard.hidden = false;
  evidenceCard.classList.remove("is-entering");
  evidenceHeadline.textContent = result.draft.headline;
  evidenceHeadline.title = result.draft.headline;
  evidenceSummary.textContent = result.draft.summary;
  boundaryStatement.textContent = result.draft.boundaryStatement;
  evidenceStatusChip.textContent = `${
    latestObservation?.aggregates.length ?? 0
  } biomarkers · ${result.draft.claims.length} grounded claims`;
  reviewOutcome.textContent = "";
  acceptButton.disabled = false;
  rejectButton.disabled = false;
  copyReportButton.disabled = false;
  renderClaimButtons(result.draft.claims);
  requestAnimationFrame(() =>
    evidenceCard.classList.add("is-entering")
  );
}

async function copyClinicalReport(): Promise<void> {
  if (!latestEvidence) return;
  const biomarkerLines = [...(latestObservation?.aggregates ?? [])]
    .sort(
      (left, right) =>
        biomarkerOrder(left.code) - biomarkerOrder(right.code)
    )
    .map((aggregate) => {
      const display = formatDisplayMetric(aggregate.value, aggregate.unit);
      return `- ${aggregate.label}: ${display.value} ${display.unit}`;
    });
  const report = [
    latestEvidence.draft.headline,
    latestEvidence.draft.summary,
    "",
    "Quantitative encounter profile",
    ...biomarkerLines,
    "",
    "Grounded encounter statements",
    ...latestEvidence.draft.claims.map(
      (claim) => `- ${humanizeMeasurementText(claim.statement)}`
    ),
    "",
    latestEvidence.draft.boundaryStatement
  ].join("\n");
  try {
    await navigator.clipboard.writeText(report);
    reviewOutcome.textContent = "EHR-ready report copied.";
  } catch {
    reviewOutcome.textContent =
      "Copy could not be completed. Review the report on screen.";
  }
}

function revealTraceDrawer(): void {
  window.clearTimeout(traceCloseTimer ?? undefined);
  traceCloseTimer = null;
  document.body.classList.add("trace-open");
  traceBackdrop.hidden = false;
  traceDrawer.hidden = false;
  requestAnimationFrame(() => traceDrawer.classList.add("is-open"));
}

function openTrace(claimId: string): void {
  const outcome = latestOutcomes?.find(
    (candidate) => candidate.outcomeId === claimId
  );
  if (!outcome || !latestObservation) return;
  const aggregate =
    outcome.status === "measured"
      ? latestObservation.aggregates.find(
          (candidate) => candidate.code === outcome.measurementCode
        )
      : undefined;
  const measurements =
    outcome.status === "measured"
      ? latestObservation.measurements.filter(
          (measurement) =>
            measurement.code === outcome.measurementCode
        )
      : [];
  emitWorkflowEvent(
    "capture-web",
    "evidence.trace.opened",
    "evidence-card",
    `Opened the evidence chain for ${outcome.label}.`,
    { claimId },
    outcome.supportRefs
  );
  const supportingEvents = allEvents.filter(
    (event) =>
      outcome.eventIds.includes(event.eventId) ||
      event.payload.claimId === claimId
  );

  traceTitle.textContent = outcome.label;
  traceContent.replaceChildren();
  traceContent.className = "trace-chain";
  const quality = formatTraceQualityFacts(outcome.qualityFacts);
  const sourceStart =
    measurements.length > 0
      ? Math.min(
          ...measurements.map((measurement) => measurement.windowStartMs)
        )
      : 0;
  const sourceEnd =
    measurements.length > 0
      ? Math.max(
          ...measurements.map((measurement) => measurement.windowEndMs)
        )
      : Math.max(
          0,
          ...latestObservation.windows.map((window) => window.endMs)
        );
  const windowDescription = `${formatElapsed(sourceStart)}–${formatElapsed(
    sourceEnd
  )}`;
  const measurementDescription =
    outcome.status === "measured"
      ? `${formatValue(outcome.currentValue, outcome.unit)} ${
          displayUnit(outcome.unit)
        }\nSignal confidence ${
          aggregate ? `${Math.round(aggregate.confidence * 100)}%` : "—"
        }`
      : "";
  const agentActions = supportingEvents
    .filter((event) =>
      [
        "capture.quality.changed",
        "capture.window.opened",
        "coordinator.decision.recorded",
        "modality.outcome.created"
      ].includes(event.type)
    )
    .slice(-3)
    .map((event) => event.summary)
    .join("\n");
  const sections = [
    {
      title: "Agent action",
      value: agentActions
    },
    { title: "Source interval", value: windowDescription },
    {
      title: "Measurement",
      value: measurementDescription
    },
    { title: "Signal quality", value: quality },
    {
      title: "Grounded statement",
      value: humanizeMeasurementText(outcome.statement)
    }
  ];
  for (const section of sections) {
    const block = document.createElement("section");
    const title = document.createElement("strong");
    title.textContent = section.title;
    const value = document.createElement("pre");
    value.textContent = section.value || "No supporting item.";
    block.append(title, value);
    traceContent.append(block);
  }
  revealTraceDrawer();
}

function openMeasurementTrace(measurementCode: string): void {
  if (!latestObservation) return;
  const aggregate = latestObservation.aggregates.find(
    (candidate) => candidate.code === measurementCode
  );
  if (!aggregate) return;
  const measurements = latestObservation.measurements.filter(
    (measurement) => measurement.code === measurementCode
  );
  const measurementRefs = new Set(
    measurements.map((measurement) => measurement.contextRef)
  );
  const supportingEvents = allEvents.filter(
    (event) =>
      (event.type === "measurement.recorded" &&
        event.payload.code === measurementCode) ||
      (typeof event.payload.windowId === "string" &&
        measurementRefs.has(event.payload.windowId)) ||
      event.type === "encounter-observation.created"
  );
  emitWorkflowEvent(
    "capture-web",
    "evidence.trace.opened",
    "evidence-card",
    `Opened the evidence chain for ${aggregate.label}.`,
    { measurementCode },
    [...measurementRefs]
  );
  const sourceStart = Math.min(
    ...measurements.map((measurement) => measurement.windowStartMs)
  );
  const sourceEnd = Math.max(
    ...measurements.map((measurement) => measurement.windowEndMs)
  );
  const display = formatDisplayMetric(aggregate.value, aggregate.unit);
  const quality =
    aggregate.confounds.kind === "speech"
      ? `Signal confidence: ${Math.round(aggregate.confidence * 100)}%\nAccepted windows: ${aggregate.windowCount}\nSpeech signal-to-noise: ${aggregate.confounds.snrDb.toFixed(1)} dB`
      : `Signal confidence: ${Math.round(aggregate.confidence * 100)}%\nAccepted windows: ${aggregate.windowCount}\nAnalyzed cadence: ${aggregate.confounds.analyzedFrameRate.toFixed(1)} Hz\nFace size: ${Math.round(aggregate.confounds.faceBoxWidthPixels)} × ${Math.round(aggregate.confounds.faceBoxHeightPixels)} px\nIllumination: ${Math.round(aggregate.confounds.illuminationMean * 100)}%`;
  const sections = [
    {
      title: "Agent action",
      value: supportingEvents
        .filter(
          (event) =>
            event.type === "extractor.routed" ||
            (event.type === "measurement.recorded" &&
              event.payload.code === measurementCode)
        )
        .slice(-3)
        .map((event) =>
          event.type === "extractor.routed"
            ? `${
                aggregate.code.startsWith("prototype.speech.")
                  ? "Speech"
                  : "Facial"
              } Analysis accepted the source window.`
            : event.summary
        )
        .join("\n")
    },
    {
      title: "Source interval",
      value: `${formatElapsed(sourceStart)}–${formatElapsed(sourceEnd)}`
    },
    {
      title: "Measurement",
      value: `${display.value} ${display.unit}`
    },
    {
      title: "Signal quality",
      value: quality
    },
    {
      title: "Grounded statement",
      value: `${aggregate.label} was calculated from accepted ${metricCategory(
        aggregate.code
      ).toLowerCase()} evidence captured during this encounter.`
    }
  ];
  traceTitle.textContent = aggregate.label;
  traceContent.replaceChildren();
  traceContent.className = "trace-chain";
  for (const section of sections) {
    const block = document.createElement("section");
    const title = document.createElement("strong");
    title.textContent = section.title;
    const value = document.createElement("pre");
    value.textContent = section.value || "No supporting item.";
    block.append(title, value);
    traceContent.append(block);
  }
  revealTraceDrawer();
}

function closeTrace(): void {
  traceDrawer.classList.remove("is-open");
  document.body.classList.remove("trace-open");
  traceBackdrop.hidden = true;
  window.clearTimeout(traceCloseTimer ?? undefined);
  traceCloseTimer = window.setTimeout(() => {
    traceDrawer.hidden = true;
    traceCloseTimer = null;
  }, 220);
}

async function synthesizeEvidence(
  generation = lifecycleGeneration
): Promise<void> {
  if (generation !== lifecycleGeneration) return;
  if (!latestObservation || latestOutcomes?.length !== 2) {
    throw new Error(
      "One speech outcome and one facial outcome are required."
    );
  }
  evidenceLoading.hidden = false;
  renderSynthesisSkeleton();
  evidenceError.hidden = true;
  retryEvidenceButton.hidden = true;
  evidenceCard.hidden = true;
  const requested = emitWorkflowEvent(
    "evidence-card",
    "evidence-card.requested",
    "evidence-card",
    "Requested a structured current-encounter summary.",
    { outcomeIds: latestOutcomes.map((outcome) => outcome.outcomeId) },
    latestOutcomes.flatMap((outcome) => outcome.supportRefs)
  );
  evidenceLoading.dataset.eventId = requested.eventId;

  try {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 10_000);
    const response = await fetch("/api/evidence-card", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        containsPHI: false,
        rawMediaRetained: false,
        nativeVisualObservationsRetained: false,
        visitId: latestObservation.visitId,
        qualitySummary: latestObservation.qualitySummary,
        outcomes: latestOutcomes
      })
    });
    window.clearTimeout(timeout);
    if (generation !== lifecycleGeneration) return;
    const body = (await response.json()) as
      | EvidenceApiResult
      | { error: string };
    if (generation !== lifecycleGeneration) return;
    if (!response.ok || "error" in body) {
      throw new Error(
        "error" in body ? body.error : "Summary preparation failed."
      );
    }
    latestEvidence = body;
    console.info("[PhenoMetric operator] Clinical synthesis timing", body.timing);
    const drafted = emitWorkflowEvent(
      "evidence-card",
      "evidence-card.drafted",
      "evidence-card",
      "Received a structured encounter summary.",
      {
        responseId: body.responseId,
        promptVersion: body.promptVersion,
        attemptCount: body.attemptCount,
        timing: body.timing
      },
      latestOutcomes.flatMap((outcome) => outcome.supportRefs)
    );
    for (const claimId of body.grounding.groundedClaimIds) {
      const outcome = latestOutcomes.find(
        (candidate) => candidate.outcomeId === claimId
      );
      emitWorkflowEvent(
        "evidence-card",
        "evidence-claim.grounded",
        "evidence-card",
        `Grounded ${outcome?.label ?? "encounter evidence"} to its evidence chain.`,
        { claimId },
        outcome?.supportRefs ?? []
      );
    }
    emitWorkflowEvent(
      "evidence-card",
      "evidence.grounding.completed",
      "evidence-card",
      `Grounded ${body.grounding.groundedClaimIds.length} encounter ${
        body.grounding.groundedClaimIds.length === 1
          ? "metric"
          : "metrics"
      } for the clinical report.`,
      {
        groundedOutcomeIds: body.grounding.groundedClaimIds
      },
      body.grounding.groundedClaimIds,
      drafted.eventId
    );
    emitWorkflowEvent(
      "clinician-review",
      "human-review.pending",
      "human-review",
      "The encounter summary is ready for clinician review.",
      { cardResponseId: body.responseId },
      body.grounding.groundedClaimIds,
      drafted.eventId
    );
    evidenceCard.dataset.eventId = drafted.eventId;
    renderEvidence(body);
    evidenceReviewReady = true;
    milestone("summary")?.classList.add("is-complete");
    updateState(
      "review",
      "Review the two grounded statements, then approve or dismiss the summary."
    );
  } catch {
    if (generation !== lifecycleGeneration) return;
    emitWorkflowEvent(
      "evidence-card",
      "evidence-claim.rejected",
      "evidence-card",
      "Clinical synthesis could not produce a grounded summary.",
      { causedByEventId: requested.eventId }
    );
    const reportableOutcomes = latestOutcomes.filter(
      (outcome) => outcome.status === "measured"
    );
    const groundedIds = reportableOutcomes
      .map((outcome) => outcome.outcomeId);
    latestEvidence = {
      draft: {
        headline:
          reportableOutcomes.length > 0
            ? "Encounter metrics ready"
            : "Encounter acquisition complete",
        summary:
          reportableOutcomes.length > 0
            ? "Measured encounter metrics are formatted for clinician review while the narrative refreshes."
            : "The encounter report is ready for clinician review.",
        claims: reportableOutcomes.map((outcome) => ({
            claimId: outcome.outcomeId,
            modality: outcome.modality,
            status: outcome.status,
            statement: outcome.statement
          })),
        boundaryStatement: EVIDENCE_BOUNDARY
      },
      grounding: {
        status: "pass",
        errors: [],
        groundedClaimIds: groundedIds
      },
      model: "unavailable",
      promptVersion: "evidence-only",
      responseId: `evidence-only-${latestObservation.visitId}`,
      attemptCount: 0,
      timing: { totalMs: 0, modelMs: 0, validationMs: 0 }
    };
    const grounded = emitWorkflowEvent(
      "evidence-card",
      "evidence.grounding.completed",
      "evidence-card",
      `Grounded ${groundedIds.length} reportable encounter ${
        groundedIds.length === 1 ? "metric" : "metrics"
      }; the narrative can be refreshed.`,
      { groundedOutcomeIds: groundedIds, narrativeAvailable: false },
      groundedIds,
      requested.eventId
    );
    emitWorkflowEvent(
      "clinician-review",
      "human-review.pending",
      "human-review",
      "Encounter evidence is ready for clinician review.",
      { evidenceOnly: true },
      groundedIds,
      grounded.eventId
    );
    renderEvidence(latestEvidence);
    evidenceStatusChip.textContent = `${groundedIds.length} ${
      groundedIds.length === 1 ? "metric" : "metrics"
    } grounded · narrative pending`;
    evidenceError.hidden = false;
    evidenceError.textContent =
      "Measured encounter metrics are ready. Retry to refresh the narrative.";
    retryEvidenceButton.hidden = false;
    setLane(
      evidenceState,
      evidenceStatus,
      "Metrics ready",
      "Measured encounter metrics are ready for review.",
      "complete"
    );
    evidenceReviewReady = true;
    resultsVisible = true;
    resultsPanel.hidden = false;
    updateState(
      "review",
      "Review the measured encounter metrics, then approve or dismiss."
    );
    resultsPanel.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

async function finishEncounter(generation: number): Promise<void> {
  if (generation !== lifecycleGeneration) return;
  if (!conductorSession) throw new Error("No active assessment.");
  conductorSession.setGuidedTaskEvidenceIntervals(
    guidedDemo.snapshot().acceptedEvidenceIntervals
  );
  const result = conductorSession.complete();
  latestObservation = result.observation;
  conductorSession = null;
  latestOutcomes = createModalityOutcomes(
    result.observation,
    allEvents
  );
  for (const outcome of latestOutcomes) {
    const created = emitWorkflowEvent(
      outcome.modality === "speech"
        ? "speech-acoustic"
        : "facial-expressivity",
      "modality.outcome.created",
      "ambient-capture",
      outcome.status === "measured"
        ? `${
            outcome.modality === "speech" ? "Speech" : "Facial"
          } outcome measured from accepted evidence.`
        : `${
            outcome.modality === "speech" ? "Speech" : "Facial"
          } analysis completed without adding a metric to the report.`,
      {
        outcomeId: outcome.outcomeId,
        modality: outcome.modality,
        status: outcome.status,
        ...("reasonCode" in outcome
          ? { reasonCode: outcome.reasonCode }
          : {})
      },
      outcome.supportRefs
    );
    outcome.eventIds.push(created.eventId);
  }
  const routed = emitWorkflowEvent(
    "capture-conductor",
    "coordinator.decision.recorded",
    "ambient-capture",
    "Measured encounter metrics routed for grounding.",
    {
      outcomes: latestOutcomes.map((outcome) => ({
        modality: outcome.modality,
        status: outcome.status
      }))
    },
    latestOutcomes.flatMap((outcome) => outcome.supportRefs)
  );
  setHandoffStep(
    captureHandoff,
    "complete",
    "Complete",
    routed.eventId
  );
  setHandoffStep(groundingHandoff, "active", "Preparing");
  setHandoffStep(reviewHandoff, "pending", "Next");
  setCoordinatorDecision(
    "Measurements routed to Clinical Synthesis",
    routed.eventId
  );
  resultsPanel.dataset.eventId = routed.eventId;
  renderObservation(result.observation, false);
  setLane(
    conductorState,
    conductorStatus,
    "Complete",
    "The audiovisual observation is complete.",
    "complete"
  );
  setLane(
    speechState,
    speechStatus,
    latestOutcomes[0].status === "measured" ? "Measured" : "Complete",
    latestOutcomes[0].status === "measured"
      ? latestOutcomes[0].statement
      : "Speech Analysis completed the encounter interval.",
    "complete"
  );
  setLane(
    faceLaneState,
    faceStatus,
    latestOutcomes[1].status === "measured" ? "Measured" : "Complete",
    latestOutcomes[1].status === "measured"
      ? latestOutcomes[1].statement
      : "Facial Analysis completed the encounter interval.",
    "complete"
  );
  renderPendingEvidence();
  updateState(
    "analyzing",
    "Measured evidence is ready while the encounter summary is prepared."
  );
  revealResults();
  await synthesizeEvidence(generation);
}

function revealResults(): void {
  if (!latestObservation) return;
  resultsVisible = true;
  resultsPanel.hidden = false;
  resultsPanel.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function finalizeCapture(): Promise<void> {
  if (state !== "capturing" || !guidedDemo.snapshot().canComplete) return;
  const generation = lifecycleGeneration;
  const completionEvent =
    [...allEvents]
      .reverse()
      .find((event) => event.type === "demo.phase.completed") ??
    allEvents.at(-1);
  if (completionEvent) {
    showCameraCallout(
      "Assessment complete",
      "teal",
      completionEvent.eventId
    );
  }
  guidanceStep.textContent = "Capture complete";
  guidanceTitle.textContent = "Assessment complete";
  guidanceDetail.textContent = "Preparing the clinician encounter summary.";
  guidanceProgressFill.style.width = "100%";
  await new Promise((resolve) => window.setTimeout(resolve, 320));
  if (
    generation !== lifecycleGeneration ||
    state !== "capturing" ||
    !guidedDemo.snapshot().canComplete
  ) {
    if (
      generation === lifecycleGeneration &&
      state === "capturing"
    ) {
      captureFinalizationScheduled = false;
    }
    return;
  }
  await releaseMedia();
  if (generation !== lifecycleGeneration) return;
  updateState(
    "analyzing",
    "Reconciling signal windows and preparing the encounter summary."
  );
  cameraEmpty.hidden = false;
  cameraEmpty.querySelector("strong")!.textContent = "Assessment complete";
  cameraEmpty.querySelector("span:last-child")!.textContent =
    "Camera and microphone access has been released.";
  liveStrip.hidden = true;
  guidanceCard.hidden = true;
  cameraCallout.hidden = true;
  voiceState.textContent = "Released";
  faceState.textContent = "Released";
  privacyStatus.textContent =
    "Camera and microphone released · no audio or video stored";
  try {
    await finishEncounter(generation);
  } catch {
    if (generation !== lifecycleGeneration) return;
    updateState(
      "error",
      "The encounter summary could not be completed. Start a new assessment."
    );
  }
}

function recordReview(decision: ReviewDecision["decision"]): void {
  if (!latestObservation || !latestEvidence || !evidenceReviewReady) return;
  const approved = decision === "approved";
  const review: ReviewDecision = {
    decision,
    approvedForSession: approved,
    decidedAt: new Date().toISOString()
  };
  const reviewEvent = emitWorkflowEvent(
    "clinician-review",
    approved ? "human-review.accepted" : "human-review.rejected",
    "human-review",
    approved
      ? "Clinician review approved the encounter summary."
      : "Clinician review dismissed the encounter summary.",
    { ...review },
    latestEvidence.grounding.groundedClaimIds
  );
  reviewOutcome.textContent = approved ? "" : "Summary dismissed.";
  acceptButton.disabled = true;
  rejectButton.disabled = true;
  setLane(
    reviewState,
    reviewStatus,
    approved ? "Approved" : "Dismissed",
    approved
      ? "Human review completed."
      : "The summary was not approved.",
    approved ? "complete" : "quiet"
  );
  if (approved) {
    acceptButton.hidden = true;
    rejectButton.hidden = true;
    reviewControls.classList.add("is-approved");
    approvalConfirmation.hidden = false;
    approvalConfirmation.dataset.eventId = reviewEvent.eventId;
    const baselineEvent = emitWorkflowEvent(
      "personal-trajectory",
      "baseline.established",
      "personal-trajectory",
      "Established today as Visit 1 for future within-patient comparison.",
      {
        visitNumber: 1,
        futureVisits: "empty-placeholders"
      },
      latestEvidence.grounding.groundedClaimIds
    );
    baselinePanel.dataset.eventId = baselineEvent.eventId;
    baselinePanel.classList.add("is-established");
    baselinePanel.hidden = false;
  }
  updateState(
    "reviewed",
    approved
      ? "Assessment and clinician review complete."
      : "Assessment complete; summary dismissed."
  );
  if (approved) {
    window.setTimeout(() => {
      baselinePanel.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 240);
  }
}

function clearEncounterRuntimeState(): void {
  conductorSession = null;
  captureFinalizationScheduled = false;
  resultsVisible = false;
  audioFrames = [];
  receivedFaceFrameCount = 0;
  usableFaceFrameCount = 0;
  latestAudioFeature = null;
  latestAudioFeatureAtMs = Number.NEGATIVE_INFINITY;
  latestFaceUsable = false;
  guidedPhaseFaceFrames = [];
  neutralFacialBaseline = null;
  quietRmsSamples = [];
  preflightFaceFrames = [];
  preflightPitchedFrames = 0;
  preflightSpeechEnergyFrames = 0;
  allEvents = [];
  latestObservation = null;
  latestOutcomes = null;
  latestEvidence = null;
  evidenceReviewReady = false;
  captureVisitId = "";
  lastGuidedTransitionId = 0;
  lastAssistancePhase = null;
  lastFaceQuality = "unknown";
  faceWindowOpen = false;
  latestVisualRuntimeDiagnostics = null;
  lastOperatorDiagnosticsRenderAtMs = Number.NEGATIVE_INFINITY;
  testVisualCaptureSuspended = false;
  guidedDemo.reset(0);
  operatorOutput.textContent = "";
}

async function performResetCapture(
  resetGeneration: number
): Promise<void> {
  await releaseMedia();
  if (resetGeneration !== lifecycleGeneration) return;
  replaceLandmarkOverlayCanvas();
  faceWorker = createFaceWorker();
  bindFaceWorker(faceWorker);
  visualCaptureEpoch += 1;
  attachLandmarkOverlay(faceWorker);
  visualPipeline = null;
  videoCaptureSettings = defaultVideoCaptureSettings();
  visualSmokeSubmitted = false;
  if (testCaptureMode) {
    faceWorkerReady = true;
  } else {
    initializeVisualWorkerForCurrentEpoch();
  }
  calibration = null;
  consentCheckbox.checked = false;
  cameraEmpty.hidden = false;
  cameraEmpty.querySelector("strong")!.textContent =
    "Ready for system check";
  cameraEmpty.querySelector("span:last-child")!.textContent =
    "Confirm consent to begin.";
  liveStrip.hidden = true;
  guidanceCard.hidden = true;
  cameraCallout.hidden = true;
  delete cameraCallout.dataset.eventId;
  delete cameraCallout.dataset.tone;
  sessionClock.textContent = "00:00";
  voiceState.textContent = "Waiting";
  voiceState.dataset.status = "quiet";
  faceState.textContent = "Waiting";
  faceState.dataset.status = "quiet";
  speechSignalCaption.textContent = "Analysis standing by";
  faceSignalCaption.textContent = "Analysis preparing";
  speechDurationValue.textContent = "0.0 s";
  pitchCoverageValue.textContent = "0%";
  faceUsabilityValue.textContent = "0%";
  faceRecoveryValue.textContent = "0/3";
  micMeterFill.style.width = "0%";
  faceQualityFill.style.width = "0%";
  guidanceProgressFill.style.width = "0%";
  clearEventList();
  resultsPanel.hidden = true;
  delete resultsPanel.dataset.eventId;
  delete evidenceLoading.dataset.eventId;
  delete evidenceCard.dataset.eventId;
  baselinePanel.hidden = true;
  baselinePanel.classList.remove("is-established");
  delete baselinePanel.dataset.eventId;
  traceDrawer.hidden = true;
  traceDrawer.classList.remove("is-open");
  traceBackdrop.hidden = true;
  document.body.classList.remove("trace-open");
  approvalConfirmation.hidden = true;
  delete approvalConfirmation.dataset.eventId;
  acceptButton.hidden = false;
  rejectButton.hidden = false;
  reviewControls.classList.remove("is-approved");
  reviewOutcome.textContent = "";
  resetHandoff();
  document
    .querySelector<HTMLElement>(".agent-graph")
    ?.removeAttribute("data-face-path");
  for (const item of document.querySelectorAll(".milestone")) {
    item.classList.remove("is-complete");
  }
  privacyStatus.textContent = "Camera and microphone are off.";
  setLane(
    conductorState,
    conductorStatus,
    "Ready",
    "Ready for a consented system check.",
    "quiet"
  );
  setLane(
    speechState,
    speechStatus,
    "Waiting",
    "Waiting for room calibration.",
    "quiet"
  );
  setLane(
    faceLaneState,
    faceStatus,
    faceWorkerReady ? "Ready" : "Preparing",
    faceWorkerReady
      ? "Ready for system check."
      : "Facial analysis is preparing; the system check can still begin.",
    faceWorkerReady ? "complete" : "quiet"
  );
  setLane(
    evidenceState,
    evidenceStatus,
    "Standing by",
    "Waiting for a completed assessment.",
    "quiet"
  );
  setLane(
    reviewState,
    reviewStatus,
    "Waiting",
    "No summary awaiting review.",
    "quiet"
  );
  updateState(
    "idle",
    "The system check verifies framing, room conditions, and speech."
  );
}

function resetCapture(): Promise<void> {
  consentCheckbox.checked = false;
  if (resetCaptureOperation) return resetCaptureOperation;

  lifecycleGeneration += 1;
  const resetGeneration = lifecycleGeneration;
  clearEncounterRuntimeState();
  const operation = performResetCapture(resetGeneration).finally(() => {
    if (resetCaptureOperation === operation) {
      resetCaptureOperation = null;
    }
  });
  resetCaptureOperation = operation;
  return operation;
}

async function discardAssessment(): Promise<void> {
  if (state !== "capturing") return;
  const confirmed = window.confirm(
    "End and discard this assessment? Camera and microphone access will stop immediately, and no report will be created."
  );
  if (!confirmed) return;
  stopButton.disabled = true;
  await resetCapture();
}

async function checkSynthesisReadiness(): Promise<void> {
  try {
    const response = await fetch("/api/model-readiness", {
      headers: { Accept: "application/json" }
    });
    const result = (await response.json()) as { ready: boolean };
    synthesisReady = response.ok && result.ready;
  } catch {
    synthesisReady = false;
  } finally {
    readinessChecked = true;
    setLane(
      evidenceState,
      evidenceStatus,
      "Standing by",
      "Waiting for a completed assessment.",
      "quiet"
    );
    if (!synthesisReady) {
      captureHint.textContent =
        "System check is ready. The encounter workflow can begin.";
    }
    refreshStartAvailability();
  }
}

function smokeDiagnostics(): FrameStreamDiagnostics {
  return {
    schemaVersion: FRAME_STREAM_SCHEMA_VERSION,
    presented: 1,
    submitted: 1,
    processed: 0,
    skipped: 0,
    stale: 0,
    failed: 0,
    analyzedCadenceHz: 0,
    latestInterResultGapMs: null,
    maximumInterResultGapMs: null,
    busyDropFraction: 0,
    rollingWindowMs: 2_000
  };
}

async function submitVisualWorkerSmoke(): Promise<void> {
  if (visualSmokeSubmitted) return;
  visualSmokeSubmitted = true;
  const canvas = new OffscreenCanvas(64, 64);
  const context = canvas.getContext("2d");
  context?.fillRect(0, 0, 64, 64);
  const bitmap = await createImageBitmap(canvas);
  const acquiredAtMs = performance.now();
  const message = visualWorkerMessage<VisualWorkerFrameMessage>({
    type: "frame",
    captureEpoch: visualCaptureEpoch,
    sequence: 1,
    tMs: 0,
    acquiredAtMs,
    taskContext: "establishing",
    width: bitmap.width,
    height: bitmap.height,
    bitmap,
    stream: smokeDiagnostics(),
    calibration: null
  });
  faceWorker.postMessage(message, [bitmap]);
}

function applyVisualPipelineProvenance(
  provenance: VisualPipelineProvenance,
  observedAtMs?: number
): void {
  const previousProcessorRef = visualPipeline?.processorRef;
  visualPipeline = provenance;
  conductorSession?.setVisualPipeline(provenance);
  if (
    state !== "capturing" ||
    !previousProcessorRef ||
    previousProcessorRef === provenance.processorRef
  ) {
    return;
  }

  const atMs =
    observedAtMs ??
    Math.max(
      0,
      Math.round(performance.now() - sessionStartedAtPerformance)
    );
  const before = guidedDemo.snapshot(atMs);
  const after = guidedDemo.resetCurrentGate(
    atMs,
    provenance.processorRef
  );
  guidedPhaseFaceFrames = [];
  const neutralWasInvalidated =
    before.confirmations.neutralFace === "confirmed" &&
    after.confirmations.neutralFace !== "confirmed";
  if (neutralWasInvalidated) {
    neutralFacialBaseline = null;
  }
  captureFinalizationScheduled = false;
  lastAssistancePhase = null;
  updateMilestones(after);
}

function handleVisualWorkerMessage(event: MessageEvent<unknown>): void {
  const message = event.data as VisualWorkerResponse;
  if (
    !message ||
    message.schemaVersion !== VISUAL_WORKER_MESSAGE_VERSION ||
    message.captureEpoch !== visualCaptureEpoch
  ) {
    return;
  }

  if (message.type === "ready") {
    faceWorkerReady = true;
    visualLaneGuard.markWorkerAvailable(true);
    applyVisualPipelineProvenance(message.provenance);
    setLane(
      faceLaneState,
      faceStatus,
      "Ready",
      "Ready for system check.",
      "complete"
    );
    if (
      visualAcquisitionStateActive() &&
      !document.hidden &&
      cameraTrackAvailable()
    ) {
      if (visualFramePump) visualFramePump.start();
      else resumeVisualAcquisition();
    }
    if (visualWorkerSmokeMode) {
      void submitVisualWorkerSmoke();
    }
    refreshStartAvailability();
    return;
  }

  if (message.type === "overlay-status") {
    landmarkOverlayAttached = message.attached;
    if (!message.attached) {
      landmarkOverlay.hidden = true;
      meshDisclosure.hidden = true;
    }
    return;
  }

  if (message.type === "discarded") {
    visualScheduler?.discard({
      captureEpoch: message.captureEpoch,
      sequence: message.sequence,
      acquisitionTimestampMs: message.acquiredAtMs
    });
    return;
  }

  if (message.type === "error") {
    if (message.sequence !== null && message.acquiredAtMs !== null) {
      visualScheduler?.fail({
        captureEpoch: message.captureEpoch,
        sequence: message.sequence,
        acquisitionTimestampMs: message.acquiredAtMs
      });
    }
    faceWorkerReady = false;
    handleVisualWorkerFailure();
    captureHint.textContent =
      "Speech Analysis can continue if Facial Analysis is unavailable.";
    refreshStartAvailability();
    return;
  }

  if (message.type === "disposed") return;

  if (
    visualWorkerSmokeMode &&
    visualScheduler === null &&
    message.sequence === 1
  ) {
    latestVisualRuntimeDiagnostics = {
      acquiredAtMs: message.frame.acquiredAtMs,
      analyzedFrameRate: message.frame.analyzedFrameRate,
      interResultGapMs: message.frame.interResultGapMs,
      processingLatencyMs: message.frame.processingLatencyMs,
      qualityReasons: [...message.frame.qualityReasons]
    };
    renderOperatorDiagnostics(undefined, true);
    document.body.dataset.visualWorkerSmoke = "complete";
    document.body.dataset.visualWorkerSmokeFace = message.frame.faceVisible
      ? "visible"
      : "not-visible";
    return;
  }

  const visualResult = {
    captureEpoch: message.captureEpoch,
    sequence: message.sequence,
    acquisitionTimestampMs: message.acquiredAtMs
  };
  if (!visualResultAcceptanceGuard.accepts(message.acquiredAtMs)) {
    visualScheduler?.discard(visualResult);
    return;
  }
  const accepted = visualScheduler?.accept(visualResult);
  if (!accepted) {
    return;
  }
  externalVisualWithholdingActive = false;
  visualLaneGuard.markProcessed(message.acquiredAtMs);
  latestVisualRuntimeDiagnostics = {
    acquiredAtMs: message.frame.acquiredAtMs,
    analyzedFrameRate: message.frame.analyzedFrameRate,
    interResultGapMs: message.frame.interResultGapMs,
    processingLatencyMs: message.frame.processingLatencyMs,
    qualityReasons: [...message.frame.qualityReasons]
  };
  renderOperatorDiagnostics();

  if (state === "calibrating-quiet" || state === "calibrating-voice") {
    preflightFaceFrames.push(message.frame);
    if (preflightFaceFrames.length > 150) preflightFaceFrames.shift();
    const guidance = preflightFaceGuidance(message.frame);
    const ready = guidance === "Face ready";
    updateLiveFace(message.frame, ready, guidance);
    if (!message.boundingBox) {
      clearAllVisualOverlays();
    } else if (overlayRenderThrottle.shouldRender(message.acquiredAtMs)) {
      drawFaceOverlay(message.boundingBox, ready);
    }
    if (ready) showLandmarkOverlay();
    else clearLandmarkOverlay();
    setLane(
      faceLaneState,
      faceStatus,
      ready ? "Stable" : "Adjust",
      ready ? "Facial position is stable." : guidance,
      ready ? "active" : "warning"
    );
    return;
  }
  if (state === "capturing") processCapturedFace(message.frame);
}

function bindFaceWorker(worker: Worker): void {
  worker.addEventListener("message", handleVisualWorkerMessage);
  worker.addEventListener("error", () => {
    if (worker !== faceWorker) return;
    faceWorkerReady = false;
    handleVisualWorkerFailure();
  });
}

bindFaceWorker(faceWorker);
attachLandmarkOverlay(faceWorker);

consentCheckbox.addEventListener("change", () => {
  if (
    !consentCheckbox.checked &&
    !["idle", "review", "reviewed", "error"].includes(state)
  ) {
    void resetCapture();
    return;
  }
  refreshStartAvailability();
});
document.addEventListener("visibilitychange", () => {
  const visible = !document.hidden;
  visualLaneGuard.markPageVisible(visible);
  if (!visible && visualAcquisitionStateActive()) {
    pauseVisualAcquisition("document-hidden");
  } else if (visible) {
    resumeVisualAcquisition();
  }
});
startButton.addEventListener("click", () => {
  if (state === "idle") void runSystemCheck();
  else if (state === "ready") startAssessment();
});
resetButton.addEventListener("click", () => void resetCapture());
stopButton.addEventListener("click", () => void discardAssessment());
retryEvidenceButton.addEventListener("click", () => void synthesizeEvidence());
copyReportButton.addEventListener("click", () => void copyClinicalReport());
acceptButton.addEventListener("click", () => recordReview("approved"));
rejectButton.addEventListener("click", () => recordReview("dismissed"));
traceCloseButton.addEventListener("click", closeTrace);
traceBackdrop.addEventListener("click", closeTrace);
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !traceDrawer.hidden) closeTrace();
});
window.addEventListener("beforeunload", () => {
  mediaStream?.getTracks().forEach((track) => track.stop());
  faceWorker.terminate();
});

if (testCaptureMode) {
  (
    window as typeof window & {
      __phenometricVisualLifecycleTest?: {
        simulateWorkerFailure(): {
          canvasReplaced: boolean;
          overlayHidden: boolean;
        };
        simulateCameraUnavailable(): {
          overlayHidden: boolean;
        };
      };
    }
  ).__phenometricVisualLifecycleTest = {
    simulateWorkerFailure() {
      const priorOverlay = landmarkOverlay;
      handleVisualWorkerFailure();
      return {
        canvasReplaced: priorOverlay !== landmarkOverlay,
        overlayHidden:
          landmarkOverlay.hidden && meshDisclosure.hidden
      };
    },
    simulateCameraUnavailable() {
      testVisualCaptureSuspended = true;
      handleCameraUnavailable();
      return {
        overlayHidden:
          landmarkOverlay.hidden && meshDisclosure.hidden
      };
    }
  };
  faceWorkerReady = true;
  setLane(
    faceLaneState,
    faceStatus,
    "Ready",
    "Ready for system check.",
    "complete"
  );
} else {
  initializeVisualWorkerForCurrentEpoch();
}
operatorDiagnostics.hidden = !operatorMode;
resetHandoff();
void checkSynthesisReadiness();
updateState("idle");
