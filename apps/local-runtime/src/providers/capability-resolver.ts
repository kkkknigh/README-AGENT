import { resolveLlmConfig, type LlmCapability } from "../config.js"

export function resolveProviderConfig(input?: {
  capability?: LlmCapability
  model?: string | null
  apiBase?: string | null
  apiKey?: string | null
}) {
  return resolveLlmConfig(input)
}

export function supportsNativeToolCall(input?: {
  capability?: LlmCapability
  model?: string | null
  apiBase?: string | null
  apiKey?: string | null
}) {
  return resolveProviderConfig(input).nativeToolCall
}
