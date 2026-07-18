import type { IncomingMessage, ServerResponse } from "node:http";
import type { Connect, Plugin } from "vite";
import {
  runEvidenceAgent
} from "./evidence-agent.js";
import { EVIDENCE_SMOKE_REQUEST } from "./evidence-fixture.js";

const MAX_REQUEST_BYTES = 256_000;
let warmupPromise: ReturnType<typeof runEvidenceAgent> | undefined;

export function hasEvidenceCredential(
  environment: NodeJS.ProcessEnv = process.env
): boolean {
  const value = environment.OPENAI_API_KEY?.trim();
  return Boolean(value && value !== "undefined" && value !== "null");
}

function json(
  response: ServerResponse,
  statusCode: number,
  value: unknown
): void {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.end(JSON.stringify(value));
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_REQUEST_BYTES) {
      throw new Error("Evidence request exceeded 256 KB.");
    }
    chunks.push(buffer);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  return text.length === 0 ? {} : JSON.parse(text);
}

export function evidenceAgentPlugin(): Plugin {
  const install = (middlewares: Connect.Server): void => {
    middlewares.use(
      "/api/model-readiness",
      async (request, response) => {
        if (request.method !== "GET") {
          json(response, 405, { error: "Method not allowed." });
          return;
        }
        if (!hasEvidenceCredential()) {
          json(response, 200, { ready: false });
          return;
        }
        if (process.env.NEUROTRAX_SKIP_SYNTHESIS_WARMUP === "1") {
          json(response, 200, { ready: true, warmupSkipped: true });
          return;
        }

        try {
          warmupPromise ??= runEvidenceAgent(EVIDENCE_SMOKE_REQUEST);
          const result = await warmupPromise;
          response.setHeader(
            "Server-Timing",
            `synthesis-warmup;dur=${result.timing.totalMs}`
          );
          json(response, 200, {
            ready: true,
            warmupMs: result.timing.totalMs
          });
        } catch {
          warmupPromise = undefined;
          json(response, 503, {
            ready: false,
            error: "Clinical synthesis unavailable."
          });
        }
      }
    );

    middlewares.use(
      "/api/evidence-card",
      async (request, response) => {
        if (request.method !== "POST") {
          json(response, 405, { error: "Method not allowed." });
          return;
        }
        if (!hasEvidenceCredential()) {
          json(response, 503, {
            error:
              "OPENAI_API_KEY is required for evidence synthesis. No fallback is configured."
          });
          return;
        }

        try {
          const payload = await readJson(request);
          const result = await runEvidenceAgent(payload);
          response.setHeader(
            "Server-Timing",
            `clinical-synthesis;dur=${result.timing.totalMs}`
          );
          json(response, 200, result);
        } catch (error) {
          const message =
            error instanceof Error
              ? error.message
              : "Evidence synthesis failed.";
          json(response, 422, { error: message });
        }
      }
    );
  };

  return {
    name: "neurotrax-evidence-agent",
    configureServer(server) {
      install(server.middlewares);
    },
    configurePreviewServer(server) {
      install(server.middlewares);
    }
  };
}
