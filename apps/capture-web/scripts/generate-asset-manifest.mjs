import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const publicRoot = new URL("../public/", import.meta.url);
const manifestUrl = new URL("asset-manifest.json", publicRoot);
const assetPaths = {
  faceModel: "models/face_landmarker.task",
  voiceWorklet: "voice-capture-worklet.js",
  visionWasmScript: "mediapipe/vision_wasm_internal.js",
  visionWasm: "mediapipe/vision_wasm_internal.wasm",
  visionWasmSimdScript: "mediapipe/vision_wasm_module_internal.js",
  visionWasmSimd: "mediapipe/vision_wasm_module_internal.wasm",
  visionWasmNoSimdScript: "mediapipe/vision_wasm_nosimd_internal.js",
  visionWasmNoSimd: "mediapipe/vision_wasm_nosimd_internal.wasm"
};

const assets = Object.fromEntries(
  await Promise.all(
    Object.entries(assetPaths).map(async ([name, path]) => {
      const bytes = await readFile(new URL(path, publicRoot));
      return [
        name,
        {
          path,
          sha256: createHash("sha256").update(bytes).digest("hex")
        }
      ];
    })
  )
);
const serialized = `${JSON.stringify(
  { schemaVersion: "phenometric.static-assets.v1", assets },
  null,
  2
)}\n`;

if (process.argv.includes("--check")) {
  const current = await readFile(manifestUrl, "utf8");
  if (current !== serialized) {
    throw new Error(
      "Static asset manifest is stale. Run the capture-web build to regenerate it."
    );
  }
} else {
  await writeFile(manifestUrl, serialized, "utf8");
}
