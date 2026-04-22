import type { WorkbenchContextDto } from "@readmeclaw/shared-ui"
import { getThread } from "../services/chat.js"
import { listMessages } from "../services/chat.js"
import { buildDocumentContext } from "../context/document-context.js"
import { buildGlobalContext } from "../context/global-context.js"
import { buildWorkspaceContext } from "../context/workspace-context.js"
import type { AgentContext } from "./types.js"

function getLatestIdeState(threadId: string): WorkbenchContextDto | null {
  const messages = listMessages(threadId)
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const ideState = messages[index]?.ideState
    if (ideState) return ideState
  }
  return null
}

function buildIdeStateSummary(ideState: WorkbenchContextDto | null) {
  if (!ideState) return null

  const parts: string[] = []
  const openTabs = Array.isArray(ideState.openTabs) ? ideState.openTabs : []
  if (ideState.currentReadingDocumentId) {
    parts.push(`Current reading document id: ${ideState.currentReadingDocumentId}.`)
  }
  if (ideState.activeTabTitle || ideState.activeResourceType) {
    parts.push(`Active tab: ${ideState.activeTabTitle ?? ideState.activeTabId ?? "unknown"} (${ideState.activeResourceType ?? "unknown"}).`)
  }
  if (openTabs.length > 0) {
    const labels = openTabs
      .slice(0, 6)
      .map((tab) => `${tab.title} [${tab.type}]`)
      .join(", ")
    parts.push(`Open tabs: ${labels}${openTabs.length > 6 ? ", ..." : ""}.`)
  }

  return parts.length > 0 ? parts.join(" ") : null
}

export function buildThreadContext(threadId: string, ideStateOverride?: WorkbenchContextDto | null): AgentContext {
  const thread = getThread(threadId)
  if (!thread) {
    throw new Error("Thread not found")
  }

  const ideState = ideStateOverride ?? getLatestIdeState(threadId)
  const global = buildGlobalContext()
  const effectiveWorkspaceId = ideState?.workspaceId ?? thread.workspaceId ?? null
  const effectiveDocumentId =
    ideState?.currentReadingDocumentId ??
    ideState?.documentRemoteId ??
    thread.documentRemoteId ??
    null
  const workspace = effectiveWorkspaceId ? buildWorkspaceContext(effectiveWorkspaceId) : undefined
  const document = effectiveDocumentId ? buildDocumentContext(effectiveDocumentId) : undefined
  const summary = [
    global.summary,
    workspace?.summary ?? null,
    document?.summary ?? null,
    buildIdeStateSummary(ideState ?? null),
  ]
    .filter((item): item is string => Boolean(item))
    .join("\n")

  return {
    scope: document ? "document" : workspace ? "workspace" : "global",
    thread,
    ideState: ideState ?? null,
    effectiveWorkspaceId,
    effectiveDocumentId,
    global,
    workspace,
    document,
    summary,
  }
}
