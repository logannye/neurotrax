import "./styles.css";
import {
  createConductorSession,
  createEventFactory,
  type AudioFeatureFrame,
  type ConductorSession,
  type FaceLandmarkFrame
} from "@neurotrax/ambient-core";
import {
  compareTrajectory,
  DEFAULT_TRAJECTORY_POLICY
} from "@neurotrax/trajectory-core";
import {
  createEvidenceClaimFacts
} from "@neurotrax/evidence-core";
import type {
  EncounterObservation,
  EvidenceCardDraft,
  EvidenceClaimFact,
  EventEnvelope,
  GroundingResult,
  ReviewDecision,
  TrajectoryComparison,
  TrajectoryHistoryRecord,
  WorkflowStage,
  AmbientActorId,
  AmbientEventType
} from "@neurotrax/contracts";
import syntheticHistoryFixture from "@neurotrax/trajectory-core/fixtures/synthetic-history.json";
import { createVoiceActivityTracker } from "./audio-features.js";

type CaptureState =
  | "idle"
  | "requesting"
  | "capturing"
  | "analyzing"
  | "complete"
  | "error";

interface EvidenceApiResult {
  draft: EvidenceCardDraft;
  grounding: GroundingResult;
  model: string;
  promptVersion: string;
  responseId: string;
  attemptCount: number;
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
const captureModeBadge = element<HTMLSpanElement>("capture-mode-badge");
const faceOverlay = element<HTMLCanvasElement>("face-overlay");
const cameraEmpty = element<HTMLDivElement>("camera-empty");
const liveStrip = element<HTMLDivElement>("live-strip");
const sessionClock = element<HTMLDivElement>("session-clock");
const consentCheckbox = element<HTMLInputElement>("consent-checkbox");
const startButton = element<HTMLButtonElement>("start-button");
const stopButton = element<HTMLButtonElement>("stop-button");
const resetButton = element<HTMLButtonElement>("reset-button");
const captureHint = element<HTMLParagraphElement>("capture-hint");
const headerMode = element<HTMLSpanElement>("header-mode");
const privacyStatus = element<HTMLSpanElement>("privacy-status");
const readinessBar = element<HTMLElement>("readiness-bar");
const readinessDot = element<HTMLSpanElement>("readiness-dot");
const readinessTitle = element<HTMLElement>("readiness-title");
const readinessDetail = element<HTMLElement>("readiness-detail");
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
const trajectoryStatus = element<HTMLParagraphElement>("trajectory-status");
const trajectoryState = element<HTMLSpanElement>("trajectory-state");
const evidenceStatus = element<HTMLParagraphElement>("evidence-status");
const evidenceState = element<HTMLSpanElement>("evidence-state");
const eventCount = element<HTMLSpanElement>("event-count");
const eventList = element<HTMLOListElement>("event-list");
const resultsPanel = element<HTMLElement>("results-panel");
const resultSummary = element<HTMLDivElement>("result-summary");
const aggregateGrid = element<HTMLDivElement>("aggregate-grid");
const observationJson = element<HTMLElement>("observation-json");
const trajectorySummary = element<HTMLDivElement>("trajectory-summary");
const trajectoryGrid = element<HTMLDivElement>("trajectory-grid");
const exclusionList = element<HTMLDivElement>("exclusion-list");
const evidenceLoading = element<HTMLDivElement>("evidence-loading");
const evidenceError = element<HTMLDivElement>("evidence-error");
const retryEvidenceButton =
  element<HTMLButtonElement>("retry-evidence-button");
const evidenceCard = element<HTMLElement>("evidence-card");
const evidenceHeadline = element<HTMLElement>("evidence-headline");
const evidenceSummary = element<HTMLElement>("evidence-summary");
const evidenceClaims = element<HTMLDivElement>("evidence-claims");
const evidenceModelChip = element<HTMLElement>("evidence-model-chip");
const boundaryStatement = element<HTMLElement>("boundary-statement");
const acceptButton = element<HTMLButtonElement>("accept-button");
const rejectButton = element<HTMLButtonElement>("reject-button");
const reviewOutcome = element<HTMLParagraphElement>("review-outcome");
const traceDrawer = element<HTMLElement>("trace-drawer");
const traceCloseButton = element<HTMLButtonElement>("trace-close-button");
const traceTitle = element<HTMLElement>("trace-title");
const traceContent = element<HTMLDivElement>("trace-content");
const fixtureMode =
  new URLSearchParams(window.location.search).get("fixture") === "1";
const fastFixture =
  new URLSearchParams(window.location.search).get("fast") === "1";

let state: CaptureState = "idle";
let mediaStream: MediaStream | null = null;
let audioContext: AudioContext | null = null;
let audioSource: MediaStreamAudioSourceNode | null = null;
let analyser: AnalyserNode | null = null;
let sampleBuffer: Float32Array | null = null;
let sampleInterval: number | null = null;
let faceInterval: number | null = null;
let clockInterval: number | null = null;
let sessionStartedAtPerformance = 0;
let sessionStartedAtEpoch = 0;
let audioFrames: AudioFeatureFrame[] = [];
let receivedFaceFrameCount = 0;
let faceWorkerBusy = false;
let faceWorkerReady = false;
let modelReady = false;
let readinessChecked = false;
let conductorSession: ConductorSession | null = null;
let allEvents: EventEnvelope[] = [];
let latestObservation: EncounterObservation | null = null;
let latestComparison: TrajectoryComparison | null = null;
let latestClaimFacts: EvidenceClaimFact[] = [];
let latestEvidence: EvidenceApiResult | null = null;
let sessionHistory: TrajectoryHistoryRecord[] = structuredClone(
  syntheticHistoryFixture as unknown as TrajectoryHistoryRecord[]
);
const voiceTracker = createVoiceActivityTracker();

const faceWorker = new Worker(new URL("./face-worker.ts", import.meta.url), {
  type: "module"
});

function formatElapsed(elapsedMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes.toString().padStart(2, "0")}:${seconds
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
  if (state !== "idle") return;
  startButton.disabled =
    !consentCheckbox.checked || !modelReady || !faceWorkerReady;
}

function renderReadiness(): void {
  const ready = modelReady && faceWorkerReady;
  readinessBar.dataset.status = ready ? "ready" : readinessChecked ? "blocked" : "checking";
  readinessDot.dataset.status = ready ? "ready" : readinessChecked ? "blocked" : "checking";
  if (ready) {
    readinessTitle.textContent = "Demo systems ready";
    readinessDetail.textContent =
      fixtureMode
        ? "Disclosed fixture adapter ready · GPT-5.6 Evidence Agent credential detected"
        : "Facial worker loaded · GPT-5.6 Evidence Agent credential detected";
  } else if (readinessChecked) {
    readinessTitle.textContent = "Demo preflight blocked";
    const missing = [
      !faceWorkerReady ? "facial worker" : null,
      !modelReady ? "OPENAI_API_KEY" : null
    ].filter(Boolean);
    readinessDetail.textContent = `Missing: ${missing.join(
      " and "
    )}. The required-model demo cannot begin.`;
  }
  refreshStartAvailability();
}

function updateState(nextState: CaptureState, detail?: string): void {
  state = nextState;
  document.body.dataset.captureState = nextState;
  const labels: Record<CaptureState, string> = {
    idle: "Ready",
    requesting: "Requesting access",
    capturing: "Live",
    analyzing: "Analyzing",
    complete: "Evidence ready",
    error: "Needs attention"
  };
  headerMode.textContent = labels[nextState];

  if (nextState === "idle") {
    stopButton.disabled = true;
    resetButton.hidden = true;
    refreshStartAvailability();
  } else if (nextState === "capturing") {
    startButton.disabled = true;
    stopButton.disabled = false;
    resetButton.hidden = true;
  } else if (nextState === "complete" || nextState === "error") {
    startButton.disabled = true;
    stopButton.disabled = true;
    resetButton.hidden = false;
  } else {
    startButton.disabled = true;
    stopButton.disabled = true;
  }
  if (detail) captureHint.textContent = detail;
}

function clearEventList(): void {
  eventList.replaceChildren();
  eventCount.textContent = "0 events";
}

function applyEventToLanes(event: EventEnvelope): void {
  if (event.type === "capture.quality.changed") {
    const quality = event.payload.quality;
    const reason = String(event.payload.reasonCode ?? "");
    if (event.actor.id === "speech-acoustic") {
      setLane(
        speechState,
        speechStatus,
        quality === "measurable" ? "Measuring" : "Withheld",
        quality === "measurable"
          ? "Voiced signal is technically measurable."
          : `No value during this interval · ${formatReason(reason)}`,
        quality === "measurable" ? "active" : "warning"
      );
    }
    if (event.actor.id === "facial-expressivity") {
      setLane(
        faceLaneState,
        faceStatus,
        quality === "measurable" ? "Measuring" : "Withheld",
        quality === "measurable"
          ? "Face returned to a measurable window."
          : `Facial lane abstained · ${formatReason(reason)}`,
        quality === "measurable" ? "active" : "warning"
      );
    }
  }
  if (event.type === "trajectory.compatibility.assessed") {
    setLane(
      trajectoryState,
      trajectoryStatus,
      "Selecting",
      "Applying context, confound, and version compatibility rules.",
      "active"
    );
  }
  if (event.type === "trajectory.comparison.completed") {
    setLane(
      trajectoryState,
      trajectoryStatus,
      "Complete",
      "Compatible personal history selected by explicit rules.",
      "complete"
    );
  }
  if (event.type === "evidence-card.requested") {
    setLane(
      evidenceState,
      evidenceStatus,
      "Drafting",
      "GPT-5.6 is drafting from structured claim facts only.",
      "active"
    );
  }
  if (event.type === "human-review.pending") {
    setLane(
      evidenceState,
      evidenceStatus,
      "Grounded",
      "Every displayed claim passed deterministic grounding.",
      "complete"
    );
  }
}

function appendEvent(event: EventEnvelope): void {
  allEvents.push(event);
  applyEventToLanes(event);
  const placeholder = eventList.querySelector(".event-placeholder");
  placeholder?.remove();

  const item = document.createElement("li");
  item.className = "event-item";
  item.dataset.eventType = event.type;
  item.style.setProperty("--event-index", allEvents.length.toString());

  const marker = document.createElement("span");
  marker.className = "event-marker";
  marker.setAttribute("aria-hidden", "true");
  const copy = document.createElement("div");
  const meta = document.createElement("div");
  meta.className = "event-meta";
  const lane = document.createElement("span");
  lane.textContent = event.actor.lane.replaceAll("-", " ");
  const sequence = document.createElement("span");
  sequence.textContent = `#${event.sequence.toString().padStart(2, "0")}`;
  meta.append(lane, sequence);
  const summary = document.createElement("p");
  summary.textContent = event.summary;
  copy.append(meta, summary);
  item.append(marker, copy);
  eventList.append(item);
  eventCount.textContent = `${allEvents.length} ${
    allEvents.length === 1 ? "event" : "events"
  }`;
  item.scrollIntoView({ behavior: "smooth", block: "nearest" });
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

function updateLiveAudio(feature: AudioFeatureFrame): void {
  const meterPercent = Math.min(100, Math.round(feature.rms * 800));
  micMeterFill.style.width = `${meterPercent}%`;
  micMeter.setAttribute("aria-valuenow", meterPercent.toString());
  voiceState.textContent = feature.clipped
    ? "Clipping"
    : feature.voiced
      ? "Voice detected"
      : "Listening";
  voiceState.dataset.status = feature.clipped
    ? "warning"
    : feature.voiced
      ? "active"
      : "quiet";
  frameCount.textContent = audioFrames.length.toString();
  voicedCount.textContent = audioFrames
    .filter((frame) => frame.voiced)
    .length.toString();
  pitchValue.textContent =
    feature.pitchHz === null ? "—" : `${Math.round(feature.pitchHz)} Hz`;
}

function updateLiveFace(frame: FaceLandmarkFrame): void {
  receivedFaceFrameCount += 1;
  faceFrameCount.textContent = receivedFaceFrameCount.toString();
  faceYawValue.textContent = `${Math.round(frame.yawDegrees ?? 0)}°`;
  faceFpsValue.textContent = frame.observedFrameRate.toFixed(0);
  const quality = Math.round(frame.framingFraction * 100);
  faceQualityFill.style.width = `${quality}%`;
  const measurable =
    frame.faceVisible &&
    frame.framingFraction >= 0.6 &&
    Math.abs(frame.yawDegrees ?? 0) <= 30;
  faceState.textContent = measurable ? "Face measurable" : "Withheld";
  faceState.dataset.status = measurable ? "active" : "warning";
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
  context.strokeStyle = measurable
    ? "rgba(119, 213, 196, 0.9)"
    : "rgba(233, 164, 94, 0.95)";
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
    ? "rgba(119, 213, 196, 0.78)"
    : "rgba(233, 164, 94, 0.8)";
  for (const point of points) {
    context.beginPath();
    context.arc(point.x * width, point.y * height, 3.5, 0, Math.PI * 2);
    context.fill();
  }
}

function sampleAudioFrame(): void {
  if (
    state !== "capturing" ||
    !analyser ||
    !sampleBuffer ||
    !audioContext ||
    !conductorSession
  ) {
    return;
  }
  analyser.getFloatTimeDomainData(sampleBuffer);
  const derived = voiceTracker.derive(sampleBuffer, audioContext.sampleRate);
  const frame: AudioFeatureFrame = {
    tMs: Math.round(performance.now() - sessionStartedAtPerformance),
    ...derived
  };
  audioFrames.push(frame);
  conductorSession.ingestAudio(frame);
  updateLiveAudio(frame);
}

async function sampleFaceFrame(): Promise<void> {
  if (
    state !== "capturing" ||
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
        tMs: Math.round(performance.now() - sessionStartedAtPerformance)
      },
      [bitmap]
    );
  } catch (error) {
    faceWorkerBusy = false;
    setLane(
      faceLaneState,
      faceStatus,
      "Worker error",
      error instanceof Error ? error.message : "Could not sample camera frame.",
      "warning"
    );
  }
}

