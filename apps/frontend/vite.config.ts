import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath, URL } from "node:url"
import { defineConfig } from "vite"
import vue from "@vitejs/plugin-vue"
import YAML from "yaml"

const repoRoot = fileURLToPath(new URL("../..", import.meta.url))
const configPath = resolve(repoRoot, "config.yaml")

function loadFrontendRuntimeUrl() {
  if (!existsSync(configPath)) {
    return "http://127.0.0.1:4242"
  }

  const parsed = YAML.parse(readFileSync(configPath, "utf8")) as {
    frontend?: { localRuntimeUrl?: string }
  } | null

  return parsed?.frontend?.localRuntimeUrl ?? "http://127.0.0.1:4242"
}

const configuredRuntimeUrl = loadFrontendRuntimeUrl()

export default defineConfig({
  plugins: [vue()],
  define: {
    __READMECLAW_LOCAL_RUNTIME_URL__: JSON.stringify(configuredRuntimeUrl),
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    port: 4173,
  },
})
