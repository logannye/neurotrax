import { describe, expect, it, vi } from "vitest";
import { EVIDENCE_BOUNDARY } from "@neurotrax/evidence-core";
import { runEvidenceAgent } from "./evidence-agent.js";
import { hasEvidenceCredential } from "./vite-evidence-plugin.js";

const request = {
  containsPHI: false,
  visitId: "visit-test",
  comparisonId: "comparison-test",
  syntheticHistory: true,
  includesAcceptedSessionHistory: false,
  qualitySummary: {
    speechWindowCount: 1,
    faceWindowCount: 1,
    abstentionCount: 0,
    qualityTransitionCount: 2
  },
  excludedEncounters: [],
  facts: [
    {
      claimId: "claim-pitch",
      measurementCode: "prototype.speech.pitch_variability",
      label: "Pitch variability",
      direction: "within-reference",
      statement:
        "Pitch variability remained within the compatible synthetic personal reference.",
      currentValue: 1.9,
      unit: "semitone-stddev",
      supportRefs: ["speech-0", "prior:pitch"],
      eventIds: ["trajectory-comparison-completed"],
      allowedNumbers: ["1.9"]
    }
  ]
} as const;

function response(outputParsed: unknown, id: string) {
  return {
    id,
    model: "gpt-5.6-sol",
    output_parsed: outputParsed
  };
}

describe("runEvidenceAgent", () => {
  it("returns a grounded structured draft", async () => {
    const parse = vi.fn().mockResolvedValue(
      response(
        {
          headline: "A provisional personal comparison is ready",
          summary:
            "Pitch variability remained consistent with compatible synthetic personal history.",
          claims: [
            {
              claimId: request.facts[0].claimId,
              statement: request.facts[0].statement
            }
          ],
          boundaryStatement: EVIDENCE_BOUNDARY
        },
        "response-1"
      )
    );

    const result = await runEvidenceAgent(request, {
      responses: { parse: parse as never }
    });

    expect(result.grounding.status).toBe("pass");
    expect(result.model).toBe("gpt-5.6-sol");
    expect(result.attemptCount).toBe(1);
  });

  it("retries once after a grounding failure", async () => {
    const valid = {
      headline: "A provisional personal comparison is ready",
      summary:
        "Pitch variability remained consistent with compatible synthetic personal history.",
      claims: [
        {
          claimId: request.facts[0].claimId,
          statement: request.facts[0].statement
        }
      ],
      boundaryStatement: EVIDENCE_BOUNDARY
    };
    const parse = vi
      .fn()
      .mockResolvedValueOnce(
        response(
          {
            ...valid,
            claims: [
              {
                claimId: "claim-invented",
                statement: "An invented observation."
              }
            ]
          },
          "response-invalid"
        )
      )
      .mockResolvedValueOnce(response(valid, "response-valid"));

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
          headline: "Disease progression detected",
          summary: "Pitch variability proves clinical decline.",
          claims: [
            {
              claimId: request.facts[0].claimId,
              statement: request.facts[0].statement
            }
          ],
          boundaryStatement: EVIDENCE_BOUNDARY
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

  it("treats a refusal or missing parsed output as a blocking failure", async () => {
    const parse = vi
      .fn()
      .mockResolvedValue(response(null, "response-refusal"));

    await expect(
      runEvidenceAgent(request, {
        responses: { parse: parse as never }
      })
    ).rejects.toThrow(/no parsed evidence-card draft/i);
    expect(parse).toHaveBeenCalledTimes(2);
  });

  it("surfaces an API timeout without substituting prose", async () => {
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
