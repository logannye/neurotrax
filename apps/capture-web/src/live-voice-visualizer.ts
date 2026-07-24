import type { VoiceSignalFrameV1 } from "@phenometric/ambient-core";

export const LIVE_VOICE_WINDOW_MS = 8_000;
export const MAX_LIVE_VOICE_SAMPLES = 800;
export const MIN_LIVE_PITCH_HZ = 60;
export const MAX_LIVE_PITCH_HZ = 400;

export type LiveVoiceState =
  | "waiting"
  | "quiet"
  | "speech-noise"
  | "voiced"
  | "unavailable";

export interface LiveVoiceSample {
  tMs: number;
  levelDbfs: number;
  pitchHz: number | null;
  confidence: number;
}

export interface LiveVoiceElements {
  levelGauge: HTMLCanvasElement;
  pitchGauge: HTMLCanvasElement;
  energyCanvas: HTMLCanvasElement;
  pitchCanvas: HTMLCanvasElement;
  clarityCanvas: HTMLCanvasElement;
  state: HTMLElement;
  level: HTMLElement;
  pitch: HTMLElement;
  snr: HTMLElement;
  confidence: HTMLElement;
  agreement: HTMLElement;
  quality: HTMLElement;
}

export interface AnimationScheduler {
  request(callback: FrameRequestCallback): number;
  cancel(handle: number): void;
}

const browserAnimationScheduler: AnimationScheduler = {
  request: (callback) => window.requestAnimationFrame(callback),
  cancel: (handle) => window.cancelAnimationFrame(handle)
};

export function rmsToDbfs(rms: number): number {
  if (!Number.isFinite(rms) || rms <= 0) return -60;
  return Math.max(-60, Math.min(0, 20 * Math.log10(rms)));
}

export function liveVoiceStateFor(
  frame: Pick<VoiceSignalFrameV1, "speechActive" | "periodic">
): Exclude<LiveVoiceState, "waiting" | "unavailable"> {
  if (frame.speechActive && frame.periodic) return "voiced";
  if (frame.speechActive) return "speech-noise";
  return "quiet";
}

/** -60..0 dBFS -> 0..1 (clamped). */
export function levelGaugeFraction(levelDbfs: number): number {
  if (!Number.isFinite(levelDbfs)) return 0;
  return Math.max(0, Math.min(1, (levelDbfs + 60) / 60));
}

/** MIN..MAX live pitch Hz -> 0..1; null -> 0. */
export function pitchGaugeFraction(pitchHz: number | null): number {
  if (pitchHz === null || !Number.isFinite(pitchHz)) return 0;
  const span = MAX_LIVE_PITCH_HZ - MIN_LIVE_PITCH_HZ;
  return Math.max(0, Math.min(1, (pitchHz - MIN_LIVE_PITCH_HZ) / span));
}

export class LiveVoiceHistory {
  private samples: LiveVoiceSample[] = [];

  add(frame: VoiceSignalFrameV1): readonly LiveVoiceSample[] {
    const previous = this.samples.at(-1);
    if (previous && frame.tMs < previous.tMs) this.samples = [];
    this.samples.push({
      tMs: frame.tMs,
      levelDbfs: rmsToDbfs(frame.rms),
      pitchHz:
        frame.periodic && frame.f0Hz !== null && Number.isFinite(frame.f0Hz)
          ? Math.max(
              MIN_LIVE_PITCH_HZ,
              Math.min(MAX_LIVE_PITCH_HZ, frame.f0Hz)
            )
          : null,
      confidence: Number.isFinite(frame.f0Confidence)
        ? Math.max(0, Math.min(1, frame.f0Confidence))
        : 0
    });
    const cutoff = frame.tMs - LIVE_VOICE_WINDOW_MS;
    while (
      this.samples.length > MAX_LIVE_VOICE_SAMPLES ||
      (this.samples[0]?.tMs ?? cutoff) < cutoff
    ) {
      this.samples.shift();
    }
    return this.snapshot();
  }

  snapshot(): readonly LiveVoiceSample[] {
    return this.samples;
  }

  clear(): void {
    this.samples = [];
  }
}

function finitePercent(value: number): string {
  const bounded = Number.isFinite(value)
    ? Math.max(0, Math.min(1, value))
    : 0;
  return `${Math.round(bounded * 100)}%`;
}

function stateLabel(state: LiveVoiceState): string {
  if (state === "voiced") return "Voiced speech";
  if (state === "speech-noise") return "Speech/noise";
  if (state === "quiet") return "Quiet/background";
  if (state === "unavailable") return "Microphone unavailable";
  return "Waiting for signal";
}

