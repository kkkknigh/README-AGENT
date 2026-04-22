import { resolveProviderConfig } from "./capability-resolver.js"
import type { ChatCompletionResult, ChatStreamChunk, StreamChatInput } from "./types.js"

type ChatCompletionChoice = {
  message?: {
    content?: string | Array<{ type?: string; text?: string }>
  }
  delta?: {
    content?: string | Array<{ type?: string; text?: string }>
  }
}

function extractContent(choice?: ChatCompletionChoice) {
  const content = choice?.message?.content ?? choice?.delta?.content
  if (typeof content === "string") return content
  if (Array.isArray(content)) {
    return content.map((item) => item?.text ?? "").join("")
  }
  return ""
}

async function requestChat(input: StreamChatInput & { stream: boolean }) {
  const llm = resolveProviderConfig({
    capability: input.capability ?? "chat",
    model: input.model,
    apiBase: input.apiBase,
    apiKey: input.apiKey,
  })

  if (!llm.apiBase) {
    throw new Error(`LLM provider "${llm.provider}" is missing apiBase in config.yaml`)
  }
  if (!llm.apiKey) {
    throw new Error(`LLM provider "${llm.provider}" is missing apiKey in config.yaml`)
  }
  if (!llm.model) {
    throw new Error(`LLM provider "${llm.provider}" is missing model in config.yaml`)
  }

  const response = await fetch(`${llm.apiBase.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${llm.apiKey}`,
    },
    body: JSON.stringify({
      model: llm.model,
      messages: [
        ...(input.system?.trim() ? [{ role: "system", content: input.system.trim() }] : []),
        ...input.messages,
      ],
      temperature: input.temperature ?? 0.2,
      stream: input.stream,
    }),
    signal: input.signal,
  })

  if (!response.ok) {
    const detail = await response.text()
    throw new Error(`LLM request failed: ${response.status} ${detail}`.trim())
  }

  return { response, llm }
}

export async function callOpenAiCompatibleChat(input: StreamChatInput): Promise<ChatCompletionResult> {
  const { response, llm } = await requestChat({ ...input, stream: false })
  const payload = await response.json() as { choices?: ChatCompletionChoice[] }
  return {
    text: extractContent(payload.choices?.[0]).trim(),
    llm,
  }
}

export async function* streamOpenAiCompatibleChat(input: StreamChatInput): AsyncGenerator<ChatStreamChunk> {
  const { response } = await requestChat({ ...input, stream: true })
  if (!response.body) {
    throw new Error("LLM stream response body is empty")
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const parts = buffer.split("\n\n")
    buffer = parts.pop() ?? ""

    for (const part of parts) {
      const lines = part.split("\n").filter((line) => line.startsWith("data: "))
      for (const line of lines) {
        const raw = line.slice(6).trim()
        if (!raw || raw === "[DONE]") continue
        const payload = JSON.parse(raw) as { choices?: ChatCompletionChoice[] }
        const delta = extractContent(payload.choices?.[0])
        if (delta) {
          yield { delta }
        }
      }
    }
  }
}
