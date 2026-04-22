import type { WorkbenchContextDto } from "@readmeclaw/shared-ui"
import type express from "express"
import { buildThreadContext } from "./context-builder.js"
import { createRunAbortController, clearRunAbortController } from "./abort-controller.js"
import { createMessage, listMessages } from "../services/chat.js"
import { createRun, getRun, listRunsForThread, updateRun } from "../repositories/runs-repo.js"
import { createRunEvent, listRunEvents } from "../repositories/run-events-repo.js"
import { writeSseEvent } from "../transport/sse/event-writer.js"
import type { AgentStreamEvent } from "../transport/sse/event-types.js"
import { executeRunLoop } from "./run-loop.js"

export async function createAndStreamRun(input: {
  res: express.Response
  threadId: string
  mode: "chat" | "agent"
  message: string
  history: Array<{ role: "user" | "assistant"; content: string }>
  overrides: {
    model?: string | null
    apiBase?: string | null
    apiKey?: string | null
  }
  attachedContext?: WorkbenchContextDto | null
}) {
  const context = buildThreadContext(input.threadId, input.attachedContext)
  const history = input.history.length > 0
    ? input.history
    : listMessages(input.threadId)
        .filter((item) => item.role === "user" || item.role === "assistant")
        .map((item) => ({
          role: item.role,
          content: item.content,
        }))
  const run = createRun({
    threadId: input.threadId,
    mode: input.mode,
    status: "running",
    model: input.overrides.model ?? null,
    contextJson: JSON.stringify(context),
  })
  const controller = createRunAbortController(run.id)
  const userMessage = createMessage({
    threadId: input.threadId,
    role: "user",
    content: input.message,
    ideState: input.attachedContext ?? null,
  })

  let seq = 0
  const emit = async (event: AgentStreamEvent) => {
    seq += 1
    createRunEvent({
      runId: run.id,
      seq,
      eventType: event.type,
      payloadJson: JSON.stringify(event),
    })
    writeSseEvent(input.res, event)
  }

  await emit({ type: "run_started", runId: run.id, sessionId: input.threadId })
  await emit({ type: "user_message_ack", userMessageId: userMessage.id })

  await executeRunLoop({
    context,
    request: {
      run,
      thread: context.thread,
      mode: input.mode,
      userMessageId: userMessage.id,
      userInput: input.message,
      history,
      overrides: input.overrides,
      attachedContext: input.attachedContext ?? null,
    },
    signal: controller.signal,
    emit,
  })

  clearRunAbortController(run.id)
  return run
}

export function getRunDetail(runId: string) {
  const run = getRun(runId)
  if (!run) return null
  return {
    id: run.id,
    threadId: run.threadId,
    status: run.status,
    mode: run.mode,
    model: run.model,
    context: JSON.parse(run.contextJson),
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    finishedAt: run.finishedAt,
  }
}

export function getRunEventFeed(runId: string) {
  return listRunEvents(runId).map((event) => ({
    id: event.id,
    seq: event.seq,
    type: event.eventType,
    payload: JSON.parse(event.payloadJson),
    createdAt: event.createdAt,
  }))
}

export function listThreadRuns(threadId: string) {
  return listRunsForThread(threadId)
}

export function markRunAborted(runId: string) {
  return updateRun(runId, {
    status: "aborted",
    finishedAt: new Date().toISOString(),
  })
}