function prepareCanvas(
  canvas: HTMLCanvasElement
): { context: CanvasRenderingContext2D; width: number; height: number } | null {
  const context = canvas.getContext("2d");
  if (!context) return null;
  // The caps also prevent an intrinsic-size feedback loop if stylesheet
  // loading is delayed or blocked while the development bundle starts.
  const width = Math.max(
    1,
    Math.min(640, canvas.clientWidth || canvas.width || 320)
  );
  const height = Math.max(
    1,
    Math.min(160, canvas.clientHeight || canvas.height || 96)
  );
  const ratio = Math.max(
    1,
    typeof window === "undefined" ? 1 : window.devicePixelRatio || 1
  );
  const pixelWidth = Math.round(width * ratio);
  const pixelHeight = Math.round(height * ratio);
  if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
  if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);
  return { context, width, height };
}

function drawGrid(
  context: CanvasRenderingContext2D,
  width: number,
  height: number
): void {
  context.strokeStyle = "rgba(216, 223, 218, 0.72)";
  context.lineWidth = 1;
  context.beginPath();
  for (let index = 1; index < 4; index += 1) {
    const y = (height * index) / 4;
    context.moveTo(0, y);
    context.lineTo(width, y);
  }
  context.stroke();
}

function drawTrace(
  canvas: HTMLCanvasElement,
  samples: readonly LiveVoiceSample[],
  kind: "energy" | "pitch" | "clarity"
): void {
  const prepared = prepareCanvas(canvas);
  if (!prepared) return;
  const { context, width, height } = prepared;
  drawGrid(context, width, height);
  if (samples.length === 0) return;

  const latestMs = samples.at(-1)?.tMs ?? 0;
  const windowStartMs = Math.max(0, latestMs - LIVE_VOICE_WINDOW_MS);
  const xFor = (tMs: number) =>
    ((tMs - windowStartMs) / LIVE_VOICE_WINDOW_MS) * width;
  const yFor = (sample: LiveVoiceSample) => {
    if (kind === "energy") {
      return ((0 - sample.levelDbfs) / 60) * height;
    }
    if (kind === "clarity") {
      return (1 - sample.confidence) * height;
    }
    return (
      ((MAX_LIVE_PITCH_HZ - (sample.pitchHz ?? MIN_LIVE_PITCH_HZ)) /
        (MAX_LIVE_PITCH_HZ - MIN_LIVE_PITCH_HZ)) *
      height
    );
  };

  if (kind === "clarity") {
    const first = samples[0];
    const last = samples.at(-1);
    if (!first || !last) return;
    context.fillStyle = "rgba(127, 240, 207, .28)";
    context.beginPath();
    context.moveTo(xFor(first.tMs), height);
    for (const sample of samples) {
      const x = xFor(sample.tMs);
      const y = yFor(sample);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      context.lineTo(x, y);
    }
    context.lineTo(xFor(last.tMs), height);
    context.closePath();
    context.fill();
    return;
  }

  context.strokeStyle = kind === "energy" ? "#0b8d6b" : "#6b55c5";
  context.lineWidth = 2;
  context.lineJoin = "round";
  context.lineCap = "round";
  context.beginPath();
  let drawing = false;
  for (const sample of samples) {
    if (kind === "pitch" && sample.pitchHz === null) {
      drawing = false;
      continue;
    }
    const x = xFor(sample.tMs);
    const y = yFor(sample);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    if (drawing) context.lineTo(x, y);
    else context.moveTo(x, y);
    drawing = true;
  }
  context.stroke();
}

function drawGauge(
  canvas: HTMLCanvasElement,
  fraction: number,
  label: string
): void {
  const prepared = prepareCanvas(canvas);
  if (!prepared) return;
  const { context, width, height } = prepared;
  const clamped = Number.isFinite(fraction)
    ? Math.max(0, Math.min(1, fraction))
    : 0;
  const centerX = width / 2;
  const centerY = height * 0.58;
  const radius = Math.max(4, Math.min(width, height * 1.7) / 2 - 8);
  const startAngle = Math.PI * 0.75;
  const sweep = Math.PI * 1.5;

  context.lineCap = "round";
  context.lineWidth = Math.max(4, radius * 0.22);

  context.strokeStyle = "rgba(140, 128, 255, .22)";
  context.beginPath();
  context.arc(centerX, centerY, radius, startAngle, startAngle + sweep);
  context.stroke();

  context.strokeStyle = "#7ff0cf";
  context.beginPath();
  context.arc(centerX, centerY, radius, startAngle, startAngle + sweep * clamped);
  context.stroke();

  context.fillStyle = "#e9ecff";
  context.font = "700 .62rem ui-monospace, monospace";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(`${Math.round(clamped * 100)}%`, centerX, centerY);

  context.fillStyle = "#8b97c8";
  context.font = "600 .5rem ui-monospace, monospace";
  context.fillText(label, centerX, height - 6);
}

