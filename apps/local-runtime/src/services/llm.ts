import { resolveLlmConfig, type LlmCapability } from "../config.js"

type MessagePart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } }

type ChatMessage = {
  role: "system" | "user" | "assistant"
  content: string | MessagePart[]
}

type ChatCompletionChoice = {
  message?: {
    content?: string | Array<{ type?: string; text?: string }>
  }
}

function extractContent(choice?: ChatCompletionChoice) {
  const content = choice?.message?.content
  if (typeof content === "string") return content
  if (Array.isArray(content)) {
    return content
      .map((item) => item?.text ?? "")
      .join("")
      .trim()
  }
  return ""
}

export async function callOpenAiCompatibleChat(input: {
  capability?: LlmCapability
  model?: string | null
  apiBase?: string | null
  apiKey?: string | null
  system?: string | null
  messages: ChatMessage[]
  temperature?: number
}) {
  const llm = resolveLlmConfig({
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
      stream: false,
    }),
  })

  if (!response.ok) {
    const detail = await response.text()
    throw new Error(`LLM request failed: ${response.status} ${detail}`.trim())
  }

  const payload = await response.json() as { choices?: ChatCompletionChoice[] }
  const text = extractContent(payload.choices?.[0])

  return {
    text,
    llm,
  }
}

export async function callOpenAiCompatibleVision(input: {
  prompt: string
  imageDataUrl: string
  history?: Array<{ role: "user" | "assistant"; content: string }>
  apiBase?: string | null
  apiKey?: string | null
  model?: string | null
}) {
  return callOpenAiCompatibleChat({
    capability: "vision",
    apiBase: input.apiBase,
    apiKey: input.apiKey,
    model: input.model,
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
