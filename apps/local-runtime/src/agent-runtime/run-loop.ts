import { createMessage } from "../services/chat.js"
import { callOpenAiCompatibleChat, streamOpenAiCompatibleChat } from "../services/llm.js"
import { upsertMessageMeta } from "../repositories/message-meta-repo.js"
import { updateRun } from "../repositories/runs-repo.js"
import { dispatchToolCall } from "./tool-dispatcher.js"
import { planNextAction } from "./planner.js"
import type { AgentContext, RuntimeExecutionInput } from "./types.js"
import type { AgentStreamEvent } from "../transport/sse/event-types.js"
import { createPendingProposal, buildProposalDto } from "../proposals/service.js"
import { requiresApproval } from "../proposals/policy.js"
import { getTool } from "../tools/registry.js"

function buildSystemPrompt(context: AgentContext, toolFeedback?: string) {
  return `
You are READMEClaw Local Agent.
Use the provided local context when relevant and answer in concise Chinese unless the user clearly asks otherwise.
Context summary:
${context.summary}
${toolFeedback ? `\nTool results:\n${toolFeedback}` : ""}
`.trim()
}

function normalizeError(error: unknown) {
  if (error instanceof Error) return error
  return new Error(String(error))
}

function abortError() {
  const error = new Error("Run aborted")
  error.name = "AbortError"
  return error
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw abortError()
  }
}

async function emitChunkedText(text: string, emit: (event: AgentStreamEvent) => Promise<void>, signal?: AbortSignal) {
  const chunks = text.match(/.{1,80}/g) ?? [text]
  for (const chunk of chunks) {
    throwIfAborted(signal)
    await emit({ type: "chunk", delta: chunk })
  }
}

