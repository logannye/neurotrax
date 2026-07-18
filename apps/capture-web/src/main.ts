import "./styles.css";
import {
  createConductorSession,
  createEventFactory,
  type AudioFeatureFrame,
  type ConductorSession,
  type FaceLandmarkFrame
} from "@neurotrax/ambient-core";
import {
  createEncounterClaimFacts,
  EVIDENCE_BOUNDARY
} from "@neurotrax/evidence-core";
import type {
  AmbientActorId,
  AmbientEventType,
  CaptureCalibration,
  EncounterObservation,
  EvidenceCardClaim,
  EvidenceCardDraft,
  EvidenceClaimFact,
  EvidenceSynthesisTiming,
  EventEnvelope,
  GroundingResult,
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
  createCaptureCalibration,
  createFaceCalibration,
  facePreflightPassed,
  preflightFaceGuidance
} from "./capture-calibration.js";
import {
  createGuidedDemoController,
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
  | "summary-ready"
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
const consentCheckbox = element<HTMLInputElement>("consent-checkbox");
const startButton = element<HTMLButtonElement>("start-button");
const stopButton = element<HTMLButtonElement>("stop-button");
const resetButton = element<HTMLButtonElement>("reset-button");
const captureHint = element<HTMLParagraphElement>("capture-hint");
const headerMode = element<HTMLSpanElement>("header-mode");
const privacyStatus = element<HTMLSpanElement>("privacy-status");
const voiceState = element<HTMLElement>("voice-state");
const frameCount = element<HTMLElement>("frame-count");
const voicedCount = element<HTMLElement>("voiced-count");
const pitchValue = element<HTMLElement>("pitch-value");
const micMeter = element<HTMLDivElement>("mic-meter");
const micMeterFill = element<HTMLSpanElement>("mic-meter-fill");
const faceState = element<HTMLElement>("face-state");
const faceQualityFill = element<HTMLSpanElement>("face-quality-fill");
const faceFrameCount = element<HTMLElement>("face-frame-count");
const faceYawValue = element<HTMLElement>("face-yaw-value");
const faceFpsValue = element<HTMLElement>("face-fps-value");
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
const acceptButton = element<HTMLButtonElement>("accept-button");
const rejectButton = element<HTMLButtonElement>("reject-button");
const reviewOutcome = element<HTMLParagraphElement>("review-outcome");
const traceDrawer = element<HTMLElement>("trace-drawer");
const traceCloseButton = element<HTMLButtonElement>("trace-close-button");
const traceTitle = element<HTMLElement>("trace-title");
const traceContent = element<HTMLDivElement>("trace-content");

const query = new URLSearchParams(window.location.search);
const testCaptureMode =
  import.meta.env.DEV && query.get("testCapture") === "1";
const fastTestCapture = query.get("fast") === "1";

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
let sessionStartedAtPerformance = 0;
let sessionStartedAtEpoch = 0;
let quietRmsSamples: number[] = [];
let preflightFaceFrames: FaceLandmarkFrame[] = [];
let preflightPitchedFrames = 0;
let calibration: CaptureCalibration | null = null;
let audioFrames: AudioFeatureFrame[] = [];
let receivedFaceFrameCount = 0;
let latestAudioFeature: DerivedAudioFeature | null = null;
let latestFaceUsable = false;
let faceWorkerBusy = false;
let faceWorkerReady = false;
let synthesisReady = false;
let readinessChecked = false;
let conductorSession: ConductorSession | null = null;
let allEvents: EventEnvelope[] = [];
let latestObservation: EncounterObservation | null = null;
let latestClaimFacts: EvidenceClaimFact[] = [];
let latestEvidence: EvidenceApiResult | null = null;
let captureFinalizationScheduled = false;
let resultsVisible = false;
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
}

