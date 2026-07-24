import { z } from "zod";

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const relativeAssetSchema = z.object({
  path: z.string().min(1).refine(
    (path) => !path.startsWith("/") && !path.includes(".."),
    "Asset paths must remain below the application base URL."
  ),
  sha256: sha256Schema
});

export const staticAssetManifestSchema = z.object({
  schemaVersion: z.literal("phenometric.static-assets.v1"),
  assets: z.object({
    faceModel: relativeAssetSchema,
    voiceWorklet: relativeAssetSchema,
    visionWasmScript: relativeAssetSchema,
    visionWasm: relativeAssetSchema,
    visionWasmSimdScript: relativeAssetSchema,
    visionWasmSimd: relativeAssetSchema,
    visionWasmNoSimdScript: relativeAssetSchema,
    visionWasmNoSimd: relativeAssetSchema
  })
});

export type StaticAssetManifest = z.infer<typeof staticAssetManifestSchema>;

export interface ResolvedStaticAssets {
  readonly manifest: StaticAssetManifest;
  readonly faceModelUrl: string;
  readonly voiceWorkletUrl: string;
  readonly mediaPipeRootUrl: string;
  readonly verifiedUrls: Readonly<Record<keyof StaticAssetManifest["assets"], string>>;
}

function baseUrl(documentBase: string): URL {
  return new URL("./", documentBase);
}

export function resolveAssetUrl(path: string, documentBase: string): string {
  return new URL(path, baseUrl(documentBase)).href;
}

export async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

export async function verifyStaticAsset(
  asset: z.infer<typeof relativeAssetSchema>,
  documentBase: string,
  fetcher: typeof fetch = fetch
): Promise<string> {
  const url = resolveAssetUrl(asset.path, documentBase);
  const response = await fetcher(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`asset-unavailable:${asset.path}`);
  const actual = await sha256Hex(await response.arrayBuffer());
  if (actual !== asset.sha256) {
    throw new Error(`asset-integrity-failed:${asset.path}`);
  }
  return url;
}

export async function loadAndVerifyStaticAssets(
  documentBase: string,
  fetcher: typeof fetch = fetch
): Promise<ResolvedStaticAssets> {
  const manifestUrl = resolveAssetUrl("asset-manifest.json", documentBase);
  const response = await fetcher(manifestUrl, { cache: "no-store" });
  if (!response.ok) throw new Error("asset-manifest-unavailable");
  const manifest = staticAssetManifestSchema.parse(await response.json());
  const entries = Object.entries(manifest.assets) as Array<
    [keyof StaticAssetManifest["assets"], z.infer<typeof relativeAssetSchema>]
  >;
  const verifiedEntries = await Promise.all(
    entries.map(async ([name, asset]) => [
      name,
      await verifyStaticAsset(asset, documentBase, fetcher)
    ] as const)
  );
  const verifiedUrls = Object.freeze(
    Object.fromEntries(verifiedEntries) as Record<
      keyof StaticAssetManifest["assets"],
      string
    >
  );
  return Object.freeze({
    manifest,
    faceModelUrl: verifiedUrls.faceModel,
    voiceWorkletUrl: verifiedUrls.voiceWorklet,
    mediaPipeRootUrl: resolveAssetUrl("mediapipe", documentBase),
    verifiedUrls
  });
}
