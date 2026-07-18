import type {
  EvidenceCardDraft,
  EvidenceClaimFact,
  EventEnvelope,
  GroundingResult,
  TrajectoryComparison
} from "@neurotrax/contracts";

export const EVIDENCE_BOUNDARY =
  "Engineering demonstration only. No disease progression, diagnosis, cause, or treatment inference was made.";

const PROHIBITED_CLINICAL_LANGUAGE =
  /\b(diagnos(?:is|e|ed|tic)|disease|progress(?:ion|ed|ing)?|treat(?:ment|ed|ing)?|medicat(?:ion|e|ed)|risk|normal|abnormal|worsen(?:ed|ing)?|improv(?:ed|ing|ement)?|cause|clinical decline)\b/i;

function directionPhrase(direction: EvidenceClaimFact["direction"]): string {
  switch (direction) {
    case "above-reference":
      return "was above the compatible synthetic personal reference";
    case "below-reference":
      return "was below the compatible synthetic personal reference";
    case "within-reference":
      return "remained within the compatible synthetic personal reference";
    case "not-comparable":
      return "did not have enough compatible synthetic history for comparison";
  }
}

function formatNumber(value: number): string {
  if (Number.isInteger(value)) return value.toString();
  return Number(value.toFixed(3)).toString();
}

export function createEvidenceClaimFacts(
  comparison: TrajectoryComparison,
  events: EventEnvelope[]
): EvidenceClaimFact[] {
  const trajectoryEventIds = events
    .filter((event) => event.stage === "personal-trajectory")
    .map((event) => event.eventId);
  const ranked = [...comparison.biomarkers].sort((left, right) => {
    const leftChanged = left.direction === "within-reference" ? 1 : 0;
    const rightChanged = right.direction === "within-reference" ? 1 : 0;
    return leftChanged - rightChanged || left.code.localeCompare(right.code);
  });

  const selected = [];
  const speech = ranked.find((item) =>
    item.code.startsWith("prototype.speech.")
  );
  const face = ranked.find((item) => item.code.startsWith("prototype.face."));
  if (speech) selected.push(speech);
  if (face) selected.push(face);
  for (const item of ranked) {
    if (selected.length >= 2) break;
    if (!selected.includes(item)) selected.push(item);
  }

  return selected.slice(0, 2).map((biomarker) => ({
    claimId: `claim-${biomarker.code.replaceAll(".", "-")}`,
    measurementCode: biomarker.code,
    label: biomarker.label,
    direction: biomarker.direction,
    statement: `${biomarker.label} ${directionPhrase(biomarker.direction)}.`,
    currentValue: biomarker.currentValue,
    unit: biomarker.unit,
    supportRefs: [
      ...biomarker.currentEvidenceRefs,
      ...biomarker.referenceMeasurementRefs
    ],
    eventIds: trajectoryEventIds,
    allowedNumbers: [
      formatNumber(biomarker.currentValue),
      formatNumber(biomarker.priorMedian),
      formatNumber(biomarker.priorMinimum),
      formatNumber(biomarker.priorMaximum)
    ]
  }));
}

function numericTokens(value: string): string[] {
  return value.match(/-?\d+(?:\.\d+)?/g) ?? [];
}

function containsEveryClaimLabel(
  summary: string,
  facts: EvidenceClaimFact[]
): boolean {
  const normalized = summary.toLowerCase();
  return facts.every((fact) => {
    const meaningfulWords = fact.label
      .toLowerCase()
      .split(/\s+/)
      .filter((word) => word.length >= 4);
    return meaningfulWords.some((word) => normalized.includes(word));
  });
}

export function validateEvidenceCardDraft(
  draft: EvidenceCardDraft,
  facts: EvidenceClaimFact[]
): GroundingResult {
  const errors: string[] = [];
  const factById = new Map(facts.map((fact) => [fact.claimId, fact]));
  const groundedClaimIds: string[] = [];

  if (draft.claims.length < 1 || draft.claims.length > 2) {
    errors.push("The evidence card must contain one or two claims.");
  }
  if (draft.headline.length > 90 || draft.summary.length > 360) {
    errors.push("The headline or summary exceeds its length contract.");
  }
  if (draft.boundaryStatement !== EVIDENCE_BOUNDARY) {
    errors.push("The required research boundary statement was changed.");
  }
  if (
    PROHIBITED_CLINICAL_LANGUAGE.test(draft.headline) ||
    PROHIBITED_CLINICAL_LANGUAGE.test(draft.summary)
  ) {
    errors.push("Headline or summary contains prohibited clinical language.");
  }
  if (
    numericTokens(draft.headline).length > 0 ||
    numericTokens(draft.summary).length > 0
  ) {
    errors.push("Headline and summary must not introduce numeric claims.");
  }

  const seen = new Set<string>();
  for (const claim of draft.claims) {
    if (seen.has(claim.claimId)) {
      errors.push(`Duplicate claim ID: ${claim.claimId}.`);
      continue;
    }
    seen.add(claim.claimId);
    const fact = factById.get(claim.claimId);
    if (!fact) {
      errors.push(`Unknown claim ID: ${claim.claimId}.`);
      continue;
    }
    if (claim.statement !== fact.statement) {
      errors.push(
        `Claim ${claim.claimId} must use its pre-grounded statement exactly.`
      );
      continue;
    }
    if (fact.supportRefs.length === 0 || fact.eventIds.length === 0) {
      errors.push(`Claim ${claim.claimId} has incomplete provenance.`);
      continue;
    }
    const unsupportedNumbers = numericTokens(claim.statement).filter(
      (token) => !fact.allowedNumbers.includes(token)
    );
    if (unsupportedNumbers.length > 0) {
      errors.push(
        `Claim ${claim.claimId} introduced unsupported numbers: ${unsupportedNumbers.join(", ")}.`
      );
      continue;
    }
    if (PROHIBITED_CLINICAL_LANGUAGE.test(claim.statement)) {
      errors.push(`Claim ${claim.claimId} contains prohibited language.`);
      continue;
    }
    groundedClaimIds.push(claim.claimId);
  }

  const selectedFacts = draft.claims
    .map((claim) => factById.get(claim.claimId))
    .filter((fact): fact is EvidenceClaimFact => Boolean(fact));
  if (
    selectedFacts.length > 0 &&
    !containsEveryClaimLabel(draft.summary, selectedFacts)
  ) {
    errors.push("The summary does not name every selected measurement.");
  }

  return {
    status: errors.length === 0 ? "pass" : "fail",
    errors,
    groundedClaimIds: errors.length === 0 ? groundedClaimIds : []
  };
}
