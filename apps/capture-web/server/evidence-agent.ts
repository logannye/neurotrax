import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import type {
  EvidenceCardDraft,
  EvidenceClaimFact,
  EvidenceSynthesisTiming,
  GroundingResult
} from "@neurotrax/contracts";
import {
  assembleEvidenceCardDraft,
  validateEvidenceCardDraft
} from "../../../packages/evidence-core/src/evidence.ts";

export const EVIDENCE_MODEL = "gpt-5.6-luna";
export const EVIDENCE_PROMPT_VERSION = "encounter-summary-grounded.v0.3";

const ClaimFactSchema = z
  .object({
    claimId: z.string().min(1),
    measurementCode: z.string().min(1),
    label: z.string().min(1),
    modality: z.enum(["speech", "face"]),
    statement: z.string().min(1),
    currentValue: z.number(),
    unit: z.string().min(1),
    supportRefs: z.array(z.string().min(1)).min(1),
    eventIds: z.array(z.string().min(1)).min(1),
    allowedNumbers: z.array(z.string())
  })
  .strict();

export const EvidenceAgentRequestSchema = z
  .object({
    containsPHI: z.literal(false),
    visitId: z.string().min(1),
    qualitySummary: z
      .object({
        speechWindowCount: z.number().int().nonnegative(),
        faceWindowCount: z.number().int().nonnegative(),
        abstentionCount: z.number().int().nonnegative(),
        qualityTransitionCount: z.number().int().nonnegative(),
        audioFrameCount: z.number().int().nonnegative(),
        speechActiveFrameCount: z.number().int().nonnegative(),
        pitchedFrameCount: z.number().int().nonnegative(),
        pitchCoverage: z.number().min(0).max(1),
        faceFrameCount: z.number().int().nonnegative(),
        usableFaceFrameCount: z.number().int().nonnegative(),
        usableFaceFraction: z.number().min(0).max(1),
        faceWithholdingDurationMs: z.number().nonnegative(),
        faceRecoveryObserved: z.boolean(),
        postRecoveryFaceWindowCount: z.number().int().nonnegative()
      })
      .strict(),
    facts: z.array(ClaimFactSchema).length(2)
  })
  .strict();

export type EvidenceAgentRequest = z.infer<
  typeof EvidenceAgentRequestSchema
>;

const EvidenceNarrativeDraftSchema = z
  .object({
    headline: z.string().min(1).max(72),
    summary: z.string().min(1).max(240)
  })
  .strict();

export interface EvidenceAgentResult {
  draft: EvidenceCardDraft;
  grounding: GroundingResult;
  model: string;
  promptVersion: string;
  responseId: string;
  attemptCount: number;
  timing: EvidenceSynthesisTiming;
}

interface ResponsesClient {
  responses: {
    parse: OpenAI["responses"]["parse"];
  };
}

let sharedClient: OpenAI | undefined;

function defaultClient(): OpenAI {
  sharedClient ??= new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    timeout: 15_000,
    maxRetries: 0
  });
  return sharedClient;
}

function systemPrompt(validationErrors: string[] = []): string {
  const retryInstruction =
    validationErrors.length === 0
      ? ""
      : `\nA prior draft failed validation. Correct only these errors:\n- ${validationErrors.join("\n- ")}`;
  return `Draft one concise Neurotrax clinician encounter narrative from current-encounter structured facts.

Requirements:
- Return only a direct headline and a one-sentence summary.
- The summary must name both measurement labels.
- Do not put numbers in the headline or summary.
- Do not infer diagnosis, disease, progression, cause, treatment, medication effect, risk, normality, worsening, or improvement.
- Describe only what was measured during the current encounter.
- Do not restate or invent evidence claims; the application attaches its pre-grounded claims separately.
- Return only the required structured output.${retryInstruction}`;
}

function userPayload(input: EvidenceAgentRequest): string {
  return JSON.stringify({
    quality: {
      speechWindowCount: input.qualitySummary.speechWindowCount,
      faceWindowCount: input.qualitySummary.faceWindowCount,
      abstentionCount: input.qualitySummary.abstentionCount,
      faceRecoveryObserved: input.qualitySummary.faceRecoveryObserved
    },
    measurements: input.facts.map((fact) => ({
      label: fact.label,
      modality: fact.modality
    }))
  });
}

export async function runEvidenceAgent(
  inputValue: unknown,
  client: ResponsesClient = defaultClient()
): Promise<EvidenceAgentResult> {
  const totalStartedAt = performance.now();
  const input = EvidenceAgentRequestSchema.parse(inputValue);
  let validationErrors: string[] = [];
  let modelMs = 0;
  let validationMs = 0;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const modelStartedAt = performance.now();
    const response = await client.responses.parse({
      model: EVIDENCE_MODEL,
      service_tier: "priority",
      store: false,
      max_output_tokens: 96,
      reasoning: { effort: "none" },
      text: {
        verbosity: "low",
        format: zodTextFormat(
          EvidenceNarrativeDraftSchema,
          "neurotrax_encounter_narrative"
        )
      },
      input: [
        { role: "system", content: systemPrompt(validationErrors) },
        { role: "user", content: userPayload(input) }
      ]
    });
    modelMs += performance.now() - modelStartedAt;

    const narrative = response.output_parsed;
    if (!narrative) {
      validationErrors = [
        "The model returned no parsed encounter narrative."
      ];
      if (attempt === 2) {
        throw new Error(validationErrors[0]);
      }
      continue;
    }

    const validationStartedAt = performance.now();
    const draft = assembleEvidenceCardDraft(
      narrative,
      input.facts as EvidenceClaimFact[]
    );
    const grounding = validateEvidenceCardDraft(
      draft,
      input.facts as EvidenceClaimFact[]
    );
    validationMs += performance.now() - validationStartedAt;
    if (grounding.status === "pass") {
      return {
        draft,
        grounding,
        model: response.model,
        promptVersion: EVIDENCE_PROMPT_VERSION,
        responseId: response.id,
        attemptCount: attempt,
        timing: {
          totalMs: Math.round(performance.now() - totalStartedAt),
          modelMs: Math.round(modelMs),
          validationMs: Math.round(validationMs)
        }
      };
    }
    validationErrors = grounding.errors;
  }

  throw new Error(
    `Evidence grounding failed after two attempts: ${validationErrors.join(" ")}`
  );
}
