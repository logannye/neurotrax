import type {
  AudioCaptureSettings,
  AudioPipelineProvenance,
  AudioStreamDiagnostics,
  GuidedVoiceTaskEvidenceInterval,
  VoiceModelProvenance,
  VoiceTaskContext
} from "@phenometric/contracts";
import type { VoiceSignalFrameV1 } from "@phenometric/ambient-core";
import {
  isCurrentVoiceWorkerResponse,
  VOICE_WORKER_MESSAGE_VERSION,
  type VoiceWorkerRequest,
  type VoiceWorkerResponse
} from "./voice-worker-protocol.js";

export interface VoiceCaptureCallbacks {
  onFrame(frame: VoiceSignalFrameV1, processingLatencyMs: number): void;
  onReady(provenance: AudioPipelineProvenance): void;
  onDiagnostics(diagnostics: AudioStreamDiagnostics): void;
  onFailure(reason: string): void;
  onRepresentation?(result: {
    requestRef: string;
    windowRef: string;
    status: "available" | "abstained";
    provenance?: VoiceModelProvenance;
    reasonCode?: string;
  }): void;
}

export interface VoiceCaptureStartOptions {
  stream: MediaStream;
  audioContext: AudioContext;
  captureSettings: AudioCaptureSettings;
  captureEpoch: number;
  taskContext: VoiceTaskContext;
  callbacks: VoiceCaptureCallbacks;
}

export interface VoiceCapturePipeline {
  setTask(taskContext: VoiceTaskContext): void;
  setNoiseFloor(noiseFloorRms: number): void;
  reset(captureEpoch: number, taskContext: VoiceTaskContext): void;
  requestRepresentation(
    endpoint: string,
    interval: GuidedVoiceTaskEvidenceInterval
  ): void;
  stop(): Promise<void>;
  readonly captureEpoch: number;
}

function request(
  value: Record<string, unknown>
): VoiceWorkerRequest {
  return {
    schemaVersion: VOICE_WORKER_MESSAGE_VERSION,
    ...value
  } as VoiceWorkerRequest;
}

export async function startVoiceCapturePipeline(
  options: VoiceCaptureStartOptions
): Promise<VoiceCapturePipeline> {
  if (!options.audioContext.audioWorklet) {
    throw new Error("audio-worklet-unavailable");
  }
  await options.audioContext.audioWorklet.addModule(
    "/voice-capture-worklet.js"
  );
  const worker = new Worker(
    new URL("./voice-worker.ts", import.meta.url),
    { type: "module" }
  );
  const source =
    options.audioContext.createMediaStreamSource(options.stream);
  const worklet = new AudioWorkletNode(
    options.audioContext,
    "phenometric-voice-capture",
    {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      channelCount: 1,
      channelCountMode: "explicit"
    }
  );
  const mutedOutput = options.audioContext.createGain();
  mutedOutput.gain.value = 0;
  source.connect(worklet);
  worklet.connect(mutedOutput);
  mutedOutput.connect(options.audioContext.destination);

  const channel = new MessageChannel();
  let captureEpoch = options.captureEpoch;
  let stopped = false;

  worker.addEventListener(
    "message",
    (event: MessageEvent<VoiceWorkerResponse>) => {
      if (
        stopped ||
        !isCurrentVoiceWorkerResponse(event.data, captureEpoch)
      ) {
        return;
      }
      if (event.data.type === "ready") {
        options.callbacks.onReady(event.data.provenance);
      } else if (event.data.type === "signal-frame") {
        options.callbacks.onFrame(
          event.data.frame,
          event.data.processingLatencyMs
        );
      } else if (event.data.type === "diagnostics") {
        options.callbacks.onDiagnostics(event.data.diagnostics);
      } else if (event.data.type === "error") {
        options.callbacks.onFailure(event.data.reason);
      } else if (event.data.type === "representation-status") {
        options.callbacks.onRepresentation?.({
          requestRef: event.data.requestRef,
          windowRef: event.data.windowRef,
          status: event.data.status,
          ...(event.data.provenance
            ? { provenance: event.data.provenance }
            : {}),
          ...(event.data.reasonCode
            ? { reasonCode: event.data.reasonCode }
            : {})
        });
      }
    }
  );
  worker.addEventListener("error", () => {
    if (!stopped) {
      options.callbacks.onFailure("voice-worker-unavailable");
    }
  });

  worklet.port.postMessage(
    { type: "attach-port", port: channel.port1 },
    [channel.port1]
  );
  worklet.port.postMessage({
    type: "capture-epoch",
    captureEpoch
  });
  worker.postMessage(
    request({
      type: "initialize",
      captureEpoch,
      port: channel.port2,
      sessionOriginPerformanceMs: performance.now(),
      audioContextOriginSeconds: options.audioContext.currentTime,
      captureSettings: options.captureSettings,
      taskContext: options.taskContext
    }),
    [channel.port2]
  );

  return {
    get captureEpoch() {
      return captureEpoch;
    },
    setTask(taskContext) {
      if (stopped) return;
      worker.postMessage(
        request({ type: "set-task", captureEpoch, taskContext })
      );
    },
    setNoiseFloor(noiseFloorRms) {
      if (stopped || !Number.isFinite(noiseFloorRms)) return;
      worker.postMessage(
        request({
          type: "set-noise-floor",
          captureEpoch,
          noiseFloorRms
        })
      );
    },
    reset(nextEpoch, taskContext) {
      if (stopped) return;
      captureEpoch = nextEpoch;
      worklet.port.postMessage({
        type: "capture-epoch",
        captureEpoch
      });
      worker.postMessage(
        request({ type: "reset", captureEpoch, taskContext })
      );
    },
    requestRepresentation(endpoint, interval) {
      if (stopped || endpoint.length === 0) return;
      worker.postMessage(
        request({
          type: "request-representation",
          captureEpoch,
          endpoint,
          requestRef: `representation-${captureEpoch}-${interval.taskContext}`,
          windowRef: `voice:${interval.startMs}-${interval.endMs}`,
          taskContext: interval.taskContext,
          durationMs: interval.endMs - interval.startMs
        })
      );
    },
    async stop() {
      if (stopped) return;
      stopped = true;
      try {
        worklet.port.postMessage({ type: "dispose" });
        worker.postMessage(
          request({ type: "dispose", captureEpoch })
        );
      } catch {
        // A failed worker already released its message ports.
      }
      source.disconnect();
      worklet.disconnect();
      mutedOutput.disconnect();
      worker.terminate();
    }
  };
}
