import "./styles.css";
import {
  runConductor,
  type AudioFeatureFrame,
  type FrameStream
} from "@neurotrax/ambient-core";
import { deriveAudioFeature } from "./audio-features.js";

type CaptureState =
  | "idle"
  | "requesting"
  | "capturing"
  | "analyzing"
  | "complete"
  | "error";

function element<T extends HTMLElement>(id: string): T {
  const value = document.getElementById(id);
  if (!value) throw new Error(`Missing required element #${id}`);
  return value as T;
}

const cameraPreview = element<HTMLVideoElement>("camera-preview");
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
const voiceState = element<HTMLElement>("voice-state");
const frameCount = element<HTMLElement>("frame-count");
const voicedCount = element<HTMLElement>("voiced-count");
const pitchValue = element<HTMLElement>("pitch-value");
const micMeter = element<HTMLDivElement>("mic-meter");
const micMeterFill = element<HTMLSpanElement>("mic-meter-fill");
const conductorStatus = element<HTMLParagraphElement>("conductor-status");
const conductorState = element<HTMLSpanElement>("conductor-state");
const speechStatus = element<HTMLParagraphElement>("speech-status");
const speechState = element<HTMLSpanElement>("speech-state");
const eventCount = element<HTMLSpanElement>("event-count");
const eventList = element<HTMLOListElement>("event-list");
const resultsPanel = element<HTMLElement>("results-panel");
const resultSummary = element<HTMLDivElement>("result-summary");
const aggregateGrid = element<HTMLDivElement>("aggregate-grid");
const observationJson = element<HTMLElement>("observation-json");

let state: CaptureState = "idle";
let mediaStream: MediaStream | null = null;
let audioContext: AudioContext | null = null;
let audioSource: MediaStreamAudioSourceNode | null = null;
let analyser: AnalyserNode | null = null;
let sampleBuffer: Float32Array | null = null;
let sampleInterval: number | null = null;
let clockInterval: number | null = null;
let sessionStartedAtPerformance = 0;
let sessionStartedAtEpoch = 0;
let audioFrames: AudioFeatureFrame[] = [];
let noiseFloorRms = 0.006;