function refreshStartAvailability(): void {
  if (state === "idle") {
    startButton.textContent = "Run system check";
    startButton.disabled =
      !consentCheckbox.checked ||
      !faceWorkerReady ||
      !synthesisReady ||
      !readinessChecked;
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
    "summary-ready": "Summary ready",
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
    stopButton.textContent = latestObservation
      ? "View measured evidence"
      : "Preparing summary";
    stopButton.disabled = !latestObservation || resultsVisible;
  }
  if (nextState === "summary-ready") {
    stopButton.textContent = "View encounter summary";
    stopButton.disabled = false;
  }
  if (detail) captureHint.textContent = detail;
}

function clearEventList(): void {
  eventList.replaceChildren();
  eventCount.textContent = "Standby";
}

function milestone(name: string): HTMLElement | null {
  return document.querySelector(`[data-milestone="${name}"]`);
}

function updateMilestones(snapshot: GuidedDemoSnapshot): void {
  milestone("speech")?.classList.toggle(
    "is-complete",
    snapshot.speechWindowObserved && snapshot.initialFaceWindowObserved
  );
  milestone("withheld")?.classList.toggle(
    "is-complete",
    snapshot.withholdingObserved
  );
  milestone("recovered")?.classList.toggle(
    "is-complete",
    snapshot.recoveryObserved && snapshot.postRecoveryWindowObserved
  );
  stopButton.disabled = true;

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
      "Both signal lanes are complete. The camera and microphone will now be released.";
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

function applyEventToLanes(event: EventEnvelope): void {
  if (event.type === "capture.window.opened" && event.payload.modality === "speech") {
    updateMilestones(guidedDemo.noteSpeechWindow());
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
      setLane(
        faceLaneState,
        faceStatus,
        quality === "measurable" ? "Restored" : "Withheld",
        quality === "measurable"
          ? "Facial signal is within the calibrated quality range."
          : "Facial signal withheld until framing recovers.",
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
}

function appendEvent(event: EventEnvelope): void {
  allEvents.push(event);
  applyEventToLanes(event);
  eventList.querySelector(".event-placeholder")?.remove();

  const item = document.createElement("li");
  item.className = "event-item";
  const marker = document.createElement("span");
  marker.className = "event-marker";
  marker.setAttribute("aria-hidden", "true");
  const copy = document.createElement("div");
  const meta = document.createElement("span");
  meta.className = "event-meta";
  meta.textContent = event.actor.lane
    .replace("capture-conductor", "Encounter Coordinator")
    .replace("speech-acoustic", "Speech Analysis")
    .replace("facial-expressivity", "Facial Analysis")
    .replace("evidence-card", "Clinical Synthesis")
    .replace("clinician-review", "Clinician Review")
    .replace("capture-web", "Assessment");
  const summary = document.createElement("p");
  summary.textContent = event.summary;
  copy.append(meta, summary);
  item.append(marker, copy);
  eventList.append(item);
  while (eventList.children.length > 6) {
    eventList.firstElementChild?.remove();
  }
  eventCount.textContent = `${allEvents.length} live events`;
}

function workflowFactory() {
  if (!latestObservation) {
    throw new Error("A completed observation is required.");
  }
  return createEventFactory({
    visitId: latestObservation.visitId,
    participantId: latestObservation.participantId,
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
  return event;
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
  frameCount.textContent =
    state === "capturing" ? audioFrames.length.toString() : "—";
  voicedCount.textContent =
    state === "capturing"
      ? audioFrames.filter((frame) => frame.voiced).length.toString()
      : "—";
  pitchValue.textContent =
    feature.pitchHz === null ? "—" : `${Math.round(feature.pitchHz)} Hz`;
}

function updateLiveFace(
  frame: FaceLandmarkFrame,
  usable: boolean,
  guidance: string
): void {
  receivedFaceFrameCount += 1;
  faceFrameCount.textContent =
    state === "capturing" ? receivedFaceFrameCount.toString() : "—";
  faceYawValue.textContent = `${Math.round(frame.yawDegrees ?? 0)}°`;
  faceFpsValue.textContent = frame.observedFrameRate.toFixed(0);
  faceQualityFill.style.width = `${Math.round(
    frame.framingFraction * 100
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

function checkPreflightReady(): void {
  if (
    calibration ||
    preflightPitchedFrames < 10 ||
    !facePreflightPassed(preflightFaceFrames)
  ) {
    return;
  }
  calibration = createCaptureCalibration(
    voiceTracker.getCalibration(),
    createFaceCalibration(preflightFaceFrames)
  );
  window.clearInterval(sampleInterval ?? undefined);
  window.clearInterval(faceInterval ?? undefined);
  sampleInterval = null;
  faceInterval = null;
  guidanceStep.textContent = "System check complete";
  guidanceTitle.textContent = "Ready to begin";
  guidanceDetail.textContent =
    "Framing, room conditions, and speech signal are calibrated.";
  setLane(
    conductorState,
    conductorStatus,
    "Ready",
    "The calibrated assessment can begin.",
    "complete"
  );
  setLane(
    speechState,
    speechStatus,
    "Ready",
    "Room conditions and speech signal verified.",
    "complete"
  );
  setLane(
    faceLaneState,
    faceStatus,
    "Ready",
    "Facial position and illumination verified.",
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

  if (state === "calibrating-quiet") {
    const rms = calculateRms(sampleBuffer);
    quietRmsSamples.push(rms);
    micMeterFill.style.width = `${Math.min(100, Math.round(rms * 900))}%`;
    if (now - preflightStartedAt >= 1500 && quietRmsSamples.length >= 12) {
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
    if (derived.voiced && derived.pitchConfidence >= 0.55) {
      preflightPitchedFrames += 1;
    }
    guidanceDetail.textContent = `${Math.min(
      10,
      preflightPitchedFrames
    )} of 10 speech samples verified`;
    if (
      performance.now() - voiceCalibrationStartedAt >= 2000 &&
      preflightPitchedFrames >= 10
    ) {
      checkPreflightReady();
    }
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
  const calibrated = calibrateFaceFrame(
    { ...rawFrame, tMs },
    calibration.face
  );
  latestFaceUsable = calibrated.usable;
  conductorSession.ingestFace(calibrated.frame);
  updateLiveFace(
    calibrated.frame,
    calibrated.usable,
    calibrated.guidance
  );
  drawFaceOverlay(overlayPoints, boundingBox, calibrated.usable);
  updateMilestones(
    guidedDemo.ingest({
      tMs,
      speechActive: latestAudioFeature?.voiced ?? false,
      faceUsable: calibrated.usable
    })
  );
}

function updateClock(): void {
  if (state !== "capturing") return;
  sessionClock.textContent = formatElapsed(
    performance.now() - sessionStartedAtPerformance
  );
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
  if (
    state !== "idle" ||
    !consentCheckbox.checked ||
    !faceWorkerReady ||
    !synthesisReady
  ) {
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
        {
          baselineBoxWidth: 0.24,
          baselineBoxHeight: 0.4,
          baselineIllumination: 0.58
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
        "Framing, room conditions, and speech signal are calibrated.";
      setLane(
        speechState,
        speechStatus,
        "Ready",
        "Room conditions and speech signal verified.",
        "complete"
      );
      setLane(
        faceLaneState,
        faceStatus,
        "Ready",
        "Facial position and illumination verified.",
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
  latestAudioFeature = null;
  latestFaceUsable = false;
  voiceTracker.reset();
  guidedDemo.reset();
  sessionStartedAtPerformance = performance.now();
  sessionStartedAtEpoch = Date.now();
  allEvents = [];
  clearEventList();
  latestObservation = null;
  latestClaimFacts = [];
  latestEvidence = null;
  conductorSession = createConductorSession(
    {
      containsPHI: false,
      visitId: `visit-${crypto.randomUUID()}`,
      participantId: "developer-self-demo",
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
  const intervalMs = fastTestCapture ? 8 : 100;
  sampleInterval = window.setInterval(() => {
    if (state !== "capturing" || !conductorSession) return;
    const audio: AudioFeatureFrame & DerivedAudioFeature = {
      tMs: fixtureTimeMs,
      voiced: true,
      rms: 0.07,
      pitchHz: fixtureTimeMs % 400 < 200 ? 122 : 158,
      pitchConfidence: 0.92,
      clipped: false,
      snrDb: 24
    };
    latestAudioFeature = audio;
    audioFrames.push(audio);
    conductorSession.ingestAudio(audio);
    updateLiveAudio(audio);

    const turnedAway =
      fixtureTimeMs >= 1900 && fixtureTimeMs <= 2900;
    const face: FaceLandmarkFrame = {
      tMs: fixtureTimeMs,
      faceVisible: !turnedAway,
      framingFraction: turnedAway ? 0 : 0.9,
      illumination: 0.58,
      yawDegrees: turnedAway ? 48 : 5,
      eyeAspectRatio: fixtureTimeMs % 1300 === 0 ? 0.15 : 0.31,
      browRaise: 0.15 + (fixtureTimeMs % 500) / 5000,
      mouthOpen: 0.12,
      landmarkMotion: 0.04 + (fixtureTimeMs % 300) / 30000,
      observedFrameRate: 10,
      faceBoxWidth: turnedAway ? 0 : 0.24,
      faceBoxHeight: turnedAway ? 0 : 0.4,
      edgeMargin: turnedAway ? 0 : 0.1
    };
    const originalNow = sessionStartedAtPerformance;
    sessionStartedAtPerformance = performance.now() - fixtureTimeMs;
    processCapturedFace(face);
    sessionStartedAtPerformance = originalNow;
    sessionClock.textContent = formatElapsed(fixtureTimeMs);
    fixtureTimeMs += 100;
    if (fixtureTimeMs > 5600 && sampleInterval !== null) {
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
    "Observing",
    "Waiting for stable calibrated framing.",
    "active"
  );
  updateState(
    "capturing",
    "Follow the four guided steps to complete the assessment."
  );
  updateMilestones(guidedDemo.snapshot());
  clockInterval = window.setInterval(updateClock, 250);
  if (testCaptureMode) {
    startTestCapture();
  } else {
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
  const faceWindows = observation.qualitySummary.faceWindowCount;
  resultSummary.replaceChildren(
    ...[
      `${observation.qualitySummary.speechWindowCount} speech window`,
      `${faceWindows} facial windows`,
      `${Math.round(
        observation.qualitySummary.usableFaceFraction * 100
      )}% usable facial frames`
    ].map((label) => {
      const span = document.createElement("span");
      span.textContent = label;
      return span;
    })
  );

  const preferredCodes = new Set([
    "prototype.speech.pitch_variability",
    "prototype.speech.voiced_time_fraction",
    "prototype.face.expressivity",
    "prototype.face.blink_rate"
  ]);
  const preferred = observation.aggregates.filter((aggregate) =>
    preferredCodes.has(aggregate.code)
  );
  const displayed =
    preferred.length >= 4 ? preferred.slice(0, 4) : observation.aggregates;

  for (const aggregate of displayed) {
    const card = document.createElement("article");
    card.className = "aggregate-card";
    const header = document.createElement("div");
    const label = document.createElement("strong");
    label.textContent = aggregate.label;
    const context = document.createElement("span");
    context.textContent = aggregate.contextKind.replaceAll("-", " ");
    header.append(label, context);
    const value = document.createElement("p");
    value.className = "aggregate-value";
    const number = document.createElement("span");
    number.textContent = formatValue(aggregate.value, aggregate.unit);
    const unit = document.createElement("small");
    unit.textContent = aggregate.unit;
    value.append(number, unit);
    const footer = document.createElement("div");
    footer.className = "aggregate-footer";
    footer.textContent = `${aggregate.windowCount} ${
      aggregate.windowCount === 1 ? "window" : "windows"
    } · confidence ${aggregate.confidence.toFixed(2)}`;
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
    marker.textContent = "Grounded evidence";
    const statement = document.createElement("strong");
    statement.textContent = claim.statement;
    const trace = document.createElement("small");
    trace.textContent = "Open measurement trace";
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
    "Speech and facial findings are grounded to their measured windows while the encounter narrative is prepared.";
  boundaryStatement.textContent = EVIDENCE_BOUNDARY;
  evidenceStatusChip.textContent = "Preparing summary";
  reviewOutcome.textContent = "";
  acceptButton.disabled = true;
  rejectButton.disabled = true;
  renderClaimButtons(
    latestClaimFacts.map((fact) => ({
      claimId: fact.claimId,
      statement: fact.statement
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
  evidenceStatusChip.textContent = "Ready for review";
  reviewOutcome.textContent = "";
  acceptButton.disabled = false;
  rejectButton.disabled = false;
  renderClaimButtons(result.draft.claims);
}

function openTrace(claimId: string): void {
  const fact = latestClaimFacts.find(
    (candidate) => candidate.claimId === claimId
  );
  if (!fact || !latestObservation) return;
  const aggregate = latestObservation.aggregates.find(
    (candidate) => candidate.code === fact.measurementCode
  );
  const measurements = latestObservation.measurements.filter(
    (measurement) => measurement.code === fact.measurementCode
  );
  emitWorkflowEvent(
    "capture-web",
    "evidence.trace.opened",
    "evidence-card",
    `Opened the measurement trace for ${fact.label}.`,
    { claimId },
    fact.supportRefs
  );
  const supportingEvents = allEvents.filter(
    (event) =>
      fact.eventIds.includes(event.eventId) ||
      event.payload.claimId === claimId
  );

  traceTitle.textContent = fact.label;
  traceContent.replaceChildren();
  const quality =
    fact.modality === "speech"
      ? `Confidence ${aggregate?.confidence.toFixed(2) ?? "—"}\nSNR ${
          aggregate?.confounds.snrDb.toFixed(1) ?? "—"
        } dB\nPitch coverage ${Math.round(
          latestObservation.qualitySummary.pitchCoverage * 100
        )}%`
      : `Confidence ${aggregate?.confidence.toFixed(2) ?? "—"}\nUsable frames ${Math.round(
          latestObservation.qualitySummary.usableFaceFraction * 100
        )}%\nFacial recovery ${
          latestObservation.qualitySummary.faceRecoveryObserved
            ? "confirmed"
            : "not observed"
        }\nFrame rate ${
          aggregate?.confounds.observedFrameRate.toFixed(1) ?? "—"
        } FPS`;
  const sections = [
    { title: "Grounded statement", value: fact.statement },
    {
      title: "Current measurement",
      value: measurements
        .map(
          (measurement) =>
            `${formatValue(measurement.value, measurement.unit)} ${
              measurement.unit
            } · ${measurement.windowStartMs}–${
              measurement.windowEndMs
            } ms`
        )
        .join("\n")
    },
    { title: "Quality conditions", value: quality },
    {
      title: "Originating activity",
      value: supportingEvents
        .map((event) => `#${event.sequence} ${event.summary}`)
        .join("\n")
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
  if (!latestObservation || latestClaimFacts.length !== 2) {
    throw new Error(
      "One speech fact and one facial fact are required."
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
    { claimIds: latestClaimFacts.map((fact) => fact.claimId) },
    latestClaimFacts.flatMap((fact) => fact.supportRefs)
  );

  try {
    const response = await fetch("/api/evidence-card", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        containsPHI: false,
        visitId: latestObservation.visitId,
        qualitySummary: latestObservation.qualitySummary,
        facts: latestClaimFacts
      })
    });
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
      latestClaimFacts.flatMap((fact) => fact.supportRefs)
    );
    for (const claimId of body.grounding.groundedClaimIds) {
      const fact = latestClaimFacts.find(
        (candidate) => candidate.claimId === claimId
      );
      emitWorkflowEvent(
        "evidence-card",
        "evidence-claim.grounded",
        "evidence-card",
        `Grounded ${fact?.label ?? "encounter evidence"} to its measurement trace.`,
        { claimId },
        fact?.supportRefs ?? []
      );
    }
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
    milestone("summary")?.classList.add("is-complete");
    if (resultsVisible) {
      updateState(
        "review",
        "Review the two grounded statements, then approve or dismiss the summary."
      );
    } else {
      updateState(
        "summary-ready",
        "The encounter summary is ready for clinician review."
      );
    }
  } catch {
    emitWorkflowEvent(
      "evidence-card",
      "evidence-claim.rejected",
      "evidence-card",
      "Clinical synthesis could not produce a grounded summary.",
      { causedByEventId: requested.eventId }
    );
    evidenceLoading.hidden = true;
    evidenceCard.hidden = true;
    evidenceError.hidden = false;
    evidenceError.textContent = "Clinical synthesis unavailable.";
    retryEvidenceButton.hidden = false;
    setLane(
      evidenceState,
      evidenceStatus,
      "Unavailable",
      "The encounter summary could not be prepared.",
      "warning"
    );
    resultsVisible = true;
    resultsPanel.hidden = false;
    updateState("error", "Clinical synthesis unavailable. Retry when ready.");
    resultsPanel.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

async function finishEncounter(): Promise<void> {
  if (!conductorSession) throw new Error("No active assessment.");
  const result = conductorSession.complete();
  latestObservation = result.observation;
  conductorSession = null;
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
    "Complete",
    "Usable speech measurements were recorded.",
    "complete"
  );
  setLane(
    faceLaneState,
    faceStatus,
    "Complete",
    "Facial withholding and recovery were recorded.",
    "complete"
  );
  latestClaimFacts = createEncounterClaimFacts(result.observation, allEvents);
  renderPendingEvidence();
  updateState(
    "analyzing",
    "Measured evidence is ready while the encounter summary is prepared."
  );
  await synthesizeEvidence();
}

function revealResults(): void {
  if (!latestObservation) return;
  resultsVisible = true;
  resultsPanel.hidden = false;
  if (latestEvidence) {
    updateState(
      "review",
      "Review the two grounded statements, then approve or dismiss the summary."
    );
  } else {
    stopButton.disabled = true;
    stopButton.textContent = "Summary in progress";
  }
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
  if (!latestObservation || !latestEvidence) return;
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
    ? "Summary approved for this session."
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
  frameCount.textContent = "0";
  voicedCount.textContent = "0";
  pitchValue.textContent = "—";
  faceFrameCount.textContent = "0";
  faceYawValue.textContent = "—";
  faceFpsValue.textContent = "—";
  micMeterFill.style.width = "0%";
  faceQualityFill.style.width = "0%";
  clearEventList();
  resultsPanel.hidden = true;
  traceDrawer.hidden = true;
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
      : "Preparing local facial analysis.",
    faceWorkerReady ? "complete" : "quiet"
  );
  setLane(
    evidenceState,
    evidenceStatus,
    synthesisReady ? "Ready" : "Unavailable",
    synthesisReady
      ? "Waiting for a completed assessment."
      : "Clinical synthesis unavailable.",
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
        "Clinical synthesis is unavailable. Contact the demo operator.";
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
      "Facial analysis is unavailable. Restart the application.";
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
    checkPreflightReady();
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
stopButton.addEventListener("click", () => {
  if (state === "analyzing" || state === "summary-ready") {
    revealResults();
  }
});
resetButton.addEventListener("click", () => void resetCapture());
retryEvidenceButton.addEventListener("click", () => void synthesizeEvidence());
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
void checkSynthesisReadiness();
updateState("idle");
