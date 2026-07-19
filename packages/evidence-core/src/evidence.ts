import type {
  EncounterObservation,
  EvidenceCardDraft,
  EvidenceClaimFact,
  EvidenceNarrativeDraft,
  EventEnvelope,
  GroundingResult,
  Modality,
  ModalityOutcome
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
        ? `${aggregate.label} was measured across accepted speech analysis windows.`
        : `${aggregate.label} was measured across accepted facial analysis windows.`;

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

function supportingEventsFor(
  modality: Modality,
  measurementCode: string | null,
  measurementRefs: string[],
  events: EventEnvelope[]
): EventEnvelope[] {
  return events.filter((event) => {
    if (event.type === "encounter-observation.created") return true;
    if (
      measurementCode &&
      event.type === "measurement.recorded" &&
      event.payload.code === measurementCode
    ) {
      return true;
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
  });
}

export function createModalityOutcomes(
  observation: EncounterObservation,
  events: EventEnvelope[]
): [ModalityOutcome, ModalityOutcome] {
  const createOutcome = (modality: Modality): ModalityOutcome => {
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
    const qualityFacts: Record<string, string | number | boolean> =
      modality === "speech"
        ? {
            usableWindows: observation.qualitySummary.speechWindowCount,
            pitchCoverage: observation.qualitySummary.pitchCoverage,
            activeFrames:
              observation.qualitySummary.speechActiveFrameCount
          }
        : {
            usableWindows: observation.qualitySummary.faceWindowCount,
            usableFraction:
              observation.qualitySummary.usableFaceFraction,
            withholdingMs:
              observation.qualitySummary.faceWithholdingDurationMs,
            recoveryConfirmed:
              observation.qualitySummary.faceRecoveryObserved
          };

    if (aggregate) {
      const measurements = observation.measurements.filter(
        (measurement) => measurement.code === aggregate.code
      );
      const measurementRefs = [
        ...new Set(measurements.map((measurement) => measurement.contextRef))
      ];
      const supportingEvents = supportingEventsFor(
        modality,
        aggregate.code,
        measurementRefs,
        events
      );
      const beforeAndAfter =
        modality === "face" &&
        observation.qualitySummary.faceRecoveryObserved &&
        observation.qualitySummary.postRecoveryFaceWindowCount > 0;
      return {
        outcomeId: `outcome-${modality}-measured`,
        status: "measured",
        measurementCode: aggregate.code,
        label: aggregate.label,
        modality,
        statement:
          modality === "speech"
            ? `${aggregate.label}: ${formatNumber(aggregate.value)} ${aggregate.unit}, measured across accepted speech analysis windows.`
            : beforeAndAfter
              ? `${aggregate.label}: ${formatNumber(aggregate.value)} ${aggregate.unit}, measured across accepted facial analysis windows.`
              : `${aggregate.label}: ${formatNumber(aggregate.value)} ${aggregate.unit}, measured across the encounter.`,
        currentValue: aggregate.value,
        unit: aggregate.unit,
        qualityFacts,
        supportRefs:
          measurementRefs.length > 0
            ? measurementRefs
            : [`observation:${observation.visitId}`],
        eventIds: supportingEvents.map((event) => event.eventId),
        allowedNumbers: [formatNumber(aggregate.value)]
      };
    }

    const abstention = [...observation.abstentions]
      .reverse()
      .find((candidate) => candidate.modality === modality);
    const supportingEvents = supportingEventsFor(
      modality,
      null,
      [],
      events
    );
    const reasonCode =
      abstention?.reasonCode ?? `no-technically-usable-${modality}-window`;
    return {
      outcomeId: `outcome-${modality}-withheld`,
      status: "withheld",
      label: modality === "speech" ? "Speech outcome" : "Facial outcome",
      modality,
      statement: `${
        modality === "speech" ? "Speech" : "Facial"
      } measurement was withheld because no technically usable ${
        modality === "speech" ? "speech" : "facial"
      } interval was captured.`,
      reasonCode,
      qualityFacts,
      supportRefs: [
        abstention
          ? `abstention:${modality}:${abstention.windowStartMs}-${abstention.windowEndMs}`
          : `observation:${observation.visitId}`
      ],
      eventIds: supportingEvents.map((event) => event.eventId)
    };
  };

  return [createOutcome("speech"), createOutcome("face")];
}

function numericTokens(value: string): string[] {
  return value.match(/-?\d+(?:\.\d+)?/g) ?? [];
}

function containsEveryClaimLabel(
  summary: string,
  facts: Array<EvidenceClaimFact | ModalityOutcome>
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
  facts: Array<EvidenceClaimFact | ModalityOutcome>
): EvidenceCardDraft {
  const reportableFacts = facts.filter(
    (fact) => !("status" in fact) || fact.status === "measured"
  );
  return {
    headline: narrative.headline,
    summary: narrative.summary,
    claims: reportableFacts.map((fact) => ({
      claimId: "claimId" in fact ? fact.claimId : fact.outcomeId,
      modality: fact.modality,
      status: "status" in fact ? fact.status : "measured",
      statement: fact.statement
    })),
    boundaryStatement: EVIDENCE_BOUNDARY
  };
}

export function validateEvidenceCardDraft(
  draft: EvidenceCardDraft,
  facts: Array<EvidenceClaimFact | ModalityOutcome>
): GroundingResult {
  const errors: string[] = [];
  const factById = new Map(
    facts.map((fact) => [
      "claimId" in fact ? fact.claimId : fact.outcomeId,
      fact
    ])
  );
  const groundedClaimIds: string[] = [];
  const reportableFacts = facts.filter(
    (fact) => !("status" in fact) || fact.status === "measured"
  );

  if (facts.length !== 2 || new Set(facts.map((fact) => fact.modality)).size !== 2) {
    errors.push("Current-encounter synthesis requires one speech fact and one face fact.");
  }
  if (draft.claims.length !== reportableFacts.length) {
    errors.push(
      "The encounter report must include each measured modality and omit unavailable modalities."
    );
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
  const outcomes = facts.filter(
    (fact): fact is ModalityOutcome => "status" in fact
  );
  if (
    outcomes.some((outcome) => outcome.status === "withheld") &&
    /\b(withheld|unavailable|not captured|insufficient)\b/i.test(
      `${draft.headline} ${draft.summary}`
    )
  ) {
    errors.push(
      "The clinical report must omit unavailable modalities rather than describe acquisition status."
    );
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
    const allowedNumbers =
      "allowedNumbers" in fact ? fact.allowedNumbers : [];
    const unsupportedNumbers = numericTokens(claim.statement).filter(
      (token) => !allowedNumbers.includes(token)
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
    ).size !== reportableFacts.length
  ) {
    errors.push("The report must include every measured modality exactly once.");
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
