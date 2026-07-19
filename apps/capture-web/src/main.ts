import "./styles.css";
import {
  createConductorSession,
  createEventFactory,
  type AudioFeatureFrame,
  type ConductorSession,
  type FaceLandmarkFrame
} from "@neurotrax/ambient-core";
import {
  createModalityOutcomes,
  EVIDENCE_BOUNDARY
} from "@neurotrax/evidence-core";
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
} from "@neurotrax/contracts";
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
const privacyStatus = element<HTMLSpanElement>("privacy-status");
const voiceState = element<HTMLElement>("voice-state");
const speechDurationValue =
  element<HTMLElement>("speech-duration-value");
const pitchCoverageValue =
  element<HTMLElement>("pitch-coverage-value");
const micMeter = element<HTMLDivElement>("mic-meter");
const micMeterFill = element<HTMLSpanElement>("mic-meter-fill");
const faceState = element<HTMLElement>("face-state");
const faceQualityFill = element<HTMLSpanElement>("face-quality-fill");
const faceUsabilityValue =
  element<HTMLElement>("face-usability-value");
const faceRecoveryValue =
  element<HTMLElement>("face-recovery-value");
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
const aggregateGrid = element<HTMLDivElement>("aggregate-grid");
const evidenceLoading = element<HTMLDivElement>("evidence-loading");
const evidenceError = element<HTMLDivElement>("evidence-error");
const retryEvidenceButton =
  element<HTMLButtonElement>("retry-evidence-button");
const evidenceCard = element<HTMLElement>("evidence-card");
const evidenceHeadline = element<HTMLElement>("evidence-headline");
const evidenceSummary = element<HTMLElement>("evidence-summary");
const evidenceClaims = element<HTMLDivElement>("evidence-claims");
const evidenceStatusChip = element<HTMLElement>("evidence-status-chip");
const boundaryStatement = element<HTMLElement>("boundary-statement");
const copyReportButton =
  element<HTMLButtonElement>("copy-report-button");
const acceptButton = element<HTMLButtonElement>("accept-button");
const rejectButton = element<HTMLButtonElement>("reject-button");
const reviewOutcome = element<HTMLParagraphElement>("review-outcome");
const traceDrawer = element<HTMLElement>("trace-drawer");
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
const voiceTracker = createVoiceActivityTracker();
const guidedDemo = createGuidedDemoController();

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

function formatReason(reason: string): string {
  return reason.replaceAll("-", " ");
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
  eventCount.textContent = "Standby";
  coordinatorDecision.textContent =
    "Waiting to coordinate the assessment.";
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
  milestone("speech")?.classList.toggle(
    "is-limited",
    snapshot.confirmations.establishing === "not-confirmed"
  );
  milestone("withheld")?.classList.toggle(
    "is-complete",
    snapshot.confirmations.withholding === "confirmed" ||
      ["return", "post-recovery", "complete"].includes(snapshot.phase)
  );
  milestone("withheld")?.classList.toggle(
    "is-limited",
    snapshot.confirmations.withholding === "not-confirmed"
  );
  milestone("recovered")?.classList.toggle(
    "is-complete",
    snapshot.confirmations.recovery === "confirmed" ||
      ["post-recovery", "complete"].includes(snapshot.phase)
  );
  milestone("recovered")?.classList.toggle(
    "is-limited",
    snapshot.confirmations.recovery === "not-confirmed"
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
      "Continue speaking while facial analysis withholds measurement.";
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
      "The timed assessment is complete. Camera and microphone access will now be released.";
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
      : `Completed the ${transition.from} phase on time; the target signal was not confirmed.`,
    {
      phase: transition.from,
      confirmation: confirmed ? "confirmed" : "not-confirmed",
      transitionAtMs: transition.atMs
    }
  );
  const decisionSummary = confirmed
    ? `Coordinator advanced after confirming ${transition.from.replaceAll("-", " ")}.`
    : `Coordinator advanced on schedule and preserved ${transition.from.replaceAll("-", " ")} as not confirmed.`;
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
  coordinatorDecision.textContent = decisionSummary;
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
        ? "Not confirmed"
        : "Pending";
}

