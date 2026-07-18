import { describe, expect, it } from "vitest";
import type {
  EvidenceCardDraft,
  EvidenceClaimFact
} from "@neurotrax/contracts";
import {
  EVIDENCE_BOUNDARY,
  validateEvidenceCardDraft
} from "./evidence.js";

const facts: EvidenceClaimFact[] = [
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
    eventIds: ["12-trajectory.comparison.completed"],
    allowedNumbers: ["1.9"]
  }
];

function validDraft(): EvidenceCardDraft {
  return {
    headline: "A provisional personal comparison is ready",
    summary:
      "Pitch variability remained consistent with the compatible synthetic personal history.",
    claims: [
      {
        claimId: facts[0].claimId,
        statement: facts[0].statement
      }
    ],
    boundaryStatement: EVIDENCE_BOUNDARY
  };
}

describe("validateEvidenceCardDraft", () => {
  it("passes a bounded card whose claim resolves to structured evidence", () => {
    expect(validateEvidenceCardDraft(validDraft(), facts)).toEqual({
      status: "pass",
      errors: [],
      groundedClaimIds: ["claim-pitch"]
    });
  });

  it("rejects an unknown claim", () => {
    const draft = validDraft();
    draft.claims[0].claimId = "claim-invented";
    expect(validateEvidenceCardDraft(draft, facts).status).toBe("fail");
  });

  it("rejects unsupported numbers and clinical interpretation", () => {
    const draft = validDraft();
    draft.summary =
      "Pitch variability shows 72 percent risk of disease progression.";
    const result = validateEvidenceCardDraft(draft, facts);
    expect(result.status).toBe("fail");
    expect(result.errors.join(" ")).toMatch(/prohibited|numeric/i);
  });

  it("rejects a paraphrased claim that could drift from its support", () => {
    const draft = validDraft();
    draft.claims[0].statement = "Pitch was normal.";
    expect(validateEvidenceCardDraft(draft, facts).status).toBe("fail");
  });
});
