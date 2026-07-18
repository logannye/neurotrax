import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import type {
  EvidenceCardDraft,
  EvidenceClaimFact,
  GroundingResult
} from "@neurotrax/contracts";
import {
  EVIDENCE_BOUNDARY,
  validateEvidenceCardDraft
} from "../../../packages/evidence-core/src/evidence.ts";

export const EVIDENCE_MODEL = "gpt-5.6";
export const EVIDENCE_PROMPT_VERSION = "evidence-card-grounded.v0.1";

const ClaimFactSchema = z
  .object({
    claimId: z.string().min(1),
    measurementCode: z.string().min(1),
    label: z.string().min(1),
    direction: z.enum([
      "within-reference",
      "above-reference",
      "below-reference",
      "not-comparable"
    ]),
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
    comparisonId: z.string().min(1),
    syntheticHistory: z.literal(true),
    includesAcceptedSessionHistory: z.boolean(),
    qualitySummary: z
      .object({
        speechWindowCount: z.number().int().nonnegative(),
        faceWindowCount: z.number().int().nonnegative(),
        abstentionCount: z.number().int().nonnegative(),
        qualityTransitionCount: z.number().int().nonnegative()
      })
      .strict(),
    excludedEncounters: z.array(
      z
        .object({
          encounterId: z.string().min(1),
          reasonCodes: z.array(z.string().min(1))
        })
        .strict()
    ),
    facts: z.array(ClaimFactSchema).min(1).max(2)
  })
  .strict();

export type EvidenceAgentRequest = z.infer<
  typeof EvidenceAgentRequestSchema
>;

const EvidenceCardDraftSchema = z
  .object({
    headline: z.string().min(1).max(90),
    summary: z.string().min(1).max(360),
    claims: z
      .array(
        z
          .object({
            claimId: z.string().min(1),
            statement: z.string().min(1)
          })
          .strict()
      )
      .min(1)
      .max(2),
    boundaryStatement: z.literal(EVIDENCE_BOUNDARY)
  })
  .strict();

export interface EvidenceAgentResult {
  draft: EvidenceCardDraft;
  grounding: GroundingResult;
  model: string;
  promptVersion: string;
  responseId: string;
  attemptCount: number;
}

interface ResponsesClient {
  responses: {
    parse: OpenAI["responses"]["parse"];
  };
}

function systemPrompt(validationErrors: string[] = []): string {
  const retryInstruction =
    validationErrors.length === 0
      ? ""
      : `\nA prior draft failed validation. Correct only these errors:\n- ${validationErrors.join("\n- ")}`;
  return `You draft one concise Neurotrax research-prototype evidence card from structured facts.

Requirements:
- Select one or two supplied claim facts.
- Copy each selected claimId and statement exactly. Do not paraphrase claim statements.
- Write a direct headline and a two-sentence-or-shorter summary.
- The summary must name the measurement label for every selected claim.
- Do not put numbers in the headline or summary.
- Do not infer diagnosis, disease, progression, cause, treatment, medication effect, risk, normality, worsening, or improvement.
- Treat checked-in history as synthetic, any disclosed accepted-session history as a non-patient self-demo, and every comparison as a provisional engineering observation.
- Return only the required structured output.
- Preserve this boundary statement exactly: "${EVIDENCE_BOUNDARY}"${retryInstruction}`;
}

function userPayload(input: EvidenceAgentRequest): string {
  return JSON.stringify({
    visitId: input.visitId,
    comparisonId: input.comparisonId,
    historyDisclosure: input.includesAcceptedSessionHistory
      ? "SYNTHETIC FIXTURE + ACCEPTED NON-PATIENT SESSION HISTORY"
      : "SYNTHETIC FIXTURE ONLY",
    qualitySummary: input.qualitySummary,
    excludedEncounters: input.excludedEncounters,
    allowedClaimFacts: input.facts
  });
}

export async function runEvidenceAgent(
  inputValue: unknown,
  client: ResponsesClient = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    timeout: 20_000,
    maxRetries: 0
  })
): Promise<EvidenceAgentResult> {
  const input = EvidenceAgentRequestSchema.parse(inputValue);
  let validationErrors: string[] = [];

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const response = await client.responses.parse({
      model: EVIDENCE_MODEL,
      reasoning: { effort: "low" },
      text: {
        verbosity: "low",
        format: zodTextFormat(
          EvidenceCardDraftSchema,
          "neurotrax_evidence_card"
        )
      },
      input: [
        { role: "system", content: systemPrompt(validationErrors) },
        { role: "user", content: userPayload(input) }
      ]
    });

    const draft = response.output_parsed;
    if (!draft) {
      validationErrors = [
        "The model returned no parsed evidence-card draft."
      ];
      if (attempt === 2) {
        throw new Error(validationErrors[0]);
      }
      continue;
    }

    const grounding = validateEvidenceCardDraft(
      draft,
      input.facts as EvidenceClaimFact[]
    );
    if (grounding.status === "pass") {
      return {
        draft,
        grounding,
        model: response.model,
        promptVersion: EVIDENCE_PROMPT_VERSION,
        responseId: response.id,
        attemptCount: attempt
      };
    }
    validationErrors = grounding.errors;
  }

  throw new Error(
    `Evidence grounding failed after two attempts: ${validationErrors.join(" ")}`
  );
}
