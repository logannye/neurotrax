/// <reference lib="webworker" />

import type {
  AudioStreamDiagnostics,
  VoiceTaskContext
} from "@phenometric/contracts";
import {
  evaluateVoiceQuality,
  type VoiceSignalFrameV1
} from "@phenometric/ambient-core";
import {
  BoundedPcmRingBuffer,
  analyzeVoiceWindow
} from "./voice-dsp.js";
import {
  VOICE_DSP_PROCESSOR_REF,
  VOICE_SIGNAL_FRAME_VERSION,
  VOICE_WORKER_MESSAGE_VERSION,
  VOICE_WORKLET_MESSAGE_VERSION,
  WAVLM_LAYERS,
  WAVLM_MODEL_ID,
  WAVLM_REVISION,
  WAVLM_WEIGHT_SHA256,
  audioPipelineProvenance,
  type VoiceWorkerRequest,
  type VoiceWorkerResponse,
  type VoiceWorkletPcmBlock
} from "./voice-worker-protocol.js";

const worker = self as DedicatedWorkerGlobalScope;

let captureEpoch = 0;
let port: MessagePort | null = null;
let ring: BoundedPcmRingBuffer | null = null;
let sampleRateHz = 48_000;
let taskContext: VoiceTaskContext = "quiet-calibration";
let sessionOriginPerformanceMs = 0;
let audioContextOriginSeconds = 0;
let browserProcessing = {
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false
};
let noiseFloorRms = 0.002;
let lastBlockSequence = 0;
let lastAbsoluteSampleIndex = 0;
let lastBlockAcquiredAtMs: number | null = null;
let nextAnalysisSampleIndex = 0;
let processedFrameCount = 0;
let receivedBlockCount = 0;
let lostBlockCount = 0;
let maximumBlockGapMs = 0;
let currentBlockGapMs = 0;
let timestampRegressionCount = 0;
let priorBands: readonly number[] | null = null;
let lastNucleusAtMs = Number.NEGATIVE_INFINITY;
let priorNucleusScore = 0;
const latencyValues: number[] = [];
const representationRequests = new Set<AbortController>();
const recentBlockContinuity: Array<{
  atMs: number;
  received: number;
  lost: number;
}> = [];

function post(message: VoiceWorkerResponse): void {
  worker.postMessage(message);
}

function diagnostics(): AudioStreamDiagnostics {
  const sortedLatency = [...latencyValues].sort(
    (left, right) => left - right
  );
  return {
    receivedBlockCount,
    processedFrameCount,
    lostBlockCount,
    lostBlockFraction:
      lostBlockCount /
      Math.max(1, receivedBlockCount + lostBlockCount),
    maximumBlockGapMs,
    p95FeatureLatencyMs:
      sortedLatency.length === 0
        ? 0
        : sortedLatency[
            Math.min(
              sortedLatency.length - 1,
              Math.floor(sortedLatency.length * 0.95)
            )
          ],
    timestampRegressionCount,
    ringBufferCapacitySamples: ring?.capacity ?? 0
  };
}

function reset(epoch: number): void {
  captureEpoch = epoch;
  ring?.clear();
  lastBlockSequence = 0;
  lastAbsoluteSampleIndex = 0;
  lastBlockAcquiredAtMs = null;
  nextAnalysisSampleIndex = 0;
  processedFrameCount = 0;
  receivedBlockCount = 0;
  lostBlockCount = 0;
  maximumBlockGapMs = 0;
  currentBlockGapMs = 0;
  timestampRegressionCount = 0;
  priorBands = null;
  lastNucleusAtMs = Number.NEGATIVE_INFINITY;
  priorNucleusScore = 0;
  latencyValues.length = 0;
  recentBlockContinuity.length = 0;
}

function acquiredAtMs(block: VoiceWorkletPcmBlock): number {
  return (
    sessionOriginPerformanceMs +
    (block.acquisitionAudioTimeSeconds -
      audioContextOriginSeconds) *
      1000
  );
}

