import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Connect, Plugin } from "vite";

const RUNTIME_PREFIX = "/mediapipe-runtime/";
const ASSET_DIRECTORY = fileURLToPath(
  new URL("../public/mediapipe/", import.meta.url)
);
const ALLOWED_ASSETS = new Set([
  "vision_wasm_internal.js",
  "vision_wasm_internal.wasm",
  "vision_wasm_module_internal.js",
  "vision_wasm_module_internal.wasm",
  "vision_wasm_nosimd_internal.js",
  "vision_wasm_nosimd_internal.wasm"
]);

function runtimeMiddleware(): Connect.NextHandleFunction {
  return async (request, response, next) => {
    const pathname = new URL(
      request.url ?? "/",
      "http://127.0.0.1"
    ).pathname;
    if (!pathname.startsWith(RUNTIME_PREFIX)) {
      next();
      return;
    }
    const filename = pathname.slice(RUNTIME_PREFIX.length);
    if (!ALLOWED_ASSETS.has(filename)) {
      response.statusCode = 404;
      response.end("Not found");
      return;
    }
    try {
      const body = await readFile(join(ASSET_DIRECTORY, filename));
      response.statusCode = 200;
      response.setHeader(
        "Content-Type",
        extname(filename) === ".wasm"
          ? "application/wasm"
          : "text/javascript; charset=utf-8"
      );
      response.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      response.end(body);
    } catch {
      response.statusCode = 500;
      response.end("MediaPipe runtime asset unavailable.");
    }
  };
}

export function mediapipeAssetsPlugin(): Plugin {
  return {
    name: "neurotrax-mediapipe-runtime-assets",
    configureServer(server) {
      server.middlewares.use(runtimeMiddleware());
    },
    configurePreviewServer(server) {
      server.middlewares.use(runtimeMiddleware());
    }
  };
}
