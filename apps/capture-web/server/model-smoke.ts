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
  qualitySummary: {
    speechWindowCount: 1,
    faceWindowCount: 2,
    abstentionCount: 1,
    qualityTransitionCount: 4,
    audioFrameCount: 60,
    speechActiveFrameCount: 48,
    pitchedFrameCount: 42,
    pitchCoverage: 0.875,
    faceFrameCount: 60,
    usableFaceFrameCount: 48,
    usableFaceFraction: 0.8,
    faceWithholdingDurationMs: 1000,
    faceRecoveryObserved: true,
    postRecoveryFaceWindowCount: 1
  },
  facts: [
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
      eventIds: ["measurement-face", "face-restored"],
      allowedNumbers: ["0.04"]
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