function analyzeAvailable(block: VoiceWorkletPcmBlock): void {
  if (!ring) return;
  const windowSamples = Math.round(sampleRateHz * 0.04);
  const hopSamples = Math.round(sampleRateHz * 0.01);
  const absoluteEnd =
    block.absoluteSampleIndex +
    new Float32Array(block.buffer).length;
  if (nextAnalysisSampleIndex === 0) {
    nextAnalysisSampleIndex =
      block.absoluteSampleIndex + windowSamples;
  }
  while (
    absoluteEnd >= nextAnalysisSampleIndex &&
    ring.availableSamples() >= windowSamples
  ) {
    const trailingSampleCount = Math.max(
      0,
      absoluteEnd - nextAnalysisSampleIndex
    );
    const samples = ring.endingBeforeLatest(
      windowSamples,
      trailingSampleCount
    );
    if (!samples) break;
    const startedAt = performance.now();
    const analysis = analyzeVoiceWindow(
      samples,
      sampleRateHz,
      priorBands
    );
    const tMs =
      ((nextAnalysisSampleIndex - windowSamples) / sampleRateHz) *
      1000;
    const snrDb =
      analysis.rms <= 0
        ? 0
        : Math.max(
            0,
            20 *
              Math.log10(
                analysis.rms / Math.max(0.0001, noiseFloorRms)
              )
          );
    const continuityFloorMs = acquiredAtMs(block) - 2_000;
    while (
      recentBlockContinuity.length > 0 &&
      recentBlockContinuity[0].atMs < continuityFloorMs
    ) {
      recentBlockContinuity.shift();
    }
    const recentReceived = recentBlockContinuity.reduce(
      (sum, item) => sum + item.received,
      0
    );
    const recentLost = recentBlockContinuity.reduce(
      (sum, item) => sum + item.lost,
      0
    );
    const lostBlockFraction =
      recentLost / Math.max(1, recentReceived + recentLost);
    const blockGapMs = currentBlockGapMs;
    const frameAcquiredAtMs =
      acquiredAtMs(block) -
      (trailingSampleCount / sampleRateHz) * 1_000;
    const periodic =
      analysis.f0Hz !== null &&
      analysis.f0Confidence >= 0.55 &&
      analysis.estimatorAgreement >= 0.7;
    const voiced =
      analysis.rms >= Math.max(0.003, noiseFloorRms * 2.8) &&
      (periodic ||
        (analysis.spectralFlux > 0.02 &&
          analysis.rms >= noiseFloorRms * 4));
    const nucleusScore =
      analysis.rms * (1 + Math.min(2, analysis.spectralFlux * 20));
    const syllabicNucleus =
      voiced &&
      tMs - lastNucleusAtMs >= 100 &&
      nucleusScore > Math.max(0.012, priorNucleusScore * 1.15);
    if (syllabicNucleus) lastNucleusAtMs = tMs;
    priorNucleusScore =
      0.7 * priorNucleusScore + 0.3 * nucleusScore;
    priorBands = analysis.bandEnergies;
    processedFrameCount += 1;
    const frame: VoiceSignalFrameV1 = {
      schemaVersion: VOICE_SIGNAL_FRAME_VERSION,
      tMs,
      acquiredAtMs: frameAcquiredAtMs,
      captureEpoch,
      sequence: processedFrameCount,
      absoluteSampleIndex:
        nextAnalysisSampleIndex - windowSamples,
      taskContext,
      voiced,
      voicingProbability: Math.min(
        1,
        0.5 * analysis.periodicity +
          0.5 * Math.min(1, analysis.rms / 0.03)
      ),
      rms: analysis.rms,
      intensityDbfs: analysis.intensityDbfs,
      f0Hz: analysis.f0Hz,
      f0Confidence: analysis.f0Confidence,
      estimatorAgreement: analysis.estimatorAgreement,
      periodicity: analysis.periodicity,
      cppsDb: analysis.cppsDb,
      hnrDb: analysis.hnrDb,
      jitterLocal: periodic ? analysis.jitterLocal : null,
      shimmerLocal: periodic ? analysis.shimmerLocal : null,
      formantF1Hz: analysis.formantF1Hz,
      formantF2Hz: analysis.formantF2Hz,
      spectralFlux: analysis.spectralFlux,
      syllabicNucleus,
      clippedSampleFraction: analysis.clippedSampleFraction,
      dcOffset: analysis.dcOffset,
      snrDb,
      sampleRateHz,
      blockGapMs,
      lostBlockFraction,
      browserProcessing: { ...browserProcessing },
      qualityReasons: [],
      processorRef: VOICE_DSP_PROCESSOR_REF
    };
    frame.qualityReasons =
      evaluateVoiceQuality(frame).reasonCodes;
    const processingLatencyMs = Math.max(
      performance.now() - startedAt,
      performance.now() - frameAcquiredAtMs
    );
    latencyValues.push(processingLatencyMs);
    if (latencyValues.length > 500) latencyValues.shift();
    post({
      schemaVersion: VOICE_WORKER_MESSAGE_VERSION,
      type: "signal-frame",
      captureEpoch,
      frame,
      processingLatencyMs
    });
    if (processedFrameCount % 100 === 0) {
      post({
        schemaVersion: VOICE_WORKER_MESSAGE_VERSION,
        type: "diagnostics",
        captureEpoch,
        diagnostics: diagnostics()
      });
    }
    nextAnalysisSampleIndex += hopSamples;
  }
}

