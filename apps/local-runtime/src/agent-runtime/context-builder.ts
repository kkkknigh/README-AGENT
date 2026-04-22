import { getThread } from "../services/chat.js"
import { buildDocumentContext } from "../context/document-context.js"
import { buildGlobalContext } from "../context/global-context.js"
import { buildWorkspaceContext } from "../context/workspace-context.js"
import type { AgentContext } from "./types.js"

export function buildThreadContext(threadId: string): AgentContext {
  const thread = getThread(threadId)
  if (!thread) {
    throw new Error("Thread not found")
  }

  if (thread.scope === "document" && thread.documentRemoteId) {
    const document = buildDocumentContext(thread.documentRemoteId)
    return {
      scope: "document",
      thread,
      document,
      summary: document.summary,
    }
  }

  if (thread.scope === "workspace" && thread.workspaceId) {
    const workspace = buildWorkspaceContext(thread.workspaceId)
    return {
      scope: "workspace",
      thread,
      workspace,
      summary: workspace.summary,
    }
  }

  return {
    scope: "global",
    thread,
    global: buildGlobalContext(),
    summary: buildGlobalContext().summary,
  }
}