function updateClock(): void {
  if (state !== "capturing") return;
  sessionClock.textContent = formatElapsed(
    performance.now() - sessionStartedAtPerformance
  );
}

async function releaseMedia(): Promise<void> {
  if (sampleInterval !== null) {
    window.clearInterval(sampleInterval);
    sampleInterval = null;
  }
  if (faceInterval !== null) {
    window.clearInterval(faceInterval);
    faceInterval = null;
  }
  if (clockInterval !== null) {
    window.clearInterval(clockInterval);
    clockInterval = null;
  }
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

function renderObservation(observation: EncounterObservation): void {
  aggregateGrid.replaceChildren();
  resultSummary.replaceChildren(
    ...[
      `${observation.windows.length} curated windows`,
      `${observation.measurementCount} measurements`,
      `${observation.abstentions.length} abstentions`
    ].map((label) => {
      const span = document.createElement("span");
      span.textContent = label;
      return span;
    })
  );

  for (const aggregate of observation.aggregates) {
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
    } · confidence ${aggregate.confidence.toFixed(2)} · ${
      aggregate.algorithmVersion
    }`;
    card.append(header, value, footer);
    aggregateGrid.append(card);
  }
  if (observation.aggregates.length === 0) {
    const empty = document.createElement("article");
    empty.className = "result-empty";
    empty.textContent =
      "No measurement passed the current quality contracts. No value was fabricated.";
    aggregateGrid.append(empty);
  }
  observationJson.textContent = JSON.stringify(observation, null, 2);
  resultsPanel.hidden = false;
}

function createSparkline(
  values: number[],
  syntheticCount: number
): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 320 100");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "Synthetic personal history and current value");
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const spread = Math.max(0.0001, maximum - minimum);
  const points = values.map((value, index) => ({
    x: 20 + (index * 280) / Math.max(1, values.length - 1),
    y: 80 - ((value - minimum) / spread) * 60
  }));
  const polyline = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "polyline"
  );
  polyline.setAttribute(
    "points",
    points.map((point) => `${point.x},${point.y}`).join(" ")
  );
  polyline.setAttribute("fill", "none");
  polyline.setAttribute("stroke", "#7ea7a1");
  polyline.setAttribute("stroke-width", "2");
  svg.append(polyline);
  points.forEach((point, index) => {
    const circle = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "circle"
    );
    circle.setAttribute("cx", point.x.toString());
    circle.setAttribute("cy", point.y.toString());
    circle.setAttribute("r", index < syntheticCount ? "4" : "6");
    circle.setAttribute(
      "fill",
      index < syntheticCount ? "#adc7c2" : "#15756d"
    );
    svg.append(circle);
  });
  return svg;
}

function renderTrajectory(comparison: TrajectoryComparison): void {
  trajectoryGrid.replaceChildren();
  exclusionList.replaceChildren();
  trajectorySummary.textContent = `${comparison.includedEncounterIds.length} compatible encounters included · ${comparison.excludedEncounters.length} excluded by rule`;

  for (const biomarker of comparison.biomarkers.slice(0, 2)) {
    const card = document.createElement("article");
    card.className = "trajectory-card";
    const heading = document.createElement("div");
    const label = document.createElement("strong");
    label.textContent = biomarker.label;
    const direction = document.createElement("span");
    direction.className = `direction direction-${biomarker.direction}`;
    direction.textContent = biomarker.direction.replaceAll("-", " ");
    heading.append(label, direction);
    const chart = createSparkline(
      [
        ...biomarker.priorValues.map((prior) => prior.value),
        biomarker.currentValue
      ],
      biomarker.priorValues.length
    );
    const values = document.createElement("p");
    values.textContent = `Synthetic median ${formatValue(
      biomarker.priorMedian,
      biomarker.unit
    )} · Today ${formatValue(biomarker.currentValue, biomarker.unit)} ${
      biomarker.unit
    }`;
    const pointLabels = document.createElement("div");
    pointLabels.className = "trajectory-points";
    for (const prior of biomarker.priorValues) {
      const point = document.createElement("span");
      point.textContent = `${
        prior.synthetic ? "SYNTHETIC" : "ACCEPTED LIVE"
      } · ${new Date(prior.occurredAt).toLocaleDateString("en-US", {
        month: "short",
        year: "numeric"
      })} · ${formatValue(prior.value, biomarker.unit)}`;
      pointLabels.append(point);
    }
    const currentPoint = document.createElement("span");
    currentPoint.className = "trajectory-point-current";
    currentPoint.textContent = `CURRENT · ${formatValue(
      biomarker.currentValue,
      biomarker.unit
    )}`;
    pointLabels.append(currentPoint);
    card.append(heading, chart, values, pointLabels);
    trajectoryGrid.append(card);
  }

  for (const excluded of comparison.excludedEncounters) {
    const item = document.createElement("div");
    item.className = "exclusion-item";
    const label = document.createElement("strong");
    label.textContent = "SYNTHETIC encounter excluded";
    const detail = document.createElement("span");
    detail.textContent = excluded.reasonCodes.map(formatReason).join(" · ");
    item.append(label, detail);
    exclusionList.append(item);
  }
}

function renderEvidence(result: EvidenceApiResult): void {
  evidenceLoading.hidden = true;
  evidenceError.hidden = true;
  retryEvidenceButton.hidden = true;
  evidenceCard.hidden = false;
  evidenceHeadline.textContent = result.draft.headline;
  evidenceSummary.textContent = result.draft.summary;
  boundaryStatement.textContent = result.draft.boundaryStatement;
  evidenceModelChip.textContent = `${result.model.toUpperCase()} · GROUNDED`;
  evidenceClaims.replaceChildren();
  reviewOutcome.textContent = "";
  acceptButton.disabled = false;
  rejectButton.disabled = false;

  for (const claim of result.draft.claims) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "evidence-claim";
    button.dataset.claimId = claim.claimId;
    const marker = document.createElement("span");
    marker.textContent = "Grounded claim";
    const statement = document.createElement("strong");
    statement.textContent = claim.statement;
    const trace = document.createElement("small");
    trace.textContent = "Open claim → measurement → window → event trace";
    button.append(marker, statement, trace);
    button.addEventListener("click", () => openTrace(claim.claimId));
    evidenceClaims.append(button);
  }
}

function openTrace(claimId: string): void {
  const fact = latestClaimFacts.find((candidate) => candidate.claimId === claimId);
  if (!fact || !latestObservation || !latestComparison) return;
  const biomarker = latestComparison.biomarkers.find(
    (candidate) => candidate.code === fact.measurementCode
  );
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
    `Opened the evidence trace for ${fact.label}.`,
    { claimId },
    fact.supportRefs
  );
  const supportingEvents = allEvents.filter((event) =>
    fact.eventIds.includes(event.eventId) ||
    event.evidenceRefs.some((reference) => fact.supportRefs.includes(reference))
  );

  traceTitle.textContent = fact.label;
  traceContent.replaceChildren();
  const sections = [
    {
      title: "Claim",
      value: fact.statement
    },
    {
      title: "Current structured measurement",
      value: measurements
        .map(
          (measurement) =>
            `${formatValue(measurement.value, measurement.unit)} ${
              measurement.unit
            } · ${measurement.windowStartMs}–${measurement.windowEndMs} ms · confidence ${measurement.confidence.toFixed(2)}`
        )
        .join("\n")
    },
    {
      title: "Synthetic personal reference",
      value: biomarker
        ? `Median ${formatValue(
            biomarker.priorMedian,
            biomarker.unit
          )} · ${biomarker.priorValues.length} compatible encounters · ${biomarker.algorithmVersion}`
        : "No compatible reference."
    },
    {
      title: "Quality and aggregate confounds",
      value: aggregate
        ? `Context ${aggregate.contextKind}\nConfidence ${aggregate.confidence.toFixed(
            2
          )}\nSNR ${aggregate.confounds.snrDb.toFixed(
            1
          )} dB\nFace framing ${aggregate.confounds.faceFramingFraction.toFixed(
            2
          )}\nFrame rate ${aggregate.confounds.observedFrameRate.toFixed(
            1
          )} FPS\nIllumination ${aggregate.confounds.illuminationRelative.toFixed(
            2
          )}\nAbsolute yaw ${aggregate.confounds.yawDegrees.toFixed(1)}°`
        : "No aggregate quality envelope."
    },
    {
      title: "Versioned events",
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
  if (!latestObservation || !latestComparison || latestClaimFacts.length === 0) {
    evidenceLoading.textContent =
      "No compatible structured claims were available for synthesis.";
    return;
  }
  evidenceLoading.hidden = false;
  evidenceLoading.textContent =
    "GPT-5.6 is drafting from bounded structured facts…";
  evidenceError.hidden = true;
  retryEvidenceButton.hidden = true;
  evidenceCard.hidden = true;
  const requested = emitWorkflowEvent(
    "evidence-card",
    "evidence-card.requested",
    "evidence-card",
    "Requested a structured GPT-5.6 evidence-card draft.",
    {
      comparisonId: latestComparison.comparisonId,
      claimIds: latestClaimFacts.map((fact) => fact.claimId)
    },
    latestClaimFacts.flatMap((fact) => fact.supportRefs)
  );

  try {
    const response = await fetch("/api/evidence-card", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        containsPHI: false,
        visitId: latestObservation.visitId,
        comparisonId: latestComparison.comparisonId,
        syntheticHistory: true,
        includesAcceptedSessionHistory: latestComparison.biomarkers.some(
          (biomarker) =>
            biomarker.priorValues.some((prior) => !prior.synthetic)
        ),
        qualitySummary: latestObservation.qualitySummary,
        excludedEncounters: latestComparison.excludedEncounters,
        facts: latestClaimFacts
      })
    });
    const body = (await response.json()) as EvidenceApiResult | { error: string };
    if (!response.ok || "error" in body) {
      throw new Error("error" in body ? body.error : "Evidence synthesis failed.");
    }
    latestEvidence = body;
    const drafted = emitWorkflowEvent(
      "evidence-card",
      "evidence-card.drafted",
      "evidence-card",
      `Received a structured draft from ${body.model}.`,
      {
        model: body.model,
        responseId: body.responseId,
        promptVersion: body.promptVersion,
        attemptCount: body.attemptCount
      },
      latestClaimFacts.flatMap((fact) => fact.supportRefs)
    );
    for (const claimId of body.grounding.groundedClaimIds) {
      const fact = latestClaimFacts.find((candidate) => candidate.claimId === claimId);
      emitWorkflowEvent(
        "evidence-card",
        "evidence-claim.grounded",
        "evidence-card",
        `Grounded ${fact?.label ?? claimId} to structured evidence.`,
        { claimId },
        fact?.supportRefs ?? []
      );
    }
    emitWorkflowEvent(
      "clinician-review",
      "human-review.pending",
      "human-review",
      "Evidence Card is ready for human acceptance or rejection.",
      { cardResponseId: body.responseId },
      body.grounding.groundedClaimIds,
      drafted.eventId
    );
    renderEvidence(body);
    updateState(
      "complete",
      "Evidence Card ready. Inspect a claim, then accept or reject it."
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Evidence synthesis failed.";
    emitWorkflowEvent(
      "evidence-card",
      "evidence-claim.rejected",
      "evidence-card",
      "Evidence synthesis did not pass the required model and grounding contract.",
      { error: message, causedByEventId: requested.eventId }
    );
    evidenceLoading.hidden = true;
    evidenceError.hidden = false;
    evidenceError.textContent = message;
    retryEvidenceButton.hidden = false;
    setLane(
      evidenceState,
      evidenceStatus,
      "Blocked",
      "Required GPT-5.6 synthesis failed; no fallback was substituted.",
      "warning"
    );
    updateState("error", message);
  }
}

async function finishEncounter(): Promise<void> {
  if (!conductorSession) throw new Error("No conductor session exists.");
  const result = conductorSession.complete();
  latestObservation = result.observation;
  conductorSession = null;
  renderObservation(result.observation);
  setLane(
    conductorState,
    conductorStatus,
    "Complete",
    `Created ${result.observation.aggregates.length} versioned aggregates.`,
    "complete"
  );

  const trajectoryResult = compareTrajectory(
    result.observation,
    sessionHistory,
    DEFAULT_TRAJECTORY_POLICY,
    {
      baseTimeMs: sessionStartedAtEpoch,
      initialSequence: allEvents.length,
      occurredAtOffsetMs: Math.round(
        performance.now() - sessionStartedAtPerformance
      ),
      onEvent: appendEvent
    }
  );
  latestComparison = trajectoryResult.comparison;
  renderTrajectory(trajectoryResult.comparison);
  latestClaimFacts = createEvidenceClaimFacts(
    trajectoryResult.comparison,
    allEvents
  );
  await synthesizeEvidence();
}

function prepareConductor(
  captureMode: "live" | "fixture-playback",
  captureAdapter: { id: string; version: string }
): void {
  audioFrames = [];
  receivedFaceFrameCount = 0;
  voiceTracker.reset();
  sessionStartedAtPerformance = performance.now();
  sessionStartedAtEpoch = Date.now();
  allEvents = [];
  clearEventList();
  latestObservation = null;
  latestComparison = null;
  latestClaimFacts = [];
  latestEvidence = null;
  conductorSession = createConductorSession(
    {
      containsPHI: false,
      visitId: `visit-${crypto.randomUUID()}`,
      participantId: "developer-self-demo",
      captureMode,
      occurredAt: new Date(sessionStartedAtEpoch).toISOString(),
      captureAdapter
    },
    {
      baseTimeMs: sessionStartedAtEpoch,
      onEvent: appendEvent
    }
  );
}

async function startCapture(): Promise<void> {
  if (
    state !== "idle" ||
    !consentCheckbox.checked ||
    !modelReady ||
    !faceWorkerReady
  ) {
    return;
  }
  updateState(
    "requesting",
    "Approve camera and microphone access in Chrome."
  );
  try {
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

    prepareConductor("live", { id: "macbook-browser", version: "0.2.0" });

    sampleInterval = window.setInterval(sampleAudioFrame, 100);
    faceInterval = window.setInterval(() => void sampleFaceFrame(), 100);
    clockInterval = window.setInterval(updateClock, 250);
    cameraEmpty.hidden = true;
    liveStrip.hidden = false;
    privacyStatus.textContent =
      "Camera + microphone active · ephemeral analysis · no recording";
    setLane(
      conductorState,
      conductorStatus,
      "Observing",
      "Curating independently measurable audio and face windows.",
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
      "Waiting for stable framing; turn away briefly to demo abstention.",
      "active"
    );
    updateState(
      "capturing",
      "Speak naturally. Briefly turn away while continuing to speak, then face the camera again."
    );
  } catch (error) {
    await releaseMedia();
    const detail =
      error instanceof DOMException
        ? `${error.name}: ${error.message}`
        : error instanceof Error
          ? error.message
          : "Camera or microphone access could not be started.";
    privacyStatus.textContent = "Camera and microphone are off.";
    setLane(
      conductorState,
      conductorStatus,
      "Blocked",
      "Media permission or device access failed.",
      "warning"
    );
    updateState("error", detail);
  }
}

function startFixtureCapture(): void {
  if (
    state !== "idle" ||
    !consentCheckbox.checked ||
    !modelReady ||
    !faceWorkerReady
  ) {
    return;
  }
  prepareConductor("fixture-playback", {
    id: "macbook-browser",
    version: "0.2.0"
  });
  cameraEmpty.hidden = false;
  cameraEmpty.querySelector("strong")!.textContent =
    "Disclosed turn-away fixture";
  cameraEmpty.querySelector("span:last-child")!.textContent =
    "Synthetic derived frames · not camera or microphone input";
  liveStrip.hidden = false;
  liveStrip.lastChild!.textContent = " FIXTURE PLAYBACK · NOT LIVE";
  privacyStatus.textContent =
    "Disclosed fixture playback · no camera or microphone access";
  setLane(
    conductorState,
    conductorStatus,
    "Observing",
    "Replaying deterministic derived audio and face primitives.",
    "active"
  );
  setLane(
    speechState,
    speechStatus,
    "Listening",
    "Waiting for the synthetic voiced interval.",
    "quiet"
  );
  setLane(
    faceLaneState,
    faceStatus,
    "Observing",
    "A disclosed turn-away interval will exercise honest abstention.",
    "active"
  );
  updateState(
    "capturing",
    "Fixture playback is accelerated for deterministic browser testing."
  );

  let fixtureTimeMs = 0;
  sampleInterval = window.setInterval(() => {
    if (state !== "capturing" || !conductorSession) return;
    const audio: AudioFeatureFrame = {
      tMs: fixtureTimeMs,
      voiced: true,
      rms: 0.07,
      pitchHz: fixtureTimeMs % 400 < 200 ? 122 : 158,
      clipped: false,
      snrDb: 17
    };
    const turnedAway = fixtureTimeMs >= 1800 && fixtureTimeMs <= 2800;
    const face: FaceLandmarkFrame = {
      tMs: fixtureTimeMs,
      faceVisible: !turnedAway,
      framingFraction: turnedAway ? 0 : 0.85,
      illumination: 0.59,
      yawDegrees: turnedAway ? 48 : 5,
      eyeAspectRatio: fixtureTimeMs % 1300 === 0 ? 0.15 : 0.31,
      browRaise: 0.15 + (fixtureTimeMs % 500) / 5000,
      mouthOpen: 0.12,
      landmarkMotion: 0.04 + (fixtureTimeMs % 300) / 30000,
      observedFrameRate: 10
    };
    audioFrames.push(audio);
    conductorSession.ingestAudio(audio);
    conductorSession.ingestFace(face);
    updateLiveAudio(audio);
    updateLiveFace(face);
    sessionClock.textContent = formatElapsed(fixtureTimeMs);
    fixtureTimeMs += 100;
    if (fixtureTimeMs > 5200) {
      void stopAndAnalyze();
    }
  }, fastFixture ? 10 : 100);
}

async function stopAndAnalyze(): Promise<void> {
  if (state !== "capturing") return;
  updateState(
    "analyzing",
    "The Conductor is reconciling measurements and selecting compatible history."
  );
  stopButton.disabled = true;
  await releaseMedia();
  cameraEmpty.hidden = false;
  cameraEmpty.querySelector("strong")!.textContent = "Encounter complete";
  cameraEmpty.querySelector("span:last-child")!.textContent =
    fixtureMode
      ? "Synthetic derived-frame playback has ended."
      : "Raw camera and microphone access has been released.";
  liveStrip.hidden = true;
  privacyStatus.textContent =
    fixtureMode
      ? "Fixture complete · no camera or microphone used"
      : "Camera + microphone released · no raw media retained";
  try {
    await finishEncounter();
    resultsPanel.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : "Analysis could not complete.";
    updateState("error", detail);
  }
}

function historyRecordFromObservation(
  observation: EncounterObservation
): TrajectoryHistoryRecord {
  return {
    containsPHI: false,
    synthetic: false,
    source: "accepted-live-session",
    visitId: observation.visitId,
    participantId: observation.participantId,
    occurredAt: observation.occurredAt,
    captureMode: observation.captureMode,
    captureAdapter: observation.captureAdapter,
    reviewStatus: "accepted",
    aggregates: observation.aggregates
  };
}

function recordReview(decision: ReviewDecision["decision"]): void {
  if (!latestObservation || !latestEvidence) return;
  const accepted = decision === "accepted";
  if (
    accepted &&
    !sessionHistory.some(
      (record) => record.visitId === latestObservation!.visitId
    )
  ) {
    sessionHistory.push(historyRecordFromObservation(latestObservation));
  }
  const review: ReviewDecision = {
    decision,
    acceptedIntoSessionHistory: accepted,
    decidedAt: new Date().toISOString()
  };
  emitWorkflowEvent(
    "clinician-review",
    accepted ? "human-review.accepted" : "human-review.rejected",
    "human-review",
    accepted
      ? "Accepted this observation into in-memory session history."
      : "Rejected this observation; session history was not changed.",
    { ...review },
    latestEvidence.grounding.groundedClaimIds
  );
  reviewOutcome.textContent = accepted
    ? `Accepted for this browser session · ${sessionHistory.length - 4} live observation${
        sessionHistory.length - 4 === 1 ? "" : "s"
      } now in session history`
    : "Rejected · no live observation added to session history";
  acceptButton.disabled = true;
  rejectButton.disabled = true;
}

async function resetCapture(): Promise<void> {
  await releaseMedia();
  conductorSession = null;
  consentCheckbox.checked = false;
  cameraEmpty.hidden = false;
  cameraEmpty.querySelector("strong")!.textContent = fixtureMode
    ? "Disclosed fixture is idle"
    : "Camera preview is off";
  cameraEmpty.querySelector("span:last-child")!.textContent =
    fixtureMode
      ? "Consent to replay synthetic derived frames."
      : "Consent and begin when you are ready.";
  liveStrip.hidden = true;
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
  privacyStatus.textContent = fixtureMode
    ? "Fixture idle · camera and microphone are off."
    : "Camera and microphone are off.";
  setLane(
    conductorState,
    conductorStatus,
    "Waiting",
    "Waiting for a consented stream.",
    "quiet"
  );
  setLane(
    speechState,
    speechStatus,
    "Waiting",
    "No audio features received.",
    "quiet"
  );
  setLane(
    faceLaneState,
    faceStatus,
    "Ready",
    fixtureMode
      ? "Disclosed synthetic face primitives are ready."
      : "Local facial landmark worker is ready.",
    "complete"
  );
  setLane(
    trajectoryState,
    trajectoryStatus,
    "Waiting",
    "Waiting for a completed observation.",
    "quiet"
  );
  setLane(
    evidenceState,
    evidenceStatus,
    "Ready",
    "GPT-5.6 credential detected; waiting for structured facts.",
    "complete"
  );
  updateState(
    "idle",
    fixtureMode
      ? "Begin the disclosed deterministic fixture."
      : "Speak naturally, turn away briefly, return, then end the encounter."
  );
}

async function checkModelReadiness(): Promise<void> {
  try {
    const response = await fetch("/api/model-readiness", {
      headers: { Accept: "application/json" }
    });
    const result = (await response.json()) as {
      ready: boolean;
      model: string;
    };
    modelReady = response.ok && result.ready;
    setLane(
      evidenceState,
      evidenceStatus,
      modelReady ? "Ready" : "Blocked",
      modelReady
        ? `${result.model} server credential detected.`
        : "OPENAI_API_KEY is required; no fallback is configured.",
      modelReady ? "complete" : "warning"
    );
  } catch {
    modelReady = false;
    setLane(
      evidenceState,
      evidenceStatus,
      "Offline",
      "The local Evidence Agent endpoint is unavailable.",
      "warning"
    );
  } finally {
    readinessChecked = true;
    renderReadiness();
  }
}

faceWorker.addEventListener("message", (event: MessageEvent) => {
  const message = event.data as
    | { type: "ready" }
    | { type: "error"; message: string }
    | FaceWorkerFrameMessage;
  if (message.type === "ready") {
    faceWorkerReady = true;
    document
      .querySelector('[data-lane="facial-expressivity"]')
      ?.classList.remove("lane-muted");
    setLane(
      faceLaneState,
      faceStatus,
      "Ready",
      "Local landmark worker loaded; no frames retained.",
      "complete"
    );
    renderReadiness();
    return;
  }
  if (message.type === "error") {
    faceWorkerBusy = false;
    faceWorkerReady = false;
    readinessChecked = true;
    setLane(
      faceLaneState,
      faceStatus,
      "Blocked",
      message.message,
      "warning"
    );
    renderReadiness();
    return;
  }
  faceWorkerBusy = false;
  if (state !== "capturing" || !conductorSession) return;
  conductorSession.ingestFace(message.frame);
  updateLiveFace(message.frame);
  const measurable =
    message.frame.faceVisible &&
    message.frame.framingFraction >= 0.6 &&
    Math.abs(message.frame.yawDegrees ?? 0) <= 30;
  drawFaceOverlay(
    message.overlayPoints,
    message.boundingBox,
    measurable
  );
});

consentCheckbox.addEventListener("change", refreshStartAvailability);
startButton.addEventListener("click", () => {
  if (fixtureMode) startFixtureCapture();
  else void startCapture();
});
stopButton.addEventListener("click", () => void stopAndAnalyze());
resetButton.addEventListener("click", () => void resetCapture());
retryEvidenceButton.addEventListener("click", () => void synthesizeEvidence());
acceptButton.addEventListener("click", () => recordReview("accepted"));
rejectButton.addEventListener("click", () => recordReview("rejected"));
traceCloseButton.addEventListener("click", () => {
  traceDrawer.hidden = true;
});
window.addEventListener("beforeunload", () => {
  mediaStream?.getTracks().forEach((track) => track.stop());
  faceWorker.terminate();
});

if (fixtureMode) {
  captureModeBadge.textContent = "FIXTURE PLAYBACK · NOT LIVE";
  captureModeBadge.classList.add("badge-fixture");
  startButton.textContent = "Begin disclosed fixture";
  faceWorkerReady = true;
  cameraEmpty.querySelector("strong")!.textContent = "Disclosed fixture is idle";
  cameraEmpty.querySelector("span:last-child")!.textContent =
    "Consent to replay synthetic derived frames.";
  setLane(
    faceLaneState,
    faceStatus,
    "Fixture ready",
    "Synthetic derived face primitives; no camera frames.",
    "complete"
  );
} else {
  faceWorker.postMessage({ type: "initialize" });
}
void checkModelReadiness();
updateState("idle");
