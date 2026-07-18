import {
  EVIDENCE_MODEL,
  runEvidenceAgent
} from "./evidence-agent.js";
import { EVIDENCE_SMOKE_REQUEST } from "./evidence-fixture.js";
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

const result = await runEvidenceAgent(EVIDENCE_SMOKE_REQUEST);

process.stdout.write(
  JSON.stringify(
    {
      ok: true,
      requestedModel: EVIDENCE_MODEL,
      returnedModel: result.model,
      grounding: result.grounding.status,
      responseId: result.responseId,
      timing: result.timing
    },
    null,
    2
  ) + "\n"
);