function formatElapsed(elapsedMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes.toString().padStart(2, "0")}:${seconds
    .toString()
    .padStart(2, "0")}`;
}

function updateState(nextState: CaptureState, detail?: string): void {
  state = nextState;
  document.body.dataset.captureState = nextState;

  const labels: Record<CaptureState, string> = {
    idle: "Ready",
    requesting: "Requesting access",
    capturing: "Live",
    analyzing: "Analyzing",
    complete: "Observation ready",
    error: "Needs attention"
  };
  headerMode.textContent = labels[nextState];

  if (nextState === "idle") {
    startButton.disabled = !consentCheckbox.checked;
    stopButton.disabled = true;
    resetButton.hidden = true;
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

function updateLiveTelemetry(feature: AudioFeatureFrame): void {
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
  speechStatus.textContent = feature.voiced
    ? `Receiving voiced frames · ${feature.snrDb.toFixed(1)} dB estimated SNR`
    : "Receiving audio features; waiting for voice.";
  speechState.textContent = feature.voiced ? "Measuring" : "Listening";
  speechState.dataset.status = feature.voiced ? "active" : "quiet";
}

function sampleAudioFrame(): void {
  if (
    state !== "capturing" ||
    !analyser ||
    !sampleBuffer ||
    !audioContext
  ) {
    return;
  }

  analyser.getFloatTimeDomainData(sampleBuffer);
  const derived = deriveAudioFeature(
    sampleBuffer,
    audioContext.sampleRate,
    noiseFloorRms
  );
  const tMs = Math.round(performance.now() - sessionStartedAtPerformance);
  const frame: AudioFeatureFrame = {
    tMs,
    voiced: derived.voiced,
    rms: derived.rms,
    pitchHz: derived.pitchHz,
    clipped: derived.clipped,
    snrDb: derived.snrDb
  };
  audioFrames.push(frame);

  if (!derived.voiced && derived.rms > 0) {
    noiseFloorRms = Math.max(
      0.0005,
      noiseFloorRms * 0.94 + derived.rms * 0.06
    );
  }

  updateLiveTelemetry(frame);
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
  if (context && context.state !== "closed") {
    await context.close();
  }
}

function renderEvents(
  events: ReturnType<typeof runConductor>["events"]
): void {
  eventList.replaceChildren();
  eventCount.textContent = `${events.length} ${
    events.length === 1 ? "event" : "events"
  }`;

  events.forEach((event, index) => {
    const item = document.createElement("li");
    item.className = "event-item";
    item.style.setProperty("--event-index", index.toString());

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
  });
}

function formatValue(value: number, unit: string): string {
  if (unit === "count") return Math.round(value).toString();
  if (Math.abs(value) >= 10) return value.toFixed(1);
  return value.toFixed(3);
}

function renderObservation(
  result: ReturnType<typeof runConductor>
): void {
  const { observation, events } = result;
  renderEvents(events);
  aggregateGrid.replaceChildren();

  const summaryItems = [
    `${observation.windows.length} candidate ${
      observation.windows.length === 1 ? "window" : "windows"
    }`,
    `${observation.measurementCount} measurements`,
    `${observation.abstentions.length} abstentions`
  ];
  resultSummary.replaceChildren(
    ...summaryItems.map((label) => {
      const span = document.createElement("span");
      span.textContent = label;
      return span;
    })
  );

  if (observation.aggregates.length === 0) {
    const empty = document.createElement("article");
    empty.className = "result-empty";
    const title = document.createElement("strong");
    title.textContent = "No comparable speech window captured";
    const detail = document.createElement("p");
    detail.textContent =
      "Try another encounter and speak continuously for at least two seconds. No value was fabricated.";
    empty.append(title, detail);
    aggregateGrid.append(empty);
  } else {
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
      } · ${aggregate.algorithmVersion}`;

      card.append(header, value, footer);
      aggregateGrid.append(card);
    }
  }

  observationJson.textContent = JSON.stringify(observation, null, 2);
  resultsPanel.hidden = false;

  conductorStatus.textContent = `Created an observation with ${observation.aggregates.length} aggregates.`;
  conductorState.textContent = "Complete";
  conductorState.dataset.status = "complete";

  const speechMeasurements = observation.measurements.filter((measurement) =>
    measurement.code.startsWith("prototype.speech.")
  ).length;
  speechStatus.textContent =
    speechMeasurements > 0
      ? `Recorded ${speechMeasurements} placeholder speech measurements.`
      : "No speech measurement passed the current window contract.";
  speechState.textContent = speechMeasurements > 0 ? "Measured" : "No value";
  speechState.dataset.status = speechMeasurements > 0 ? "complete" : "warning";
}

async function startCapture(): Promise<void> {
  if (state !== "idle" || !consentCheckbox.checked) return;

  updateState(
    "requesting",
    "Approve camera and microphone access in your browser."
  );
  conductorStatus.textContent = "Requesting a consented media stream.";
  conductorState.textContent = "Starting";
  conductorState.dataset.status = "active";

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

    audioFrames = [];
    noiseFloorRms = 0.006;
    sessionStartedAtPerformance = performance.now();
    sessionStartedAtEpoch = Date.now();
    sampleInterval = window.setInterval(sampleAudioFrame, 100);
    clockInterval = window.setInterval(updateClock, 250);

    cameraEmpty.hidden = true;
    liveStrip.hidden = false;
    privacyStatus.textContent =
      "Camera + microphone active · ephemeral analysis · no recording";
    conductorStatus.textContent = "Receiving live primitive frames.";
    conductorState.textContent = "Observing";
    conductorState.dataset.status = "active";
    updateState(
      "capturing",
      "Speak naturally for 8–12 seconds, then choose End & analyze."
    );
  } catch (error) {
    await releaseMedia();
    const detail =
      error instanceof DOMException
        ? `${error.name}: ${error.message}`
        : "Camera or microphone access could not be started.";
    conductorStatus.textContent = "Media permission or device access failed.";
    conductorState.textContent = "Blocked";
    conductorState.dataset.status = "warning";
    privacyStatus.textContent = "Camera and microphone are off.";
    updateState("error", detail);
  }
}

