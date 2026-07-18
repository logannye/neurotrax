import {
  EVIDENCE_MODEL,
  runEvidenceAgent
} from "./evidence-agent.js";
import { fileURLToPath } from "node:url";
import { loadEnv } from "vite";

const repositoryRoot = fileURLToPath(new URL("../../..", import.meta.url));
const environmentKey = loadEnv(
  "development",
  repositoryRoot,
  ""
).OPENAI_API_KEY?.trim();
if (!process.env.OPENAI_API_KEY && environmentKey) {
  process.env.OPENAI_API_KEY = environmentKey;
}

if (!process.env.OPENAI_API_KEY) {
  throw new Error(
    "OPENAI_API_KEY is not set. Export it before running pnpm demo:smoke."
  );
}

const result = await runEvidenceAgent({
  containsPHI: false,
  visitId: "smoke-visit",
  comparisonId: "smoke-comparison",
  syntheticHistory: true,
  includesAcceptedSessionHistory: false,
  qualitySummary: {
    speechWindowCount: 1,
    faceWindowCount: 1,
    abstentionCount: 0,
    qualityTransitionCount: 2
  },
  excludedEncounters: [
    {
      encounterId: "synthetic-old-version",
      reasonCodes: ["algorithm-version-mismatch"]
    }
  ],
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
      supportRefs: ["speech-0", "synthetic-history:pitch"],
      eventIds: ["trajectory-comparison-completed"],
      allowedNumbers: ["1.9"]
    }
  ]
});

process.stdout.write(
  JSON.stringify(
    {
      ok: true,
      requestedModel: EVIDENCE_MODEL,
      returnedModel: result.model,
      grounding: result.grounding.status,
      responseId: result.responseId
    },
    null,
    2
  ) + "\n"
);