function applyEventToLanes(event: EventEnvelope): void {
  const actorNode = document.querySelector<HTMLElement>(
    `[data-lane="${event.actor.id}"]`
  );
  if (actorNode) actorNode.dataset.eventId = event.eventId;
  if (event.type === "capture.window.opened") {
    evidencePacket.dataset.eventId = event.eventId;
    evidencePacket.hidden = true;
    window.clearTimeout(packetTimer ?? undefined);
    requestAnimationFrame(() => {
      evidencePacket.hidden = false;
      packetTimer = window.setTimeout(() => {
        evidencePacket.hidden = true;
      }, 1_100);
    });
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
    const reason = String(event.payload.reasonCode ?? "");
    if (event.actor.id === "speech-acoustic") {
      setLane(
        speechState,
        speechStatus,
        quality === "measurable" ? "Active" : "Withheld",
        quality === "measurable"
          ? "A technically usable speech interval is open."
          : `Speech measurement withheld · ${formatReason(reason)}`,
        quality === "measurable" ? "active" : "warning"
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
        coordinatorDecision.textContent =
          "Facial signal withheld · continuing speech analysis";
      } else if (
        lastFaceQuality === "withheld" &&
        ["return", "post-recovery"].includes(snapshot.phase)
      ) {
        updateMilestones(guidedDemo.noteRecovery());
        coordinatorDecision.textContent =
          "Facial signal restored · both modalities reconnected";
      }
      lastFaceQuality = nextFaceQuality;
      setLane(
        faceLaneState,
        faceStatus,
        quality === "measurable" ? "Restored" : "Withheld",
        quality === "measurable"
          ? "Facial signal is within the calibrated quality range."
          : `Facial measurement withheld · ${formatReason(reason)}`,
        quality === "measurable" ? "active" : "warning"
      );
    }
  }
  if (event.type === "evidence-card.requested") {
    setLane(
      evidenceState,
      evidenceStatus,
      "Preparing",
      "Assembling a grounded summary from measured signals.",
      "active"
    );
  }
  if (event.type === "human-review.pending") {
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
  if (event.type === "coordinator.decision.recorded") {
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
    "measurement.abstained",
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
    eventCount.textContent = `${allEvents.length} workflow events`;
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
  summary.textContent = normalized.summary;
  copy.append(meta, summary);
  item.append(marker, copy);
  eventList.append(item);
  while (eventList.children.length > 4) {
    eventList.firstElementChild?.remove();
  }
  eventCount.textContent = `${allEvents.length} workflow events`;
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
  faceState.textContent = usable ? "Measurable" : "Withheld";
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
  context.strokeStyle = measurable ? "#4db6a5" : "#d3914d";
  context.lineWidth = 3;
  context.setLineDash(measurable ? [] : [12, 8]);
  context.strokeRect(
    box.x * width,
    box.y * height,
    box.width * width,
    box.height * height
  );
  context.setLineDash([]);
  context.fillStyle = measurable
    ? "rgba(77, 182, 165, 0.82)"
    : "rgba(211, 145, 77, 0.82)";
  for (const point of points) {
    context.beginPath();
    context.arc(point.x * width, point.y * height, 3, 0, Math.PI * 2);
    context.fill();
  }
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
  guidanceDetail.textContent =
    audioQuality === "strong" && faceResult.quality === "strong"
      ? "Speech and facial conditions are ready."
      : "Assessment can continue; limited signals will be reported honestly.";
  guidanceProgressFill.style.width = "100%";
  setLane(
    conductorState,
    conductorStatus,
    "Ready",
    "The timed assessment is ready to begin.",
    "complete"
  );
  setLane(
    speechState,
    speechStatus,
    audioQuality === "strong" ? "Strong" : "Limited",
    audioQuality === "strong"
      ? "Speech conditions are ready."
      : "Speech quality is limited; the assessment will continue.",
    audioQuality === "strong" ? "complete" : "warning"
  );
  setLane(
    faceLaneState,
    faceStatus,
    faceResult.quality === "strong" ? "Strong" : faceResult.quality === "limited" ? "Limited" : "Unavailable",
    faceResult.quality === "strong"
      ? "Facial conditions are ready."
      : faceResult.quality === "limited"
        ? "Facial quality is limited; the assessment will continue."
        : "Facial signal is unavailable; the assessment will continue.",
    faceResult.quality === "strong" ? "complete" : "warning"
  );
  updateState(
    "ready",
    "System check complete. Begin the timed ambient assessment when ready."
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
    guidanceDetail.textContent = `${Math.min(
      JUDGE_READY_TIMED_POLICY.reliablePitchFramesForStrong,
      preflightPitchedFrames
    )} of ${JUDGE_READY_TIMED_POLICY.reliablePitchFramesForStrong} reliable speech samples · check ends automatically`;
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
      "Unavailable",
      "Facial analysis could not sample the camera.",
      "warning"
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
      cameraEmpty.querySelector("strong")!.textContent =
        "System check complete";
      cameraEmpty.querySelector("span:last-child")!.textContent =
        "Ready for the guided assessment.";
      guidanceCard.hidden = false;
      guidanceStep.textContent = "System check complete";
      guidanceTitle.textContent = "Ready to begin";
      guidanceDetail.textContent =
        "The timed assessment is ready.";
      setLane(
        speechState,
        speechStatus,
        testScenario === "limited-calibration" ? "Limited" : "Strong",
        "Speech conditions were classified without blocking progression.",
        testScenario === "limited-calibration" ? "warning" : "complete"
      );
      setLane(
        faceLaneState,
        faceStatus,
        testScenario === "missing-face" ? "Unavailable" : "Strong",
        testScenario === "missing-face"
          ? "Facial signal is unavailable; the assessment will continue."
          : "Facial conditions are ready.",
        testScenario === "missing-face" ? "warning" : "complete"
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
      "Unavailable",
      "Camera or microphone access could not be established.",
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
      (testScenario === "missed-recovery" && fixtureTimeMs >= 4_200) ||
      (testScenario !== "missed-turn" &&
        fixtureTimeMs >= 4_200 &&
        fixtureTimeMs <= 6_400);
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
    if (fixtureTimeMs > 14_100 && sampleInterval !== null) {
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
      "The test capture follows the same live state machine.";
  }
  liveStrip.hidden = false;
  guidanceCard.hidden = false;
  privacyStatus.textContent =
    "Audio and video are processed during the encounter and are not stored.";
  setLane(
    conductorState,
    conductorStatus,
    "Active",
    "Coordinating independently measurable signal windows.",
    "active"
  );
  setLane(
    speechState,
    speechStatus,
    "Listening",
    "Waiting for a technically usable speech interval.",
    "quiet"
  );
  setLane(
    faceLaneState,
    faceStatus,
    calibration.faceQuality === "unavailable" ? "Unavailable" : "Observing",
    calibration.faceQuality === "unavailable"
      ? "Facial signal is unavailable; the timed workflow will continue."
      : "Waiting for stable calibrated framing.",
    calibration.faceQuality === "unavailable" ? "warning" : "active"
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
  emitWorkflowEvent(
    "capture-conductor",
    "coordinator.decision.recorded",
    "ambient-capture",
    "Speech and facial analysis started in parallel.",
    { decision: "start-parallel-analysis" }
  );
  coordinatorDecision.textContent =
    "Speech and facial analysis started in parallel";
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
  systemCheckTimer = null;
  packetTimer = null;
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
  const outcomes = latestOutcomes ?? createModalityOutcomes(observation, allEvents);
  const measuredCount = outcomes.filter(
    (outcome) => outcome.status === "measured"
  ).length;
  resultSummary.replaceChildren(
    ...[
      "2 modality outcomes",
      `${measuredCount} measured`,
      `${2 - measuredCount} withheld`
    ].map((label) => {
      const span = document.createElement("span");
      span.textContent = label;
      return span;
    })
  );

  for (const outcome of outcomes) {
    const card = document.createElement("article");
    card.className = "aggregate-card";
    card.dataset.status = outcome.status;
    const header = document.createElement("div");
    const label = document.createElement("strong");
    label.textContent =
      outcome.modality === "speech"
        ? "Speech outcome"
        : "Facial outcome";
    const context = document.createElement("span");
    context.textContent = outcome.status;
    header.append(label, context);
    const value = document.createElement("p");
    value.className = "aggregate-value";
    const number = document.createElement("span");
    number.textContent =
      outcome.status === "measured"
        ? formatValue(outcome.currentValue, outcome.unit)
        : "Withheld";
    const unit = document.createElement("small");
    unit.textContent =
      outcome.status === "measured" ? outcome.unit : "quality protected";
    value.append(number, unit);
    const footer = document.createElement("div");
    footer.className = "aggregate-footer";
    footer.textContent =
      outcome.status === "measured"
        ? outcome.statement
        : `${outcome.statement} Reason: ${formatReason(outcome.reasonCode)}.`;
    card.append(header, value, footer);
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
    marker.textContent =
      claim.status === "withheld"
        ? "Traceable abstention"
        : "Grounded measurement";
    const statement = document.createElement("strong");
    statement.textContent = claim.statement;
    const trace = document.createElement("small");
    trace.textContent = "Open evidence chain";
    button.append(marker, statement, trace);
    button.addEventListener("click", () => openTrace(claim.claimId));
    evidenceClaims.append(button);
  }
}

function renderPendingEvidence(): void {
  evidenceLoading.hidden = false;
  evidenceLoading.textContent =
    "Clinical Synthesis is preparing the clinician encounter summary.";
  evidenceError.hidden = true;
  retryEvidenceButton.hidden = true;
  evidenceCard.hidden = false;
  evidenceHeadline.textContent = "Measured evidence assembled";
  evidenceSummary.textContent =
    "Speech and facial outcomes are available now while the concise encounter narrative is prepared.";
  boundaryStatement.textContent = EVIDENCE_BOUNDARY;
  evidenceStatusChip.textContent = "Preparing summary";
  reviewOutcome.textContent = "";
  acceptButton.disabled = true;
  rejectButton.disabled = true;
  copyReportButton.disabled = true;
  renderClaimButtons(
    (latestOutcomes ?? [])
      .filter((outcome) => outcome.status === "measured")
      .map((outcome) => ({
        claimId: outcome.outcomeId,
        modality: outcome.modality,
        status: outcome.status,
        statement: outcome.statement
      }))
  );
}

function renderEvidence(result: EvidenceApiResult): void {
  evidenceLoading.hidden = true;
  evidenceError.hidden = true;
  retryEvidenceButton.hidden = true;
  evidenceCard.hidden = false;
  evidenceHeadline.textContent = result.draft.headline;
  evidenceSummary.textContent = result.draft.summary;
  boundaryStatement.textContent = result.draft.boundaryStatement;
  evidenceStatusChip.textContent = `${result.draft.claims.length} ${
    result.draft.claims.length === 1 ? "metric" : "metrics"
  } grounded`;
  reviewOutcome.textContent = "";
  acceptButton.disabled = false;
  rejectButton.disabled = false;
  copyReportButton.disabled = false;
  renderClaimButtons(result.draft.claims);
}

async function copyClinicalReport(): Promise<void> {
  if (!latestEvidence) return;
  const report = [
    latestEvidence.draft.headline,
    latestEvidence.draft.summary,
    "",
    "Encounter metrics",
    ...latestEvidence.draft.claims.map(
      (claim) => `- ${claim.statement}`
    ),
    "",
    latestEvidence.draft.boundaryStatement
  ].join("\n");
  try {
    await navigator.clipboard.writeText(report);
    reviewOutcome.textContent = "EHR-ready report copied.";
  } catch {
    reviewOutcome.textContent =
      "Copy unavailable. Review the report on screen.";
  }
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
  const quality = Object.entries(outcome.qualityFacts)
    .map(([key, value]) => `${formatReason(key)}: ${String(value)}`)
    .join("\n");
  const windowDescription =
    outcome.status === "measured"
      ? measurements
          .map(
            (measurement) =>
              `Accepted ${measurement.windowStartMs}–${measurement.windowEndMs} ms`
          )
          .join("\n")
      : latestObservation.abstentions
          .filter(
            (abstention) => abstention.modality === outcome.modality
          )
          .map(
            (abstention) =>
              `Withheld ${abstention.windowStartMs}–${abstention.windowEndMs} ms · ${formatReason(abstention.reasonCode)}`
          )
          .join("\n");
  const measurementDescription =
    outcome.status === "measured"
      ? `${formatValue(outcome.currentValue, outcome.unit)} ${
          outcome.unit
        }\nConfidence ${aggregate?.confidence.toFixed(2) ?? "—"}`
      : `No value produced\n${formatReason(outcome.reasonCode)}`;
  const sections = [
    {
      title: "Agent decision",
      value: supportingEvents
        .filter((event) =>
          [
            "capture.quality.changed",
            "coordinator.decision.recorded",
            "modality.outcome.created"
          ].includes(event.type)
        )
        .map((event) => `#${event.sequence} ${event.summary}`)
        .join("\n")
    },
    { title: "Accepted or withheld window", value: windowDescription },
    {
      title:
        outcome.status === "measured"
          ? "Measurement"
          : "Abstention",
      value: measurementDescription
    },
    { title: "Quality conditions", value: quality },
    {
      title: "Grounded statement",
      value: outcome.statement
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
  traceDrawer.hidden = false;
}

async function synthesizeEvidence(): Promise<void> {
  if (!latestObservation || latestOutcomes?.length !== 2) {
    throw new Error(
      "One speech outcome and one facial outcome are required."
    );
  }
  evidenceLoading.hidden = false;
  evidenceLoading.textContent =
    "Preparing a grounded summary from the measured signals.";
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
    console.info("[Neurotrax operator] Clinical synthesis timing", body.timing);
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
            ? "Narrative synthesis is unavailable. The measured encounter metrics remain formatted for clinician review."
            : "No audiovisual metrics were included in the encounter report.",
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
      }; narrative synthesis was unavailable.`,
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
    } grounded · narrative unavailable`;
    evidenceError.hidden = false;
    evidenceError.textContent =
      "Clinical narrative unavailable. Grounded encounter evidence remains reviewable.";
    retryEvidenceButton.hidden = false;
    setLane(
      evidenceState,
      evidenceStatus,
      "Evidence ready",
      "Grounded modality outcomes remain available for review.",
      "warning"
    );
    evidenceReviewReady = true;
    resultsVisible = true;
    resultsPanel.hidden = false;
    updateState(
      "review",
      "Review the grounded encounter outcomes, then approve or dismiss."
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
          } outcome withheld because usable evidence was unavailable.`,
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
  emitWorkflowEvent(
    "capture-conductor",
    "coordinator.decision.recorded",
    "ambient-capture",
    "Two modality outcomes routed for grounding.",
    {
      outcomes: latestOutcomes.map((outcome) => ({
        modality: outcome.modality,
        status: outcome.status
      }))
    },
    latestOutcomes.flatMap((outcome) => outcome.supportRefs)
  );
  coordinatorDecision.textContent =
    "Two modality outcomes routed for grounding";
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
    latestOutcomes[0].status === "measured" ? "Measured" : "Withheld",
    latestOutcomes[0].statement,
    latestOutcomes[0].status === "measured" ? "complete" : "warning"
  );
  setLane(
    faceLaneState,
    faceStatus,
    latestOutcomes[1].status === "measured" ? "Measured" : "Withheld",
    latestOutcomes[1].statement,
    latestOutcomes[1].status === "measured" ? "complete" : "warning"
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
  updateState(
    "analyzing",
    "Reconciling signal windows and preparing the encounter summary."
  );
  await releaseMedia();
  cameraEmpty.hidden = false;
  cameraEmpty.querySelector("strong")!.textContent = "Assessment complete";
  cameraEmpty.querySelector("span:last-child")!.textContent =
    "Camera and microphone access has been released.";
  liveStrip.hidden = true;
  guidanceCard.hidden = true;
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
  emitWorkflowEvent(
    "clinician-review",
    approved ? "human-review.accepted" : "human-review.rejected",
    "human-review",
    approved
      ? "Clinician review approved the encounter summary."
      : "Clinician review dismissed the encounter summary.",
    { ...review },
    latestEvidence.grounding.groundedClaimIds
  );
  reviewOutcome.textContent = approved
    ? "Summary approved. Visit 1 established."
    : "Summary dismissed.";
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
    emitWorkflowEvent(
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
    baselinePanel.hidden = false;
    baselinePanel.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
  updateState(
    "reviewed",
    approved
      ? "Assessment and clinician review complete."
      : "Assessment complete; summary dismissed."
  );
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
  sessionClock.textContent = "00:00";
  speechDurationValue.textContent = "0.0 s";
  pitchCoverageValue.textContent = "0%";
  faceUsabilityValue.textContent = "0%";
  faceRecoveryValue.textContent = "Pending";
  micMeterFill.style.width = "0%";
  faceQualityFill.style.width = "0%";
  guidanceProgressFill.style.width = "0%";
  clearEventList();
  resultsPanel.hidden = true;
  baselinePanel.hidden = true;
  traceDrawer.hidden = true;
  for (const item of document.querySelectorAll(".milestone")) {
    item.classList.remove("is-complete", "is-limited");
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
    synthesisReady ? "Ready" : "Unavailable",
    synthesisReady
      ? "Waiting for a completed assessment."
      : "Encounter evidence will remain reviewable if narrative synthesis is unavailable.",
    synthesisReady ? "complete" : "warning"
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
      synthesisReady ? "Ready" : "Unavailable",
      synthesisReady
        ? "Waiting for a completed assessment."
        : "Clinical synthesis unavailable.",
      synthesisReady ? "complete" : "warning"
    );
    if (!synthesisReady) {
      captureHint.textContent =
        "System check is ready. Encounter evidence remains reviewable even if narrative synthesis is unavailable.";
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
      "Unavailable",
      "Facial analysis is unavailable.",
      "warning"
    );
    captureHint.textContent =
      "Facial analysis is unavailable. The timed assessment can still continue.";
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
traceCloseButton.addEventListener("click", () => {
  traceDrawer.hidden = true;
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
void checkSynthesisReadiness();
updateState("idle");
