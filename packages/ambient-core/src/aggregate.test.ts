import { describe, expect, it } from "vitest";
import { aggregateMeasurements } from "./aggregate.js";
import type { Measurement, MeasurementContextKind } from "@neurotrax/contracts";

function m(code: string, value: number): Measurement {
  return {
    code, label: code, value, unit: "u", confidence: 0.9,
    uncertainty: "placeholder", algorithmVersion: "speech-acoustic-0.1",
    clinicalValidation: "none", contextRef: "speech-0", windowStartMs: 0,
    windowEndMs: 2000, evidenceSnippetRef: null
  };
}

describe("aggregateMeasurements", () => {
  it("computes median and MAD per code with a stable window count", () => {
    const context = new Map<string, MeasurementContextKind>([["speech-0", "spontaneous-speech"]]);
    const labels = new Map([["prototype.speech.pause_count", { label: "Pause count", unit: "count" }]]);
    const result = aggregateMeasurements(
      [m("prototype.speech.pause_count", 2), m("prototype.speech.pause_count", 4), m("prototype.speech.pause_count", 6)],
      context, labels
    );
    expect(result).toHaveLength(1);
    expect(result[0].value).toBe(4);
    expect(result[0].spread).toBe(2);
    expect(result[0].windowCount).toBe(3);
    expect(result[0].contextKind).toBe("spontaneous-speech");
    expect(result[0].label).toBe("Pause count");
  });

  it("throws when a code mixes algorithm versions", () => {
    const context = new Map<string, MeasurementContextKind>([["speech-0", "spontaneous-speech"]]);
    const labels = new Map([["c", { label: "c", unit: "u" }]]);
    const a = m("c", 1);
    const b = { ...m("c", 2), algorithmVersion: "speech-acoustic-0.2" };
    expect(() => aggregateMeasurements([a, b], context, labels)).toThrow(/mixes algorithm versions/);
  });
});
