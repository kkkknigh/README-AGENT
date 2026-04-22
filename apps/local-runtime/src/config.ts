import { existsSync, readFileSync } from "node:fs"
import { dirname, parse, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import YAML from "yaml"

export interface AppConfig {
  runtime?: {
    host?: string
    port?: number
    dataDir?: string
  }
  frontend?: {
    localRuntimeUrl?: string
  }
  remote?: {
    baseUrl?: string
    accessToken?: string | null
  }
  llm?: {
    apiBase?: string
    apiKey?: string | null
    models?: Partial<Record<LlmCapability, string | {
      model?: string
      apiBase?: string
      apiKey?: string | null
      nativeToolCall?: boolean
    }>>
  }
  mineru?: {
    enabled?: boolean
    baseUrl?: string
    apiKey?: string | null
    model?: string
  }
}

export type LlmCapability = "chat" | "vision" | "translate"

export interface ResolvedLlmConfig {
  provider: string
  model: string | null
  apiBase: string
  apiKey: string | null
  nativeToolCall: boolean
}

export interface ResolvedMineruConfig {
  enabled: boolean
  baseUrl: string
  apiKey: string | null
  model: string | null
}

const currentDir = dirname(fileURLToPath(import.meta.url))

function findRepoRoot(startDir: string) {
  let cursor = startDir
  const filesystemRoot = parse(startDir).root

  while (true) {
    if (existsSync(resolve(cursor, "config.yaml"))) {
      return cursor
    }

    if (cursor === filesystemRoot) {
      return startDir
    }

    cursor = dirname(cursor)
  }
}

export const repoRoot = findRepoRoot(currentDir)
export const configPath = resolve(repoRoot, "config.yaml")

function parseConfigFile(): AppConfig {
  if (!existsSync(configPath)) {
    return {}
  }

  const raw = readFileSync(configPath, "utf8")
  const parsed = YAML.parse(raw)
  if (!parsed || typeof parsed !== "object") {
    return {}
  }

  return parsed as AppConfig
}

export const appConfig = parseConfigFile()

export function getRuntimePort() {
  return Number(appConfig.runtime?.port ?? 4242)
}

export function getRuntimeHost() {
  return String(appConfig.runtime?.host ?? "127.0.0.1")
}

export function getRuntimeDataDir() {
  return String(appConfig.runtime?.dataDir ?? "app-data")
}

function getLlmProviderDefaults(capability: LlmCapability) {
  const llm = appConfig.llm
  const sceneConfig = llm?.models?.[capability]
  const sceneObject = sceneConfig && typeof sceneConfig === "object" ? sceneConfig : null
  const sceneModel = typeof sceneConfig === "string" ? sceneConfig : sceneObject?.model ?? null

  return {
    model: sceneModel,
    apiBase: sceneObject?.apiBase ?? llm?.apiBase ?? null,
    apiKey: sceneObject?.apiKey ?? llm?.apiKey ?? null,
    nativeToolCall: sceneObject?.nativeToolCall ?? false,
  }
}

export function resolveLlmConfig(input?: {
  capability?: LlmCapability
  model?: string | null
  apiBase?: string | null
  apiKey?: string | null
}): ResolvedLlmConfig {
  const capability = input?.capability ?? "chat"
  const capabilityDefaults = getLlmProviderDefaults(capability)

  return {
    provider: "openai-compatible",
    model: input?.model?.trim() || capabilityDefaults.model,
    apiBase: input?.apiBase?.trim() || capabilityDefaults.apiBase || "",
    apiKey: input?.apiKey?.trim() || capabilityDefaults.apiKey || null,
    nativeToolCall: capabilityDefaults.nativeToolCall,
  }
}

export function getMineruConfig(): ResolvedMineruConfig {
  const mineru = appConfig.mineru
  const baseUrl = mineru?.baseUrl?.trim() || ""
  const apiKey = mineru?.apiKey?.trim() || null
  const model = mineru?.model?.trim() || null
  const enabled = mineru?.enabled ?? Boolean(baseUrl && apiKey)

  return {
    enabled,
    baseUrl,
    apiKey,
    model,
  }
}
