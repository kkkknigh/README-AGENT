import {
  callOpenAiCompatibleChat as callProviderChat,
  streamOpenAiCompatibleChat as streamProviderChat,
  type ProviderChatMessage,
} from "../providers/index.js"
import type { LlmCapability } from "../config.js"

export type MessagePart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } }

type ChatMessage = ProviderChatMessage

export async function callOpenAiCompatibleChat(input: {
  capability?: LlmCapability
  model?: string | null
  apiBase?: string | null
  apiKey?: string | null
  system?: string | null
  messages: ChatMessage[]
  temperature?: number
  signal?: AbortSignal
}) {
  return callProviderChat(input)
}

export async function* streamOpenAiCompatibleChat(input: {
  capability?: LlmCapability
  model?: string | null
  apiBase?: string | null
  apiKey?: string | null
  system?: string | null
  messages: ChatMessage[]
  temperature?: number
  signal?: AbortSignal
}) {
  yield* streamProviderChat(input)
}

export async function callOpenAiCompatibleVision(input: {
  prompt: string
  imageDataUrl: string
  history?: Array<{ role: "user" | "assistant"; content: string }>
  apiBase?: string | null
  apiKey?: string | null
  model?: string | null
  signal?: AbortSignal
}) {
  return callProviderChat({
    capability: "vision",
    apiBase: input.apiBase,
    apiKey: input.apiKey,
    model: input.model,
    signal: input.signal,
    messages: [
      ...(input.history ?? []).map((item) => ({
        role: item.role,
        content: item.content,
      })),
      {
        role: "user",
        content: [
          { type: "text", text: input.prompt },
          { type: "image_url", image_url: { url: input.imageDataUrl } },
        ],
      },
    ],
    temperature: 0.2,
  })
}
