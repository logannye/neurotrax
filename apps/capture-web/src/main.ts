import "./styles.css";
import {
  createConductorSession,
  createEventFactory,
  type AudioFeatureFrame,
  type ConductorSession,
  type FaceLandmarkFrame
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
  JUDGE_READY_TIMED_POLICY,
  type GuidedDemoSnapshot
} from "./guided-demo.js";

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

interface FaceWorkerFrameMessage {
  type: "frame";
  frame: FaceLandmarkFrame;
  overlayPoints: Array<{ x: number; y: number }>;
  boundingBox: {
    x: number;
    y: number;
    width: number;
    height: number;
  } | null;
}

function element<T extends HTMLElement>(id: string): T {
  const value = document.getElementById(id);
  if (!value) throw new Error(`Missing required element #${id}`);
  return value as T;
}

const cameraPreview = element<HTMLVideoElement>("camera-preview");
const faceOverlay = element<HTMLCanvasElement>("face-overlay");
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

let state: CaptureState = "idle";
let mediaStream: MediaStream | null = null;
let audioContext: AudioContext | null = null;
let audioSource: MediaStreamAudioSourceNode | null = null;
let analyser: AnalyserNode | null = null;
let sampleBuffer: Float32Array | null = null;
let sampleInterval: number | null = null;
let faceInterval: number | null = null;
let clockInterval: number | null = null;
let preflightStartedAt = 0;
let voiceCalibrationStartedAt = 0;
let systemCheckTimer: number | null = null;
let sessionStartedAtPerformance = 0;
let sessionStartedAtEpoch = 0;
let quietRmsSamples: number[] = [];
let preflightFaceFrames: FaceLandmarkFrame[] = [];
let preflightPitchedFrames = 0;
let preflightSpeechEnergyFrames = 0;
let calibration: CaptureCalibration | null = null;
let audioFrames: AudioFeatureFrame[] = [];
let receivedFaceFrameCount = 0;
let usableFaceFrameCount = 0;
let latestAudioFeature: DerivedAudioFeature | null = null;
let latestFaceUsable = false;
let faceWorkerBusy = false;
let faceWorkerReady = false;
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
let lastFaceQuality: "unknown" | "measurable" | "withheld" = "unknown";
let faceWindowOpen = false;
let packetTimer: number | null = null;
let cameraCalloutTimer: number | null = null;
let traceCloseTimer: number | null = null;
const voiceTracker = createVoiceActivityTracker();
const guidedDemo = createGuidedDemoController();

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

