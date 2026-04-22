import type { LlmCapability, ResolvedLlmConfig } from "../config.js"

export type MessagePart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } }

export interface ProviderChatMessage {
  role: "system" | "user" | "assistant"
  content: string | MessagePart[]
}

export interface StreamChatInput {
  capability?: LlmCapability
  model?: string | null
  apiBase?: string | null
  apiKey?: string | null
  system?: string | null
  messages: ProviderChatMessage[]
  temperature?: number
  signal?: AbortSignal
}

export interface ChatCompletionResult {
  text: string
  llm: ResolvedLlmConfig
}

export interface ChatStreamChunk {
  delta: string
}