function downsampleTo16k(
  samples: Float32Array,
  sourceRate: number
): Float32Array {
  if (sourceRate === 16_000) return samples.slice();
  const ratio = sourceRate / 16_000;
  const result = new Float32Array(
    Math.max(1, Math.floor(samples.length / ratio))
  );
  for (let index = 0; index < result.length; index += 1) {
    const start = Math.floor(index * ratio);
    const end = Math.min(
      samples.length,
      Math.max(start + 1, Math.floor((index + 1) * ratio))
    );
    let sum = 0;
    for (let source = start; source < end; source += 1) {
      sum += samples[source];
    }
    result[index] = sum / Math.max(1, end - start);
  }
  return result;
}

function float32Base64(samples: Float32Array): string {
  const bytes = new Uint8Array(samples.buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(
      ...bytes.subarray(offset, offset + chunkSize)
    );
  }
  return btoa(binary);
}

async function requestRepresentation(
  message: Extract<
    VoiceWorkerRequest,
    { type: "request-representation" }
  >
): Promise<void> {
  const requestEpoch = message.captureEpoch;
  const abstain = (reasonCode: string): void => {
    if (captureEpoch !== requestEpoch) return;
    post({
      schemaVersion: VOICE_WORKER_MESSAGE_VERSION,
      type: "representation-status",
      captureEpoch: requestEpoch,
      requestRef: message.requestRef,
      windowRef: message.windowRef,
      status: "abstained",
      reasonCode
    });
  };
  let native: Float32Array | null = null;
  let pcm: Float32Array | null = null;
  let controller: AbortController | null = null;
  try {
    const endpoint = new URL(message.endpoint);
    if (
      endpoint.protocol !== "http:" ||
      !["127.0.0.1", "localhost"].includes(endpoint.hostname)
    ) {
      abstain("representation-endpoint-not-loopback");
      return;
    }
    const durationSamples = Math.round(
      (message.durationMs / 1000) * sampleRateHz
    );
    native = ring?.latest(durationSamples) ?? null;
    if (!native) {
      abstain("representation-audio-unavailable");
      return;
    }
    pcm = downsampleTo16k(native, sampleRateHz);
    if (pcm.length < 24_000 || pcm.length > 480_000) {
      abstain("representation-duration-out-of-range");
      return;
    }
    controller = new AbortController();
    representationRequests.add(controller);
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        schemaVersion:
          "phenometric.voice-representation-request.v1",
        requestRef: message.requestRef,
        captureEpoch: requestEpoch,
        windowRef: message.windowRef,
        taskContext: message.taskContext,
        sampleRateHz: 16_000,
        channelCount: 1,
        durationSamples: pcm.length,
        requestedLayers: WAVLM_LAYERS,
        pcmFloat32Base64: float32Base64(pcm)
      })
    });
    if (!response.ok) {
      abstain("representation-service-unavailable");
      return;
    }
    const result = (await response.json()) as {
      processorType?: string;
      processorRef?: string;
      modelId?: string;
      modelRevision?: string;
      weightSha256?: string;
      runtime?: string;
      device?: string;
      layers?: Array<{
        layer: number;
        dimension: number;
        mean: number[];
        standardDeviation: number[];
      }>;
    };
    if (
      captureEpoch !== requestEpoch ||
      controller.signal.aborted
    ) {
      return;
    }
    const validLayers =
      result.layers?.length === 4 &&
      result.layers.every(
        (layer, index) =>
          layer.layer === WAVLM_LAYERS[index] &&
          layer.mean.length === layer.dimension &&
          layer.standardDeviation.length === layer.dimension &&
          [...layer.mean, ...layer.standardDeviation].every(Number.isFinite)
      );
    result.layers?.forEach((layer) => {
      layer.mean.fill(0);
      layer.standardDeviation.fill(0);
    });
    if (
      !validLayers ||
      result.processorType !== "speech-representation" ||
      result.modelId !== WAVLM_MODEL_ID ||
      !result.processorRef ||
      result.modelRevision !== WAVLM_REVISION ||
      result.weightSha256 !== WAVLM_WEIGHT_SHA256 ||
      !result.runtime ||
      !result.device
    ) {
      abstain("representation-response-invalid");
      return;
    }
    post({
      schemaVersion: VOICE_WORKER_MESSAGE_VERSION,
      type: "representation-status",
      captureEpoch: requestEpoch,
      requestRef: message.requestRef,
      windowRef: message.windowRef,
      status: "available",
      provenance: {
        processorType: "speech-representation",
        processorRef: result.processorRef,
        modelId: WAVLM_MODEL_ID,
        revision: result.modelRevision,
        weightSha256: result.weightSha256,
        requestedLayers: WAVLM_LAYERS,
        runtime: result.runtime,
        device: result.device
      }
    });
  } catch {
    abstain("representation-service-unavailable");
  } finally {
    if (controller) representationRequests.delete(controller);
    native?.fill(0);
    pcm?.fill(0);
  }
}

