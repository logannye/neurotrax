import { describe, expect, it } from "vitest";
import type {
  Abstention,
  Measurement,
  MeasurableWindow
} from "@phenometric/contracts";

describe("measurement contracts", () => {
  it("models a measurement with provenance and placeholder honesty", () => {
    const window: MeasurableWindow = {
      windowId: "w-1",
      modality: "speech",
      startMs: 0,
      endMs: 4000,
      context: {
        kind: "spontaneous-speech",
        confounds: {
          kind: "speech",
          snrDb: 22,
          clippingFraction: 0
        }
      }
    };
    const measurement: Measurement = {
      code: "prototype.speech.articulation_rate",
      label: "Articulation rate",
      value: 0.61,
      unit: "voiced-fraction",
      confidence: 0.9,
      uncertainty: {
        kind: "not-estimated",
        reason: "not estimated for speech"
      },
      algorithmVersion: "speech-acoustic-0.1",
      processorRef: "speech-acoustic-0.1",
      clinicalValidation: "none",
      contextRef: window.windowId,
      sourceWindowRefs: [window.windowId],
      windowStartMs: window.startMs,
      windowEndMs: window.endMs,
      evidenceSnippetRef: null
    };
    const abstention: Abstention = {
      modality: "speech",
      windowStartMs: 0,
      windowEndMs: 1000,
      reasonCode: "snr-too-low",
      detail: "Mean SNR 4 dB below the 12 dB floor."
    };

    expect(measurement.uncertainty.kind).toBe("not-estimated");
    expect(measurement.clinicalValidation).toBe("none");
    expect(measurement.contextRef).toBe(window.windowId);
    expect(abstention.reasonCode).toBe("snr-too-low");
  });
});
