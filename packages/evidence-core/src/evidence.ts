import type {
  EncounterObservation,
  EvidenceCardDraft,
  EvidenceClaimFact,
  EvidenceNarrativeDraft,
  EventEnvelope,
  GroundingResult,
  Modality
} from "@neurotrax/contracts";

export const EVIDENCE_BOUNDARY =
  "For clinician review. This summary does not provide a diagnosis or treatment recommendation.";

const PROHIBITED_CLINICAL_LANGUAGE =
  /\b(diagnos(?:is|e|ed|tic)|disease|progress(?:ion|ed|ing)?|treat(?:ment|ed|ing)?|medicat(?:ion|e|ed)|risk|normal|abnormal|worsen(?:ed|ing)?|improv(?:ed|ing|ement)?|cause|clinical decline)\b/i;

const SPEECH_PRIORITY = [
  "prototype.speech.pitch_variability",
  "prototype.speech.voiced_time_fraction",
  "prototype.speech.pause_rate"
];
const FACE_PRIORITY = [
  "prototype.face.expressivity",
  "prototype.face.blink_rate",
  "prototype.face.brow_amplitude"
];

function formatNumber(value: number): string {
  if (Number.isInteger(value)) return value.toString();
  return Number(value.toFixed(3)).toString();
}

function priorityFor(code: string, modality: Modality): number {
  const list = modality === "speech" ? SPEECH_PRIORITY : FACE_PRIORITY;
  const index = list.indexOf(code);
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

export function createEncounterClaimFacts(
  observation: EncounterObservation,
  events: EventEnvelope[]
): EvidenceClaimFact[] {
  const facts: EvidenceClaimFact[] = [];

  for (const modality of ["speech", "face"] as const) {
    const aggregate = observation.aggregates
      .filter((candidate) =>
        candidate.code.startsWith(`prototype.${modality}.`)
      )
      .sort(
        (left, right) =>
          priorityFor(left.code, modality) -
            priorityFor(right.code, modality) ||
          right.confidence - left.confidence
      )[0];
    if (!aggregate) continue;

    const measurements = observation.measurements.filter(
      (measurement) => measurement.code === aggregate.code
    );
    const measurementRefs = [
      ...new Set(measurements.map((measurement) => measurement.contextRef))
    ];
    const supportingEvents = events.filter(
      (event) => {
        if (event.type === "encounter-observation.created") return true;
        if (event.type === "measurement.recorded") {
          return event.payload.code === aggregate.code;
        }
        if (
          event.type === "capture.window.opened" ||
          event.type === "capture.window.closed" ||
          event.type === "extractor.routed"
        ) {
          return (
            typeof event.payload.windowId === "string" &&
            measurementRefs.includes(event.payload.windowId)
          );
        }
        if (
          event.type === "capture.quality.changed" ||
          event.type === "measurement.abstained"
        ) {
          return (
            event.payload.modality === modality ||
            event.actor.id ===
              (modality === "speech"
                ? "speech-acoustic"
                : "facial-expressivity")
          );
        }
        return false;
      }
    );
    const statement =
      modality === "speech"
        ? `${aggregate.label} was measured from a technically usable speech interval.`
        : `${aggregate.label} was measured before and after a quality-withheld interval.`;

    facts.push({
      claimId: `claim-${aggregate.code.replaceAll(".", "-")}`,
      measurementCode: aggregate.code,
      label: aggregate.label,
      modality,
      statement,
      currentValue: aggregate.value,
      unit: aggregate.unit,
      supportRefs: measurementRefs,
      eventIds: supportingEvents.map((event) => event.eventId),
      allowedNumbers: [formatNumber(aggregate.value)]
    });
  }

  return facts;
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

export function assembleEvidenceCardDraft(
  narrative: EvidenceNarrativeDraft,
  facts: EvidenceClaimFact[]
): EvidenceCardDraft {
  return {
    headline: narrative.headline,
    summary: narrative.summary,
    claims: facts.map((fact) => ({
      claimId: fact.claimId,
      statement: fact.statement
    })),
    boundaryStatement: EVIDENCE_BOUNDARY
  };
}

export function validateEvidenceCardDraft(
  draft: EvidenceCardDraft,
  facts: EvidenceClaimFact[]
): GroundingResult {
  const errors: string[] = [];
  const factById = new Map(facts.map((fact) => [fact.claimId, fact]));
  const groundedClaimIds: string[] = [];

  if (facts.length !== 2 || new Set(facts.map((fact) => fact.modality)).size !== 2) {
    errors.push("Current-encounter synthesis requires one speech fact and one face fact.");
  }
  if (draft.claims.length !== 2) {
    errors.push("The encounter summary must contain exactly two claims.");
  }
  if (draft.headline.length > 90 || draft.summary.length > 360) {
    errors.push("The headline or summary exceeds its length contract.");
  }
  if (draft.boundaryStatement !== EVIDENCE_BOUNDARY) {
    errors.push("The required review boundary statement was changed.");
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

  if (
    new Set(
      draft.claims
        .map((claim) => factById.get(claim.claimId)?.modality)
        .filter(Boolean)
    ).size !== 2
  ) {
    errors.push("The summary must include one speech claim and one face claim.");
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