const faceWorker = new Worker(new URL("./face-worker.ts", import.meta.url), {
  type: "module"
});

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
  if (unit === "motion-index") return "movement index";
  if (unit === "pauses-per-minute") return "pauses/min";
  if (unit === "blinks-per-minute") return "blinks/min";
  if (unit === "normalized-range") return "normalized range";
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
    .replaceAll("motion-index", "movement index")
    .replaceAll("pauses-per-minute", "pauses/min")
    .replaceAll("blinks-per-minute", "blinks/min")
    .replaceAll("normalized-range", "normalized range");
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
    "prototype.face.expressivity",
    "prototype.face.mouth_amplitude",
    "prototype.face.eye_aperture_range",
    "prototype.face.blink_rate",
    "prototype.face.brow_amplitude"
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
    recoveryConfirmed: "Facial reconnection",
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
      return value ? "Confirmed" : "Not observed";
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
  resetButton.hidden = !["review", "reviewed", "error"].includes(nextState);

  if (nextState === "idle" || nextState === "ready") {
    stopButton.textContent = "Complete assessment";
    refreshStartAvailability();
  }
  if (nextState === "capturing") {
    stopButton.textContent = "Complete assessment";
    stopButton.disabled = true;
  }
  if (nextState === "analyzing") {
    stopButton.textContent = "Summary in progress";
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
      ["return", "post-recovery", "complete"].includes(snapshot.phase)
  );
  milestone("recovered")?.classList.toggle(
    "is-complete",
    snapshot.confirmations.recovery === "confirmed" ||
      ["post-recovery", "complete"].includes(snapshot.phase)
  );
  stopButton.disabled = true;

  const phaseDuration =
    snapshot.phase === "complete"
      ? 1
      : JUDGE_READY_TIMED_POLICY.phases.find(
          (phase) => phase.phase === snapshot.phase
        )?.maximumDurationMs ?? 1;
  guidanceProgressFill.style.width = `${
    snapshot.phase === "complete"
      ? 100
      : Math.round(
          ((phaseDuration - snapshot.remainingMs) / phaseDuration) * 100
        )
  }%`;

  if (snapshot.phase === "establishing") {
    guidanceStep.textContent = "Step 1 of 4";
    guidanceTitle.textContent = "Speak naturally";
    guidanceDetail.textContent =
      "Keep your face centered while speech and facial signals stabilize.";
  } else if (snapshot.phase === "turn-away") {
    guidanceStep.textContent = "Step 2 of 4";
    guidanceTitle.textContent = "Briefly turn away";
    guidanceDetail.textContent =
      "Continue speaking while Facial Analysis pauses until you return.";
  } else if (snapshot.phase === "return") {
    guidanceStep.textContent = "Step 3 of 4";
    guidanceTitle.textContent = "Return to the camera";
    guidanceDetail.textContent =
      "Hold a centered position while facial analysis restores.";
  } else if (snapshot.phase === "post-recovery") {
    guidanceStep.textContent = "Step 4 of 4";
    guidanceTitle.textContent = "Continue briefly";
    guidanceDetail.textContent =
      "A final facial window is being measured.";
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

function recordTimedTransition(snapshot: GuidedDemoSnapshot): void {
  const transition = snapshot.lastTransition;
  if (!transition || transition.id <= lastGuidedTransitionId) return;
  lastGuidedTransitionId = transition.id;
  const confirmed = transition.outcome === "confirmed";
  const completion = emitWorkflowEvent(
    "capture-conductor",
    confirmed ? "demo.phase.completed" : "demo.phase.timed-out",
    "ambient-capture",
    confirmed
      ? `Completed the ${transition.from} phase with its target signal confirmed.`
      : `Completed the ${transition.from} phase.`,
    {
      phase: transition.from,
      confirmation: confirmed ? "confirmed" : "not-confirmed",
      transitionAtMs: transition.atMs
    }
  );
  const decisionSummary = confirmed
    ? `Coordinator advanced after confirming ${transition.from.replaceAll("-", " ")}.`
    : "Coordinator advanced the assessment.";
  emitWorkflowEvent(
    "capture-conductor",
    "coordinator.decision.recorded",
    "ambient-capture",
    decisionSummary,
    {
      phase: transition.from,
      decision: "advance",
      confirmation: confirmed ? "confirmed" : "not-confirmed"
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

function advanceTimedEncounter(tMs: number): void {
  if (state !== "capturing") return;
  let snapshot = guidedDemo.tick(tMs);
  recordTimedTransition(snapshot);
  if (
    snapshot.phase === "post-recovery" &&
    faceWindowOpen &&
    latestFaceUsable &&
    tMs - snapshot.phaseStartedAt >= 1_500
  ) {
    snapshot = guidedDemo.notePostRecoveryWindow();
  }
  updateMilestones(snapshot);
  faceRecoveryValue.textContent =
    snapshot.confirmations.recovery === "confirmed"
      ? "Confirmed"
      : snapshot.confirmations.recovery === "not-confirmed"
        ? "Monitoring"
        : "Pending";
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
  if (event.type === "capture.window.opened" && event.payload.modality === "speech") {
    updateMilestones(guidedDemo.noteSpeechWindow());
  }
  if (
    event.type === "capture.window.opened" &&
    event.payload.modality === "face"
  ) {
    faceWindowOpen = true;
    const snapshot = guidedDemo.snapshot();
    if (snapshot.phase === "establishing") {
      updateMilestones(guidedDemo.noteInitialFaceWindow());
    }
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
        updateMilestones(
          guidedDemo.noteWithholding(
            latestAudioFeature?.voiced ?? false
          )
        );
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
        ["return", "post-recovery"].includes(snapshot.phase)
      ) {
        updateMilestones(guidedDemo.noteRecovery());
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
  if (operatorMode) {
    operatorOutput.textContent = JSON.stringify(
      {
        policy: JUDGE_READY_TIMED_POLICY,
        calibration,
        latestEvent: normalized,
        eventCount: allEvents.length
      },
      null,
      2
    );
  }
  applyEventToLanes(normalized);
  eventList.querySelector(".event-placeholder")?.remove();

  const visibleTypes = new Set<AmbientEventType>([
    "capture.window.opened",
    "capture.quality.changed",
    "demo.phase.timed-out",
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
      : normalized.type === "demo.phase.timed-out"
      ? "Encounter Coordinator completed the current phase."
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
  frame: FaceLandmarkFrame,
  usable: boolean,
  guidance: string
): void {
  receivedFaceFrameCount += 1;
  if (state === "capturing" && usable) usableFaceFrameCount += 1;
  faceQualityFill.style.width = `${Math.round(
    frame.framingFraction * 100
  )}%`;
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
  points: Array<{ x: number; y: number }>,
  box: { x: number; y: number; width: number; height: number } | null,
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
  context.setLineDash([]);
  context.fillStyle = measurable
    ? "rgba(77, 224, 198, 0.98)"
    : "rgba(244, 164, 84, 0.98)";
  context.strokeStyle = "rgba(255, 255, 255, 0.96)";
  context.lineWidth = 2.5;
  for (const point of points) {
    context.beginPath();
    context.arc(point.x * width, point.y * height, 6, 0, Math.PI * 2);
    context.fill();
    context.stroke();
  }
  context.restore();
}

function completeSystemCheck(): void {
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
  window.clearInterval(faceInterval ?? undefined);
  window.clearTimeout(systemCheckTimer ?? undefined);
  sampleInterval = null;
  faceInterval = null;
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
          JUDGE_READY_TIMED_POLICY.systemCheckMaximumMs) *
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
        JUDGE_READY_TIMED_POLICY.quietCalibrationMs &&
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
  audioFrames.push(frame);
  conductorSession.ingestAudio(frame);
}

async function sampleFaceFrame(): Promise<void> {
  if (
    !["calibrating-quiet", "calibrating-voice", "capturing"].includes(state) ||
    !faceWorkerReady ||
    faceWorkerBusy ||
    cameraPreview.readyState < HTMLMediaElement.HAVE_CURRENT_DATA
  ) {
    return;
  }
  faceWorkerBusy = true;
  try {
    const bitmap = await createImageBitmap(cameraPreview);
    faceWorker.postMessage(
      {
        type: "frame",
        bitmap,
        tMs: Math.round(performance.now())
      },
      [bitmap]
    );
  } catch {
    faceWorkerBusy = false;
    setLane(
      faceLaneState,
      faceStatus,
      "Monitoring",
      "Facial Analysis is preparing the next camera sample.",
      "quiet"
    );
  }
}

function processCapturedFace(
  rawFrame: FaceLandmarkFrame,
  overlayPoints: Array<{ x: number; y: number }> = [],
  boundingBox: {
    x: number;
    y: number;
    width: number;
    height: number;
  } | null = null
): void {
  if (!calibration || !conductorSession) return;
  const tMs = Math.round(performance.now() - sessionStartedAtPerformance);
  const calibrated = calibration.face
    ? calibrateFaceFrame({ ...rawFrame, tMs }, calibration.face)
    : {
        frame: { ...rawFrame, tMs, framingFraction: 0 },
        usable: false,
        guidance: "Move into view" as const
      };
  latestFaceUsable = calibrated.usable;
  conductorSession.ingestFace(calibrated.frame);
  updateLiveFace(
    calibrated.frame,
    calibrated.usable,
    calibrated.guidance
  );
  drawFaceOverlay(overlayPoints, boundingBox, calibrated.usable);
}

function updateClock(): void {
  if (state !== "capturing") return;
  const elapsed = performance.now() - sessionStartedAtPerformance;
  sessionClock.textContent = formatElapsed(elapsed);
  advanceTimedEncounter(elapsed);
}

async function initializeMedia(): Promise<void> {
  mediaStream = await navigator.mediaDevices.getUserMedia({
    video: {
      facingMode: "user",
      width: { ideal: 1280 },
      height: { ideal: 720 }
    },
    audio: {
      echoCancellation: true,
      noiseSuppression: false,
      autoGainControl: false
    }
  });
  cameraPreview.srcObject = mediaStream;
  await cameraPreview.play();
  audioContext = new AudioContext({ latencyHint: "interactive" });
  await audioContext.resume();
  audioSource = audioContext.createMediaStreamSource(mediaStream);
  analyser = audioContext.createAnalyser();
  analyser.fftSize = 4096;
  analyser.smoothingTimeConstant = 0;
  audioSource.connect(analyser);
  sampleBuffer = new Float32Array(analyser.fftSize);
}

async function runSystemCheck(): Promise<void> {
  if (state !== "idle" || !consentCheckbox.checked) {
    return;
  }
  updateState("requesting", "Allow camera and microphone access to continue.");
  voiceState.textContent = "Preparing";
  faceState.textContent = "Preparing";
  speechSignalCaption.textContent = "Preparing speech analysis";
  faceSignalCaption.textContent = "Preparing facial analysis";
  try {
    if (testCaptureMode) {
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
                  baselineBoxWidth: 0.24,
                  baselineBoxHeight: 0.4,
                  baselineIllumination: 0.58
                },
          usableFrameCount:
            testScenario === "missing-face" ? 0 : 12
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

    await initializeMedia();
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
    sampleInterval = window.setInterval(sampleAudioFrame, 100);
    faceInterval = window.setInterval(() => void sampleFaceFrame(), 100);
    systemCheckTimer = window.setTimeout(
      completeSystemCheck,
      JUDGE_READY_TIMED_POLICY.systemCheckMaximumMs
    );
  } catch {
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
  captureFinalizationScheduled = false;
  resultsVisible = false;
  audioFrames = [];
  receivedFaceFrameCount = 0;
  usableFaceFrameCount = 0;
  latestAudioFeature = null;
  latestFaceUsable = false;
  voiceTracker.reset();
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
  lastFaceQuality = "unknown";
  faceWindowOpen = false;
  baselinePanel.hidden = true;
  captureVisitId = `visit-${crypto.randomUUID()}`;
  conductorSession = createConductorSession(
    {
      containsPHI: false,
      visitId: captureVisitId,
      participantId: captureParticipantId,
      captureMode: "live",
      occurredAt: new Date(sessionStartedAtEpoch).toISOString(),
      captureAdapter: { id: "macbook-browser", version: "0.3.0" },
      calibration
    },
    {
      baseTimeMs: sessionStartedAtEpoch,
      onEvent: appendEvent
    }
  );
}

function startTestCapture(): void {
  let fixtureTimeMs = 0;
  const establishingEndMs =
    JUDGE_READY_TIMED_POLICY.phases[0].maximumDurationMs;
  const turnAwayEndMs =
    establishingEndMs +
    JUDGE_READY_TIMED_POLICY.phases[1].maximumDurationMs;
  const encounterEndMs = JUDGE_READY_TIMED_POLICY.phases.reduce(
    (total, phase) => total + phase.maximumDurationMs,
    0
  );
  const intervalMs = observeTestTransitions
    ? 30
    : fastTestCapture
      ? 8
      : 100;
  sampleInterval = window.setInterval(() => {
    if (state !== "capturing" || !conductorSession) return;
    const speechAvailable = testScenario !== "missing-speech";
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
    audioFrames.push(audio);
    conductorSession.ingestAudio(audio);
    updateLiveAudio(audio);

    const turnedAway =
      testScenario === "missing-face" ||
      (testScenario === "missed-recovery" &&
        fixtureTimeMs >= establishingEndMs + 200) ||
      (testScenario !== "missed-turn" &&
        fixtureTimeMs >= establishingEndMs + 200 &&
        fixtureTimeMs <= turnAwayEndMs - 600);
    const unavailableFace = testScenario === "missing-face";
    const faceWithheld = turnedAway || unavailableFace;
    const face: FaceLandmarkFrame = {
      tMs: fixtureTimeMs,
      faceVisible: !faceWithheld,
      framingFraction: faceWithheld ? 0 : 0.9,
      illumination: 0.58,
      yawDegrees: faceWithheld ? 48 : 5,
      eyeAspectRatio: fixtureTimeMs % 1300 === 0 ? 0.15 : 0.31,
      browRaise: 0.15 + (fixtureTimeMs % 500) / 5000,
      mouthOpen: 0.12,
      landmarkMotion: 0.04 + (fixtureTimeMs % 300) / 30000,
      observedFrameRate: 10,
      faceBoxWidth: faceWithheld ? 0 : 0.24,
      faceBoxHeight: faceWithheld ? 0 : 0.4,
      edgeMargin: faceWithheld ? 0 : 0.1
    };
    const originalNow = sessionStartedAtPerformance;
    sessionStartedAtPerformance = performance.now() - fixtureTimeMs;
    processCapturedFace(face);
    sessionStartedAtPerformance = originalNow;
    sessionClock.textContent = formatElapsed(fixtureTimeMs);
    advanceTimedEncounter(fixtureTimeMs);
    fixtureTimeMs += 100;
    if (fixtureTimeMs > encounterEndMs + 100 && sampleInterval !== null) {
      window.clearInterval(sampleInterval);
      sampleInterval = null;
    }
  }, intervalMs);
}

function startAssessment(): void {
  if (state !== "ready" || !calibration) return;
  prepareConductor();
  faceWorker.postMessage({ type: "reset" });
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
    "Follow the four guided steps to complete the assessment."
  );
  updateMilestones(guidedDemo.snapshot());
  emitWorkflowEvent(
    "capture-conductor",
    "demo.phase.started",
    "ambient-capture",
    "Started the establishing phase.",
    { phase: "establishing" }
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
    clockInterval = window.setInterval(updateClock, 100);
    sampleInterval = window.setInterval(sampleAudioFrame, 100);
    faceInterval = window.setInterval(() => void sampleFaceFrame(), 100);
  }
}

async function releaseMedia(): Promise<void> {
  for (const interval of [sampleInterval, faceInterval, clockInterval]) {
    if (interval !== null) window.clearInterval(interval);
  }
  sampleInterval = null;
  faceInterval = null;
  clockInterval = null;
  window.clearTimeout(systemCheckTimer ?? undefined);
  window.clearTimeout(packetTimer ?? undefined);
  window.clearTimeout(cameraCalloutTimer ?? undefined);
  window.clearTimeout(traceCloseTimer ?? undefined);
  systemCheckTimer = null;
  packetTimer = null;
  cameraCalloutTimer = null;
  traceCloseTimer = null;
  evidencePacket.hidden = true;
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
  if (context && context.state !== "closed") await context.close();
  faceWorker.postMessage({ type: "reset" });
  faceWorkerBusy = false;
  faceOverlay.getContext("2d")?.clearRect(
    0,
    0,
    faceOverlay.width,
    faceOverlay.height
  );
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
    aggregate.code.startsWith("prototype.speech.")
      ? `Signal confidence: ${Math.round(aggregate.confidence * 100)}%\nAccepted windows: ${aggregate.windowCount}\nSpeech signal-to-noise: ${aggregate.confounds.snrDb.toFixed(1)} dB`
      : `Signal confidence: ${Math.round(aggregate.confidence * 100)}%\nAccepted windows: ${aggregate.windowCount}\nFace framing quality: ${Math.round(aggregate.confounds.faceFramingFraction * 100)}%\nIllumination: ${Math.round(aggregate.confounds.illuminationRelative * 100)}%`;
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

async function synthesizeEvidence(): Promise<void> {
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
        visitId: latestObservation.visitId,
        qualitySummary: latestObservation.qualitySummary,
        outcomes: latestOutcomes
      })
    });
    window.clearTimeout(timeout);
    const body = (await response.json()) as
      | EvidenceApiResult
      | { error: string };
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

async function finishEncounter(): Promise<void> {
  if (!conductorSession) throw new Error("No active assessment.");
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
  await synthesizeEvidence();
}

function revealResults(): void {
  if (!latestObservation) return;
  resultsVisible = true;
  resultsPanel.hidden = false;
  resultsPanel.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function finalizeCapture(): Promise<void> {
  if (state !== "capturing" || !guidedDemo.snapshot().canComplete) return;
  const completionEvent =
    [...allEvents]
      .reverse()
      .find((event) =>
        ["demo.phase.completed", "demo.phase.timed-out"].includes(
          event.type
        )
      ) ?? allEvents.at(-1);
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
  await releaseMedia();
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
    await finishEncounter();
  } catch {
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

async function resetCapture(): Promise<void> {
  await releaseMedia();
  conductorSession = null;
  captureFinalizationScheduled = false;
  resultsVisible = false;
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
  faceRecoveryValue.textContent = "Pending";
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

faceWorker.addEventListener("message", (event: MessageEvent) => {
  const message = event.data as
    | { type: "ready" }
    | { type: "error"; message: string }
    | FaceWorkerFrameMessage;
  if (message.type === "ready") {
    faceWorkerReady = true;
    setLane(
      faceLaneState,
      faceStatus,
      "Ready",
      "Ready for system check.",
      "complete"
    );
    refreshStartAvailability();
    return;
  }
  if (message.type === "error") {
    faceWorkerBusy = false;
    faceWorkerReady = false;
    setLane(
      faceLaneState,
      faceStatus,
      "Preparing",
      "Facial Analysis is preparing.",
      "quiet"
    );
    captureHint.textContent =
      "The ambient assessment is ready to continue.";
    refreshStartAvailability();
    return;
  }

  faceWorkerBusy = false;
  const relativeFrame: FaceLandmarkFrame = {
    ...message.frame,
    tMs:
      state === "capturing"
        ? Math.round(performance.now() - sessionStartedAtPerformance)
        : Math.round(performance.now() - preflightStartedAt)
  };
  if (state === "calibrating-quiet" || state === "calibrating-voice") {
    preflightFaceFrames.push(relativeFrame);
    if (preflightFaceFrames.length > 30) preflightFaceFrames.shift();
    const guidance = preflightFaceGuidance(relativeFrame);
    const ready = guidance === "Face ready";
    updateLiveFace(relativeFrame, ready, guidance);
    drawFaceOverlay(
      message.overlayPoints,
      message.boundingBox,
      ready
    );
    setLane(
      faceLaneState,
      faceStatus,
      ready ? "Stable" : "Adjust",
      ready ? "Facial position is stable." : guidance,
      ready ? "active" : "warning"
    );
    return;
  }
  if (state === "capturing") {
    processCapturedFace(
      relativeFrame,
      message.overlayPoints,
      message.boundingBox
    );
  }
});

consentCheckbox.addEventListener("change", refreshStartAvailability);
startButton.addEventListener("click", () => {
  if (state === "idle") void runSystemCheck();
  else if (state === "ready") startAssessment();
});
resetButton.addEventListener("click", () => void resetCapture());
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
  faceWorkerReady = true;
  setLane(
    faceLaneState,
    faceStatus,
    "Ready",
    "Ready for system check.",
    "complete"
  );
} else {
  faceWorker.postMessage({ type: "initialize" });
}
operatorDiagnostics.hidden = !operatorMode;
resetHandoff();
void checkSynthesisReadiness();
updateState("idle");
