import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import type {
  EvidenceCardDraft,
  EvidenceSynthesisTiming,
  GroundingResult,
  ModalityOutcome
} from "@phenometric/contracts";
import {
  assembleEvidenceCardDraft,
  validateEvidenceCardDraft
} from "../../../packages/evidence-core/src/evidence.ts";

export const EVIDENCE_MODEL = "gpt-5.6-luna";
export const EVIDENCE_PROMPT_VERSION = "encounter-summary-grounded.v0.4";

const ModalityOutcomeBaseSchema = z.object({
  outcomeId: z.string().min(1),
  label: z.string().min(1),
  modality: z.enum(["speech", "face"]),
  statement: z.string().min(1),
  qualityFacts: z.record(
    z.string(),
    z.union([z.string(), z.number(), z.boolean()])
  ),
  supportRefs: z.array(z.string().min(1)).min(1),
  eventIds: z.array(z.string().min(1)).min(1)
});

const MeasuredOutcomeSchema = ModalityOutcomeBaseSchema.extend({
  status: z.literal("measured"),
  measurementCode: z.string().min(1),
  currentValue: z.number(),
  unit: z.string().min(1),
  allowedNumbers: z.array(z.string())
}).strict();

const WithheldOutcomeSchema = ModalityOutcomeBaseSchema.extend({
  status: z.literal("withheld"),
  reasonCode: z.string().min(1)
}).strict();

const ModalityOutcomeSchema = z.discriminatedUnion("status", [
  MeasuredOutcomeSchema,
  WithheldOutcomeSchema
]);

const QualitySummarySchema = z
  .object({
    speechWindowCount: z.number().int().nonnegative(),
    faceWindowCount: z.number().int().nonnegative(),
    abstentionCount: z.number().int().nonnegative(),
    qualityTransitionCount: z.number().int().nonnegative(),
    audioFrameCount: z.number().int().nonnegative(),
    speechActiveFrameCount: z.number().int().nonnegative(),
    pitchedFrameCount: z.number().int().nonnegative(),
    pitchCoverage: z.number().min(0).max(1),
    audioLostBlockFraction: z.number().min(0).max(1),
    maximumAudioBlockGapMs: z.number().nonnegative(),
    medianAudioSnrDb: z.number(),
    faceFrameCount: z.number().int().nonnegative(),
    usableFaceFrameCount: z.number().int().nonnegative(),
    usableFaceFraction: z.number().min(0).max(1),
    faceWithholdingDurationMs: z.number().nonnegative(),
    faceRecoveryObserved: z.boolean(),
    postRecoveryFaceWindowCount: z.number().int().nonnegative()
  })
  .strict();

export const EvidenceAgentRequestSchema = z
  .object({
    containsPHI: z.literal(false),
    rawMediaRetained: z.literal(false),
    rawAudioRetained: z.literal(false),
    nativeAudioObservationsRetained: z.literal(false),
    transcriptRetained: z.literal(false),
    voiceEmbeddingsRetained: z.literal(false),
    nativeVisualObservationsRetained: z.literal(false),
    visitId: z.string().min(1),
    qualitySummary: QualitySummarySchema,
    outcomes: z.array(ModalityOutcomeSchema).min(1).max(2)
  })
  .strict()
  .superRefine((value, context) => {
    if (
      new Set(value.outcomes.map((outcome) => outcome.modality)).size !==
      value.outcomes.length
    ) {
      context.addIssue({
        code: "custom",
        message: "Participating modality outcomes must be unique.",
        path: ["outcomes"]
      });
    }
  });

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
  return `Draft one concise, EHR-ready PhenoMetric encounter report from the successfully measured current-encounter metrics.

Requirements:
- Return only a direct headline and a one-sentence summary.
- Mention every supplied measurement label.
- Do not mention a modality that is not supplied as a measurement.
- Do not mention withholding, unavailability, insufficient signal, or acquisition failure.
- Do not put numbers in the headline or summary.
- Do not infer diagnosis, disease, progression, cause, treatment, medication effect, risk, normality, worsening, or improvement.
- Describe only the successfully measured metrics from this encounter.
- Do not restate or invent evidence statements; the application attaches its pre-grounded outcomes separately.
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
    measurements: input.outcomes
      .filter((outcome) => outcome.status === "measured")
      .map((outcome) => ({
        label: outcome.label,
        modality: outcome.modality
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
          "phenometric_encounter_narrative"
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
      input.outcomes as ModalityOutcome[]
    );
    const grounding = validateEvidenceCardDraft(
      draft,
      input.outcomes as ModalityOutcome[]
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