async function stopAndAnalyze(): Promise<void> {
  if (state !== "capturing") return;

  updateState("analyzing", "The Conductor is processing captured feature frames.");
  conductorStatus.textContent = "Detecting candidate measurement windows.";
  conductorState.textContent = "Analyzing";
  conductorState.dataset.status = "active";
  speechStatus.textContent = "Applying the speech quality and measurement contract.";
  speechState.textContent = "Analyzing";
  speechState.dataset.status = "active";

  const finalFrames = [...audioFrames];
  await releaseMedia();
  cameraEmpty.hidden = false;
  cameraEmpty.querySelector("strong")!.textContent = "Encounter complete";
  cameraEmpty.querySelector("span:last-child")!.textContent =
    "Raw camera and microphone access has been released.";
  liveStrip.hidden = true;
  privacyStatus.textContent =
    "Camera + microphone released · no raw media retained";

  const stream: FrameStream = {
    containsPHI: false,
    visitId: `visit-${crypto.randomUUID()}`,
    participantId: "developer-self-demo",
    captureMode: "live",
    audio: finalFrames,
    face: []
  };

  try {
    const result = runConductor(stream, { baseTimeMs: sessionStartedAtEpoch });
    renderObservation(result);
    audioFrames = [];
    updateState(
      "complete",
      "Observation ready. Inspect the event trace and placeholder measurements."
    );
    resultsPanel.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : "The encounter could not be analyzed.";
    conductorStatus.textContent = "The Conductor could not create an observation.";
    conductorState.textContent = "Failed";
    conductorState.dataset.status = "warning";
    updateState("error", detail);
  }
}

async function resetCapture(): Promise<void> {
  await releaseMedia();
  audioFrames = [];
  consentCheckbox.checked = false;
  cameraEmpty.hidden = false;
  cameraEmpty.querySelector("strong")!.textContent = "Camera preview is off";
  cameraEmpty.querySelector("span:last-child")!.textContent =
    "Consent and begin when you are ready.";
  liveStrip.hidden = true;
  sessionClock.textContent = "00:00";
  frameCount.textContent = "0";
  voicedCount.textContent = "0";
  pitchValue.textContent = "—";
  voiceState.textContent = "Waiting";
  voiceState.removeAttribute("data-status");
  micMeterFill.style.width = "0%";
  micMeter.setAttribute("aria-valuenow", "0");
  conductorStatus.textContent = "Waiting for a consented stream.";
  conductorState.textContent = "Waiting";
  conductorState.removeAttribute("data-status");
  speechStatus.textContent = "No audio features received.";
  speechState.textContent = "Waiting";
  speechState.removeAttribute("data-status");
  eventCount.textContent = "0 events";
  eventList.replaceChildren();
  const placeholder = document.createElement("li");
  placeholder.className = "event-placeholder";
  placeholder.textContent =
    "The Conductor will publish its versioned events here after you end the encounter.";
  eventList.append(placeholder);
  aggregateGrid.replaceChildren();
  resultsPanel.hidden = true;
  privacyStatus.textContent = "Camera and microphone are off.";
  updateState(
    "idle",
    "Once live, speak naturally for 8–12 seconds before ending the encounter."
  );
}

consentCheckbox.addEventListener("change", () => {
  if (state === "idle") startButton.disabled = !consentCheckbox.checked;
});
startButton.addEventListener("click", () => void startCapture());
stopButton.addEventListener("click", () => void stopAndAnalyze());
resetButton.addEventListener("click", () => void resetCapture());
window.addEventListener("beforeunload", () => {
  mediaStream?.getTracks().forEach((track) => track.stop());
});

updateState("idle");