export async function executeRunLoop(input: {
  context: AgentContext
  request: RuntimeExecutionInput
  signal?: AbortSignal
  emit: (event: AgentStreamEvent) => Promise<void>
}) {
  let thoughts: string[] = []
  let steps: Array<{ text: string; status: "done" | "running" }> = []
  let citations: Array<Record<string, unknown>> = []
  let finalText = ""

  const appendStep = async (text: string, status: "done" | "running" = "running") => {
    steps = [...steps.filter((item) => item.status !== "running").map((item) => ({ ...item, status: "done" as const })), { text, status }]
    await input.emit({ type: "step", step: text, status })
  }

  const finalize = async (status: "completed" | "waiting_approval", assistantContent: string) => {
    if (assistantContent) {
      const assistantMessage = createMessage({
        threadId: input.request.thread.id,
        role: "assistant",
        content: assistantContent,
        ideState: input.context.ideState,
      })
      upsertMessageMeta({
        messageId: assistantMessage.id,
        runId: input.request.run.id,
        citationsJson: citations.length > 0 ? JSON.stringify(citations) : null,
        thoughtsJson: thoughts.length > 0 ? JSON.stringify(thoughts) : null,
        stepsJson: steps.length > 0 ? JSON.stringify(steps.map((step) => ({ ...step, status: "done" as const }))) : null,
        ideStateJson: input.context.ideState ? JSON.stringify(input.context.ideState) : null,
      })
    }

    updateRun(input.request.run.id, {
      status,
      finishedAt: status === "completed" ? new Date().toISOString() : null,
    })

    await input.emit({
      type: "final",
      response: assistantContent,
      sessionId: input.request.thread.id,
      runId: input.request.run.id,
      citations,
      context_used: {
        scope: input.context.scope,
        status,
        effectiveDocumentId: input.context.effectiveDocumentId,
        effectiveWorkspaceId: input.context.effectiveWorkspaceId,
      },
    })
  }

  try {
    throwIfAborted(input.signal)
    await appendStep("Analyzing request")

    if (input.request.mode === "chat") {
      await input.emit({ type: "thinking", text: "Using direct chat mode." })
      thoughts.push("Using direct chat mode.")
      await appendStep("Drafting response")
      for await (const chunk of streamOpenAiCompatibleChat({
        capability: "chat",
        model: input.request.overrides.model ?? null,
        apiBase: input.request.overrides.apiBase ?? null,
        apiKey: input.request.overrides.apiKey ?? null,
        system: buildSystemPrompt(input.context),
        messages: [
          ...input.request.history.map((item) => ({ role: item.role, content: item.content })),
          { role: "user", content: input.request.userInput },
        ],
        signal: input.signal,
      })) {
        finalText += chunk.delta
        await input.emit({ type: "chunk", delta: chunk.delta })
      }

      steps = steps.map((step) => ({ ...step, status: "done" as const }))
      await finalize("completed", finalText.trim())
      return
    }

    const plan = await planNextAction({
      context: input.context,
      request: input.request,
    })

    if (plan.thinking) {
      thoughts.push(plan.thinking)
      await input.emit({ type: "thinking", text: plan.thinking })
    }

    if (plan.kind === "tool" && plan.tool) {
      const tool = getTool(plan.tool)
      if (!tool) {
        throw new Error(`Unknown tool requested by planner: ${plan.tool}`)
      }

      await appendStep(`Using ${tool.name}`)
      await input.emit({ type: "tool_call", tool: tool.name, args: plan.args ?? {} })

      if (requiresApproval(tool)) {
        const proposal = createPendingProposal({
          runId: input.request.run.id,
          threadId: input.request.thread.id,
          toolName: tool.name,
          actionType: tool.actionType,
          actionTypeLabel: tool.actionTypeLabel,
          title: `Approve ${tool.name}`,
          description: `Agent wants to run \`${tool.name}\` with arguments:\n\n\`\`\`json\n${JSON.stringify(plan.args ?? {}, null, 2)}\n\`\`\``,
          args: plan.args ?? {},
          riskLevel: tool.risk,
        })

        const dto = buildProposalDto(proposal)
        await input.emit({ type: "proposal", proposal: dto })
        await finalize("waiting_approval", "我已经准备好执行这项本地修改，等待你的批准。")
        return
      }

      const { result } = await dispatchToolCall({
        ctx: input.context,
        toolName: tool.name,
        args: plan.args ?? {},
      })

      citations = result.citations ?? []
      await input.emit({ type: "tool_result", tool: tool.name, summary: result.summary })
      await appendStep(`Completed ${tool.name}`, "done")

      const answer = await callOpenAiCompatibleChat({
        capability: "chat",
        model: input.request.overrides.model ?? null,
        apiBase: input.request.overrides.apiBase ?? null,
        apiKey: input.request.overrides.apiKey ?? null,
        system: buildSystemPrompt(input.context, `${result.summary}\n${JSON.stringify(result.data, null, 2)}`),
        messages: [
          ...input.request.history.map((item) => ({ role: item.role, content: item.content })),
          { role: "user", content: input.request.userInput },
        ],
        signal: input.signal,
      })
      finalText = answer.text.trim()
      await emitChunkedText(finalText, input.emit, input.signal)
      steps = steps.map((step) => ({ ...step, status: "done" as const }))
      await finalize("completed", finalText)
      return
    }

    finalText = (plan.answer ?? "").trim()
    if (!finalText) {
      const answer = await callOpenAiCompatibleChat({
        capability: "chat",
        model: input.request.overrides.model ?? null,
        apiBase: input.request.overrides.apiBase ?? null,
        apiKey: input.request.overrides.apiKey ?? null,
        system: buildSystemPrompt(input.context),
        messages: [
          ...input.request.history.map((item) => ({ role: item.role, content: item.content })),
          { role: "user", content: input.request.userInput },
        ],
        signal: input.signal,
      })
      finalText = answer.text.trim()
    }

    await appendStep("Drafting response")
    await emitChunkedText(finalText, input.emit, input.signal)
    steps = steps.map((step) => ({ ...step, status: "done" as const }))
    await finalize("completed", finalText)
  } catch (error) {
    const normalized = normalizeError(error)
    const aborted = normalized.name === "AbortError"
    updateRun(input.request.run.id, {
      status: aborted ? "aborted" : "failed",
      finishedAt: new Date().toISOString(),
    })
    await input.emit({
      type: "error",
      error: normalized.message,
      runId: input.request.run.id,
      sessionId: input.request.thread.id,
    })
  }
}
