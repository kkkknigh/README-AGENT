import { Router } from "express"
import type { WorkbenchContextDto, WorkbenchOpenTabSummaryDto, WorkbenchTabType } from "@readmeclaw/shared-ui"
import { abortRun } from "../../agent-runtime/abort-controller.js"
import { createAndStreamRun, getRunDetail, getRunEventFeed, markRunAborted } from "../../agent-runtime/run-service.js"
import { endSse, initSse, writeSseEvent } from "../sse/event-writer.js"

export const runsRouter = Router()

function sanitizeTabType(value: unknown): WorkbenchTabType | null {
  return value === "welcome" || value === "document" || value === "note" || value === "graph"
    ? value
    : null
}

function sanitizeAttachedContext(raw: unknown): WorkbenchContextDto | null {
  if (!raw || typeof raw !== "object") return null

  const value = raw as Record<string, unknown>
  const scope = value.scope === "document" || value.scope === "workspace" ? value.scope : "global"
  const activeResourceType = sanitizeTabType(value.activeResourceType)
  const openTabs: WorkbenchOpenTabSummaryDto[] = Array.isArray(value.openTabs)
    ? value.openTabs
        .map((item) => {
          if (!item || typeof item !== "object") return null
          const tab = item as Record<string, unknown>
          const type = sanitizeTabType(tab.type)
          if (!type || typeof tab.id !== "string" || typeof tab.title !== "string") return null
          return {
            id: tab.id,
            type,
            resourceRemoteId: tab.resourceRemoteId == null ? null : String(tab.resourceRemoteId),
            title: tab.title,
          }
        })
        .filter((item): item is WorkbenchOpenTabSummaryDto => Boolean(item))
    : []

  return {
    scope,
    workspaceId: value.workspaceId == null ? null : String(value.workspaceId),
    documentRemoteId: value.documentRemoteId == null ? null : String(value.documentRemoteId),
    currentReadingDocumentId: value.currentReadingDocumentId == null ? null : String(value.currentReadingDocumentId),
    activeResourceType,
    activeTabId: value.activeTabId == null ? null : String(value.activeTabId),
    activeTabTitle: value.activeTabTitle == null ? null : String(value.activeTabTitle),
    openTabs,
  }
}

runsRouter.post("/threads/:id/runs/stream", async (req, res, next) => {
  try {
    initSse(res)
    await createAndStreamRun({
      res,
      threadId: req.params.id,
      mode: req.body.mode === "chat" ? "chat" : "agent",
      message: String(req.body.message ?? ""),
      history: Array.isArray(req.body.history)
        ? req.body.history
            .filter((item: any) => item && (item.role === "user" || item.role === "assistant") && typeof item.content === "string")
            .map((item: any) => ({ role: item.role as "user" | "assistant", content: String(item.content) }))
        : [],
      overrides: {
        model: req.body.model == null ? null : String(req.body.model),
        apiBase: req.body.apiBase == null ? null : String(req.body.apiBase),
        apiKey: req.body.apiKey == null ? null : String(req.body.apiKey),
      },
      attachedContext: sanitizeAttachedContext(req.body.attachedContext),
    })
    endSse(res)
  } catch (error) {
    if (!res.headersSent) {
      next(error)
      return
    }
    writeSseEvent(res, {
      type: "error",
      error: error instanceof Error ? error.message : String(error),
      sessionId: req.params.id,
    })
    endSse(res)
  }
})

runsRouter.get("/runs/:id", (req, res) => {
  const run = getRunDetail(req.params.id)
  if (!run) {
    res.status(404).json({ message: "Run not found" })
    return
  }
  res.json(run)
})

runsRouter.get("/runs/:id/events", (req, res) => {
  res.json({ items: getRunEventFeed(req.params.id) })
})

runsRouter.post("/runs/:id/abort", (req, res) => {
  const aborted = abortRun(req.params.id)
  const run = markRunAborted(req.params.id)
  res.json({ success: aborted || Boolean(run) })
})
