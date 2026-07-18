import { describe, expect, it } from "vitest";
import type {
  EvidenceCardDraft,
  EvidenceClaimFact
} from "@neurotrax/contracts";
import {
  assembleEvidenceCardDraft,
  EVIDENCE_BOUNDARY,
  validateEvidenceCardDraft
} from "./evidence.js";

const facts: EvidenceClaimFact[] = [
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
    eventIds: ["measurement-face", "face-recovered"],
    allowedNumbers: ["0.04"]
  }
];

function validDraft(): EvidenceCardDraft {
  return {
    headline: "Two encounter signals are ready for review",
    summary:
      "Pitch variability and facial movement were measured during technically usable portions of the encounter.",
    claims: facts.map((fact) => ({
      claimId: fact.claimId,
      statement: fact.statement
    })),
    boundaryStatement: EVIDENCE_BOUNDARY
  };
}

describe("validateEvidenceCardDraft", () => {
  it("attaches exact grounded claims and the review boundary in code", () => {
    const draft = assembleEvidenceCardDraft(
      {
        headline: "Two encounter signals are ready for review",
        summary:
          "Pitch variability and facial movement were measured during technically usable portions of the encounter."
      },
      facts
    );

    expect(draft.claims).toEqual(
      facts.map((fact) => ({
        claimId: fact.claimId,
        statement: fact.statement
      }))
    );
    expect(draft.boundaryStatement).toBe(EVIDENCE_BOUNDARY);
  });

  it("passes one speech claim and one face claim", () => {
    expect(validateEvidenceCardDraft(validDraft(), facts)).toEqual({
      status: "pass",
      errors: [],
      groundedClaimIds: ["claim-pitch", "claim-face"]
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

  it("requires both modalities", () => {
    const draft = validDraft();
    draft.claims[1] = { ...draft.claims[0] };
    expect(validateEvidenceCardDraft(draft, facts).status).toBe("fail");
  });
});