function clearCanvas(canvas: HTMLCanvasElement): void {
  const context = canvas.getContext("2d");
  if (!context) return;
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, canvas.width, canvas.height);
}

export class LiveVoiceVisualizer {
  private readonly elements: LiveVoiceElements;
  private readonly history = new LiveVoiceHistory();
  private readonly scheduler: AnimationScheduler;
  private animationHandle: number | null = null;

  constructor(
    elements: LiveVoiceElements,
    scheduler: AnimationScheduler = browserAnimationScheduler
  ) {
    this.elements = elements;
    this.scheduler = scheduler;
    this.reset();
  }

  push(frame: VoiceSignalFrameV1): void {
    const samples = this.history.add(frame);
    const state = liveVoiceStateFor(frame);
    this.setState(state);
    this.elements.level.textContent = `${rmsToDbfs(frame.rms).toFixed(1)} dBFS`;
    this.elements.pitch.textContent =
      frame.periodic && frame.f0Hz !== null
        ? `${frame.f0Hz.toFixed(1)} Hz`
        : "—";
    this.elements.snr.textContent = Number.isFinite(frame.snrDb)
      ? `${frame.snrDb.toFixed(1)} dB`
      : "—";
    this.elements.confidence.textContent = finitePercent(frame.f0Confidence);
    this.elements.agreement.textContent = finitePercent(
      frame.estimatorAgreement
    );
    this.elements.quality.textContent =
      frame.qualityReasons.length > 0
        ? `Signal checks: ${frame.qualityReasons.join(", ")}`
        : "Signal checks passing";
    this.elements.energyCanvas.dataset.sampleCount = String(samples.length);
    this.elements.pitchCanvas.dataset.sampleCount = String(samples.length);
    this.elements.clarityCanvas.dataset.sampleCount = String(samples.length);
    if (this.animationHandle === null) {
      this.animationHandle = this.scheduler.request(() => {
        this.animationHandle = null;
        this.render();
      });
    }
  }

  setUnavailable(): void {
    this.reset();
    this.setState("unavailable");
    this.elements.quality.textContent =
      "No microphone frames are available for live display.";
  }

  reset(): void {
    this.history.clear();
    if (this.animationHandle !== null) {
      this.scheduler.cancel(this.animationHandle);
      this.animationHandle = null;
    }
    clearCanvas(this.elements.energyCanvas);
    clearCanvas(this.elements.pitchCanvas);
    clearCanvas(this.elements.clarityCanvas);
    clearCanvas(this.elements.levelGauge);
    clearCanvas(this.elements.pitchGauge);
    this.elements.energyCanvas.dataset.sampleCount = "0";
    this.elements.pitchCanvas.dataset.sampleCount = "0";
    this.elements.clarityCanvas.dataset.sampleCount = "0";
    this.elements.level.textContent = "—";
    this.elements.pitch.textContent = "—";
    this.elements.snr.textContent = "—";
    this.elements.confidence.textContent = "—";
    this.elements.agreement.textContent = "—";
    this.elements.quality.textContent = "No live signal yet.";
    this.setState("waiting");
  }

  sampleCount(): number {
    return this.history.snapshot().length;
  }

  private render(): void {
    const samples = this.history.snapshot();
    drawTrace(this.elements.energyCanvas, samples, "energy");
    drawTrace(this.elements.pitchCanvas, samples, "pitch");
    drawTrace(this.elements.clarityCanvas, samples, "clarity");
    const latest = samples.at(-1);
    drawGauge(
      this.elements.levelGauge,
      latest ? levelGaugeFraction(latest.levelDbfs) : 0,
      "LVL"
    );
    drawGauge(
      this.elements.pitchGauge,
      latest ? pitchGaugeFraction(latest.pitchHz) : 0,
      "F0"
    );
  }

  private setState(state: LiveVoiceState): void {
    this.elements.state.dataset.state = state;
    this.elements.state.textContent = stateLabel(state);
  }
}
