import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";
import { evidenceAgentPlugin } from "./server/vite-evidence-plugin.js";
import { mediapipeAssetsPlugin } from "./server/mediapipe-assets-plugin.js";

export default defineConfig(({ mode }) => {
  const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));
  const environment = loadEnv(mode, repositoryRoot, "");
  const environmentKey = environment.OPENAI_API_KEY?.trim();
  if (!process.env.OPENAI_API_KEY && environmentKey) {
    process.env.OPENAI_API_KEY = environmentKey;
  }

  return {
    envDir: repositoryRoot,
    plugins: [mediapipeAssetsPlugin(), evidenceAgentPlugin()],
    server: {
      host: "127.0.0.1",
      port: 4173,
      strictPort: true
    },
    preview: {
      host: "127.0.0.1",
      port: 4173,
      strictPort: true
    }
  };
});
