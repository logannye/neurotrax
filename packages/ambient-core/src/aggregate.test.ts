import { describe, expect, it } from "vitest";
import { aggregateMeasurements } from "./aggregate.js";
import type { Measurement, MeasurementContext } from "@phenometric/contracts";
import { syntheticSpeechConfounds } from "./test-helpers.js";

function measurementContext(kind: MeasurementContext["kind"]): MeasurementContext {
  return {
    kind,
    confounds: syntheticSpeechConfounds({ snrDb: 20 })
  };
}

function m(code: string, value: number, contextRef = "speech-0"): Measurement {
  return {
    code, label: code, value, unit: "u", confidence: 0.9,
    uncertainty: { kind: "not-estimated", reason: "not estimated" },
    algorithmVersion: "voice-analysis-1.0",
    processorRef: "browser-voice-dsp@1.0",
    clinicalValidation: "none", contextRef, sourceWindowRefs: [contextRef], windowStartMs: 0,
    windowEndMs: 2000, evidenceSnippetRef: null
  };
}

describe("aggregateMeasurements", () => {
  it("computes median and MAD per code with a stable window count", () => {
    const context = new Map<string, MeasurementContext>([
      ["speech-0", measurementContext("spontaneous-speech")]
    ]);
    const labels = new Map([["prototype.voice.pause_rate", { label: "Pause rate", unit: "pauses-per-minute" }]]);
    const result = aggregateMeasurements(
      [m("prototype.voice.pause_rate", 2), m("prototype.voice.pause_rate", 4), m("prototype.voice.pause_rate", 6)],
      context, labels
    );
    expect(result).toHaveLength(1);
    expect(result[0].value).toBe(4);
    expect(result[0].spread).toBe(2);
    expect(result[0].windowCount).toBe(3);
    expect(result[0].contextKind).toBe("spontaneous-speech");
    expect(result[0].label).toBe("Pause rate");
    expect(result[0].processorRef).toBe("browser-voice-dsp@1.0");
    expect(result[0].sourceWindowRefs).toEqual(["speech-0"]);
  });

  it("throws when a code mixes algorithm versions", () => {
    const context = new Map<string, MeasurementContext>([
      ["speech-0", measurementContext("spontaneous-speech")]
    ]);
    const labels = new Map([["c", { label: "c", unit: "u" }]]);
    const a = m("c", 1);
    const b = { ...m("c", 2), algorithmVersion: "voice-analysis-1.1" };
    expect(() => aggregateMeasurements([a, b], context, labels)).toThrow(/mixes algorithm versions/);
  });

  it("throws when a code mixes processor references", () => {
    const context = new Map<string, MeasurementContext>([
      ["speech-0", measurementContext("spontaneous-speech")]
    ]);
    const a = m("c", 1);
    const b = { ...m("c", 2), processorRef: "different-processor" };
    expect(() =>
      aggregateMeasurements([a, b], context, new Map())
    ).toThrow(/mixes processor references/);
  });

  it("keeps the same biomarker separate across measurement contexts", () => {
    const context = new Map<string, MeasurementContext>([
      ["speech-0", measurementContext("spontaneous-speech")],
      ["reading-0", measurementContext("reading-aloud")]
    ]);
    const labels = new Map([["c", { label: "c", unit: "u" }]]);

    const result = aggregateMeasurements(
      [m("c", 1, "speech-0"), m("c", 2, "reading-0")],
      context,
      labels
    );

    expect(result).toHaveLength(2);
    expect(result.map((aggregate) => aggregate.contextKind)).toEqual([
      "reading-aloud",
      "spontaneous-speech"
    ]);
  });

  it("rejects a measurement whose context cannot be resolved", () => {
    expect(() =>
      aggregateMeasurements(
        [m("c", 1, "missing-window")],
        new Map(),
        new Map()
      )
    ).toThrow(/unknown context missing-window/);
  });
});
