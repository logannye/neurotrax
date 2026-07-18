import type { IncomingMessage, ServerResponse } from "node:http";
import type { Connect, Plugin } from "vite";
import {
  EVIDENCE_MODEL,
  runEvidenceAgent
} from "./evidence-agent.js";

const MAX_REQUEST_BYTES = 256_000;

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
      (request, response) => {
        if (request.method !== "GET") {
          json(response, 405, { error: "Method not allowed." });
          return;
        }
        json(response, 200, {
          ready: hasEvidenceCredential(),
          model: EVIDENCE_MODEL,
          credentialSource: hasEvidenceCredential()
            ? "server-environment"
            : "missing"
        });
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
