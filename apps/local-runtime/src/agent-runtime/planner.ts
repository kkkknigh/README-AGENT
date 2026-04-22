import { callOpenAiCompatibleChat } from "../services/llm.js"
import { parseJsonObject } from "../providers/index.js"
import type { AgentContext, PlanningResult, RuntimeExecutionInput } from "./types.js"
import { toolRegistry } from "../tools/registry.js"

function buildPlanningPrompt(input: {
  context: AgentContext
  request: RuntimeExecutionInput
  toolFeedback?: string
}) {
  const tools = toolRegistry.map((tool) => ({
    name: tool.name,
    description: tool.description,
    risk: tool.risk,
    requiresApproval: tool.requiresApproval,
  }))

  return `
You are READMEClaw Local Agent.
Decide whether to answer directly or request one tool.
Return strict JSON only, with one of these shapes:
{"kind":"answer","thinking":"brief reason","answer":"final answer text"}
{"kind":"tool","thinking":"brief reason","tool":"tool.name","args":{"key":"value"}}

Rules:
- Prefer direct answers for simple conversational requests.
- Use tools when the user asks for local document/workspace/library/notes/kg facts or local edits.
- If the request implies edits, choose the mutating tool instead of pretending it was done.
- Do not invent tool names.

Context summary:
${input.context.summary}

Available tools:
${JSON.stringify(tools, null, 2)}

${input.toolFeedback ? `Tool feedback available:\n${input.toolFeedback}\n` : ""}
`.trim()
}

export async function planNextAction(input: {
  context: AgentContext
  request: RuntimeExecutionInput
  toolFeedback?: string
}) {
  const result = await callOpenAiCompatibleChat({
    capability: "chat",
    model: input.request.overrides.model ?? null,
    apiBase: input.request.overrides.apiBase ?? null,
    apiKey: input.request.overrides.apiKey ?? null,
    system: buildPlanningPrompt(input),
    temperature: 0,
    messages: [
      ...input.request.history.map((item) => ({
        role: item.role,
        content: item.content,
      })),
      {
        role: "user",
        content: input.request.userInput,
      },
    ],
  })

  return parseJsonObject<PlanningResult>(result.text)
}