function handleBlock(event: MessageEvent<unknown>): void {
  const block = event.data as VoiceWorkletPcmBlock;
  if (
    block?.schemaVersion !== VOICE_WORKLET_MESSAGE_VERSION ||
    block.type !== "pcm-block" ||
    block.captureEpoch !== captureEpoch ||
    block.channelCount !== 1 ||
    !(block.buffer instanceof ArrayBuffer)
  ) {
    return;
  }
  const samples = new Float32Array(block.buffer);
  const atMs = acquiredAtMs(block);
  const recycle = (): void => {
    port?.postMessage(
      { type: "recycle", buffer: block.buffer },
      [block.buffer]
    );
  };
  if (
    (lastBlockSequence > 0 && block.sequence <= lastBlockSequence) ||
    (lastAbsoluteSampleIndex > 0 &&
      block.absoluteSampleIndex < lastAbsoluteSampleIndex)
  ) {
    timestampRegressionCount += 1;
    recycle();
    return;
  }
  if (
    lastBlockAcquiredAtMs !== null &&
    atMs < lastBlockAcquiredAtMs
  ) {
    timestampRegressionCount += 1;
  }
  const lostSincePrior =
    lastBlockSequence > 0
      ? Math.max(0, block.sequence - lastBlockSequence - 1)
      : 0;
  lostBlockCount += lostSincePrior;
  const expectedBlockMs =
    (samples.length / block.sampleRateHz) * 1000;
  const gapMs =
    lastBlockAcquiredAtMs === null
      ? 0
      : Math.max(
          0,
          atMs - lastBlockAcquiredAtMs - expectedBlockMs
        );
  maximumBlockGapMs = Math.max(maximumBlockGapMs, gapMs);
  currentBlockGapMs = gapMs;
  const sampleDiscontinuity =
    lastAbsoluteSampleIndex > 0 &&
    block.absoluteSampleIndex !== lastAbsoluteSampleIndex;
  if (lostSincePrior > 0 || sampleDiscontinuity || gapMs > 40) {
    ring?.clear();
    nextAnalysisSampleIndex = 0;
    priorBands = null;
  }
  recentBlockContinuity.push({
    atMs,
    received: 1,
    lost: lostSincePrior
  });
  lastBlockAcquiredAtMs = atMs;
  lastBlockSequence = block.sequence;
  lastAbsoluteSampleIndex =
    block.absoluteSampleIndex + samples.length;
  receivedBlockCount += 1;
  sampleRateHz = block.sampleRateHz;
  ring?.push(samples);
  analyzeAvailable(block);
  recycle();
}

worker.addEventListener("message", (event: MessageEvent<VoiceWorkerRequest>) => {
  const message = event.data;
  if (message?.schemaVersion !== VOICE_WORKER_MESSAGE_VERSION) return;
  if (message.type === "initialize") {
    port?.close();
    port = message.port;
    sessionOriginPerformanceMs = message.sessionOriginPerformanceMs;
    audioContextOriginSeconds = message.audioContextOriginSeconds;
    sampleRateHz = message.captureSettings.actual.sampleRate;
    browserProcessing = {
      ...message.captureSettings.actual.browserProcessing
    };
    taskContext = message.taskContext;
    ring = new BoundedPcmRingBuffer(
      Math.round(sampleRateHz * 30)
    );
    reset(message.captureEpoch);
    port.addEventListener("message", handleBlock);
    port.start();
    post({
      schemaVersion: VOICE_WORKER_MESSAGE_VERSION,
      type: "ready",
      captureEpoch,
      provenance: audioPipelineProvenance()
    });
    return;
  }
  if (message.type === "set-task" && message.captureEpoch === captureEpoch) {
    taskContext = message.taskContext;
    return;
  }
  if (
    message.type === "set-noise-floor" &&
    message.captureEpoch === captureEpoch &&
    Number.isFinite(message.noiseFloorRms)
  ) {
    noiseFloorRms = Math.max(0.0001, message.noiseFloorRms);
    return;
  }
  if (message.type === "reset") {
    representationRequests.forEach((controller) => controller.abort());
    representationRequests.clear();
    taskContext = message.taskContext;
    reset(message.captureEpoch);
    return;
  }
  if (
    message.type === "request-representation" &&
    message.captureEpoch === captureEpoch
  ) {
    void requestRepresentation(message);
    return;
  }
  if (message.type === "dispose") {
    representationRequests.forEach((controller) => controller.abort());
    representationRequests.clear();
    post({
      schemaVersion: VOICE_WORKER_MESSAGE_VERSION,
      type: "diagnostics",
      captureEpoch,
      diagnostics: diagnostics()
    });
    port?.close();
    port = null;
    ring?.clear();
    ring = null;
    worker.close();
  }
});
