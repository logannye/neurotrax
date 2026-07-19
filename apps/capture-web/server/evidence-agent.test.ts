import { describe, expect, it, vi } from "vitest";
import {
  EVIDENCE_MODEL,
  runEvidenceAgent
} from "./evidence-agent.js";
import { hasEvidenceCredential } from "./vite-evidence-plugin.js";

const facts = [
  {
    claimId: "claim-pitch",
    measurementCode: "prototype.speech.pitch_variability",
    label: "Pitch variability",
    modality: "speech",
    statement:
      "Pitch variability was measured from a technically usable speech interval.",
    currentValue: 1.9,
    unit: "semitone-stddev",
    supportRefs: ["speech-0"],
    eventIds: ["measurement-pitch"],
    allowedNumbers: ["1.9"]
  },
  {
    claimId: "claim-face",
    measurementCode: "prototype.face.expressivity",
    label: "Facial movement",
    modality: "face",
    statement:
      "Facial movement was measured before and after a quality-withheld interval.",
    currentValue: 0.04,
    unit: "motion-index",
    supportRefs: ["face-0", "face-1"],
    eventIds: ["measurement-face", "face-restored"],
    allowedNumbers: ["0.04"]
  }
] as const;

const request = {
  containsPHI: false,
  visitId: "visit-test",
  qualitySummary: {
    speechWindowCount: 1,
    faceWindowCount: 2,
    abstentionCount: 1,
    qualityTransitionCount: 4,
    audioFrameCount: 60,
    speechActiveFrameCount: 48,
    pitchedFrameCount: 42,
    pitchCoverage: 0.875,
    faceFrameCount: 60,
    usableFaceFrameCount: 48,
    usableFaceFraction: 0.8,
    faceWithholdingDurationMs: 1000,
    faceRecoveryObserved: true,
    postRecoveryFaceWindowCount: 1
  },
  facts
} as const;

function validNarrative() {
  return {
    headline: "Two encounter signals are ready for review",
    summary:
      "Pitch variability and facial movement were measured during technically usable portions of the encounter."
  };
}

function response(outputParsed: unknown, id: string) {
  return {
    id,
    model: "gpt-5.6-luna",
    output_parsed: outputParsed
  };
}

describe("runEvidenceAgent", () => {
  it("returns a grounded structured draft", async () => {
    const parse = vi
      .fn()
      .mockResolvedValue(response(validNarrative(), "response-1"));

    const result = await runEvidenceAgent(request, {
      responses: { parse: parse as never }
    });

    expect(result.grounding.status).toBe("pass");
    expect(result.attemptCount).toBe(1);
    expect(result.draft.claims).toEqual(
      facts.map((fact) => ({
        claimId: fact.claimId,
        statement: fact.statement
      }))
    );
    expect(result.timing.totalMs).toBeGreaterThanOrEqual(0);
    expect(parse).toHaveBeenCalledWith(
      expect.objectContaining({
        model: EVIDENCE_MODEL,
        service_tier: "priority",
        store: false,
        max_output_tokens: 96,
        reasoning: { effort: "none" }
      })
    );
  });

  it("retries once after a grounding failure", async () => {
    const parse = vi
      .fn()
      .mockResolvedValueOnce(
        response(
          {
            ...validNarrative(),
            summary: "Only pitch variability was measured."
          },
          "response-invalid"
        )
      )
      .mockResolvedValueOnce(response(validNarrative(), "response-valid"));

    const result = await runEvidenceAgent(request, {
      responses: { parse: parse as never }
    });
    expect(parse).toHaveBeenCalledTimes(2);
    expect(result.attemptCount).toBe(2);
  });

  it("fails after the second ungrounded response", async () => {
    const parse = vi.fn().mockResolvedValue(
      response(
        {
          ...validNarrative(),
          headline: "Disease progression detected",
          summary: "Pitch variability proves clinical decline."
        },
        "response-invalid"
      )
    );

    await expect(
      runEvidenceAgent(request, {
        responses: { parse: parse as never }
      })
    ).rejects.toThrow(/failed after two attempts/i);
    expect(parse).toHaveBeenCalledTimes(2);
  });

  it("rejects payloads that are not explicitly non-PHI", async () => {
    await expect(
      runEvidenceAgent(
        { ...request, containsPHI: true },
        { responses: { parse: vi.fn() as never } }
      )
    ).rejects.toThrow();
  });

  it("treats a refusal or missing parsed output as blocking", async () => {
    const parse = vi
      .fn()
      .mockResolvedValue(response(null, "response-refusal"));

    await expect(
      runEvidenceAgent(request, {
        responses: { parse: parse as never }
      })
    ).rejects.toThrow(/no parsed encounter narrative/i);
    expect(parse).toHaveBeenCalledTimes(2);
  });

  it("surfaces a timeout without substituting prose", async () => {
    const parse = vi.fn().mockRejectedValue(new Error("Request timed out."));

    await expect(
      runEvidenceAgent(request, {
        responses: { parse: parse as never }
      })
    ).rejects.toThrow(/timed out/i);
    expect(parse).toHaveBeenCalledTimes(1);
  });

  it("requires a nonblank server-side credential", () => {
    expect(hasEvidenceCredential({})).toBe(false);
    expect(hasEvidenceCredential({ OPENAI_API_KEY: "   " })).toBe(false);
    expect(hasEvidenceCredential({ OPENAI_API_KEY: "undefined" })).toBe(false);
    expect(hasEvidenceCredential({ OPENAI_API_KEY: "server-secret" })).toBe(
      true
    );
  });
});
