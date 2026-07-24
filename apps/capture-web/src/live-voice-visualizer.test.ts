import type { VoiceSignalFrameV1 } from "@phenometric/ambient-core";
import { describe, expect, it, vi } from "vitest";
import {
  LiveVoiceHistory,
  LiveVoiceVisualizer,
  MAX_LIVE_VOICE_SAMPLES,
  levelGaugeFraction,
  pitchGaugeFraction,
  liveVoiceStateFor,
  rmsToDbfs,
  type AnimationScheduler,
  type LiveVoiceElements
} from "./live-voice-visualizer.js";

function frame(overrides: Partial<VoiceSignalFrameV1> = {}): VoiceSignalFrameV1 {
  return {
    schemaVersion: "phenometric.voice-signal-frame.v1",
    tMs: 0,
    acquiredAtMs: 0,
    captureEpoch: 1,
    sequence: 1,
    absoluteSampleIndex: 0,
    taskContext: "ambient-speech-turn",
    speechActive: false,
    periodic: false,
    trackSegmentId: "audio-1",
    rms: 0.001,
    f0Hz: null,
    f0Confidence: 0,
    estimatorAgreement: 0,
    syllabicNucleus: false,
    clippedSampleFraction: 0,
    dcOffset: 0,
    snrDb: 0,
    sampleRateHz: 48_000,
    blockGapMs: 10,
    lostBlockFraction: 0,
    browserProcessing: {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false
    },
    qualityReasons: [],
    processorRef: "browser-voice-dsp@1.0",
    ...overrides
  };
}

function elementsFixture(): {
  elements: LiveVoiceElements;
  stroke: ReturnType<typeof vi.fn>;
} {
  const stroke = vi.fn();
  const context = {
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    closePath: vi.fn(),
    stroke,
    fill: vi.fn(),
    arc: vi.fn(),
    fillText: vi.fn(),
    strokeStyle: "",
    fillStyle: "",
    lineWidth: 1,
    lineJoin: "miter",
    lineCap: "butt",
    font: "",
    textAlign: "center",
    textBaseline: "alphabetic"
  } as unknown as CanvasRenderingContext2D;
  const canvas = () => ({
    width: 320,
    height: 96,
    clientWidth: 320,
    clientHeight: 96,
    dataset: {} as DOMStringMap,
    getContext: vi.fn(() => context)
  } as unknown as HTMLCanvasElement);
  const text = () => ({
    dataset: {} as DOMStringMap,
    textContent: ""
  } as HTMLElement);
  return {
    stroke,
    elements: {
      levelGauge: canvas(),
      pitchGauge: canvas(),
      energyCanvas: canvas(),
      pitchCanvas: canvas(),
      clarityCanvas: canvas(),
      state: text(),
      level: text(),
      pitch: text(),
      snr: text(),
      confidence: text(),
      agreement: text(),
      quality: text()
    }
  };
}

describe("live voice visualization", () => {
  it("converts RMS to bounded dBFS and classifies activity", () => {
    expect(rmsToDbfs(1)).toBe(0);
    expect(rmsToDbfs(0.001)).toBeCloseTo(-60);
    expect(rmsToDbfs(0)).toBe(-60);
    expect(liveVoiceStateFor({ speechActive: false, periodic: false })).toBe("quiet");
    expect(liveVoiceStateFor({ speechActive: true, periodic: false })).toBe("speech-noise");
    expect(liveVoiceStateFor({ speechActive: true, periodic: true })).toBe("voiced");
  });

  it("retains only eight seconds and at most eight hundred derived samples", () => {
    const history = new LiveVoiceHistory();
    for (let index = 0; index < 1_000; index += 1) {
      history.add(frame({ tMs: index * 10, sequence: index + 1 }));
    }
    const samples = history.snapshot();
    expect(samples).toHaveLength(MAX_LIVE_VOICE_SAMPLES);
    expect(samples[0]?.tMs).toBe(2_000);
    expect(samples.at(-1)?.tMs).toBe(9_990);
  });

  it("creates pitch gaps for nonperiodic frames and clamps display pitch", () => {
    const history = new LiveVoiceHistory();
    history.add(frame({ periodic: false, f0Hz: 180 }));
    history.add(frame({ tMs: 10, periodic: true, f0Hz: 500 }));
    expect(history.snapshot().map((sample) => sample.pitchHz)).toEqual([
      null,
      400
    ]);
  });

  it("coalesces painting, updates values, and clears all state", () => {
    const fixture = elementsFixture();
    const callbacks: FrameRequestCallback[] = [];
    const scheduler: AnimationScheduler = {
      request: vi.fn((next) => {
        callbacks.push(next);
        return 12;
      }),
      cancel: vi.fn()
    };
    const visualizer = new LiveVoiceVisualizer(fixture.elements, scheduler);
    visualizer.push(frame({
      speechActive: true,
      periodic: true,
      rms: 0.1,
      f0Hz: 180,
      f0Confidence: 0.82,
      estimatorAgreement: 0.75,
      snrDb: 21.2
    }));
    visualizer.push(frame({ tMs: 10, speechActive: true }));

    expect(scheduler.request).toHaveBeenCalledTimes(1);
    expect(fixture.elements.state.textContent).toBe("Speech/noise");
    expect(fixture.elements.level.textContent).toBe("-60.0 dBFS");
    expect(fixture.elements.pitch.textContent).toBe("—");
    expect(fixture.elements.energyCanvas.dataset.sampleCount).toBe("2");
    callbacks[0]?.(0);
    expect(fixture.stroke).toHaveBeenCalled();

    visualizer.reset();
    expect(visualizer.sampleCount()).toBe(0);
    expect(fixture.elements.state.textContent).toBe("Waiting for signal");
    expect(fixture.elements.energyCanvas.dataset.sampleCount).toBe("0");
  });

  it("records clamped confidence on each history sample", () => {
    const history = new LiveVoiceHistory();
    const samples = history.add(frame({ f0Confidence: 0.73 }));
    expect(samples.at(-1)?.confidence).toBeCloseTo(0.73);
    expect(history.add(frame({ tMs: 10, f0Confidence: 5 })).at(-1)?.confidence).toBe(1);
    expect(history.add(frame({ tMs: 20, f0Confidence: -1 })).at(-1)?.confidence).toBe(0);
  });

  it("maps level and pitch onto 0..1 gauge fractions", () => {
    expect(levelGaugeFraction(0)).toBeCloseTo(1);
    expect(levelGaugeFraction(-60)).toBeCloseTo(0);
    expect(levelGaugeFraction(-30)).toBeCloseTo(0.5);
    expect(pitchGaugeFraction(null)).toBe(0);
    expect(pitchGaugeFraction(60)).toBeCloseTo(0);
    expect(pitchGaugeFraction(400)).toBeCloseTo(1);
  });
});
