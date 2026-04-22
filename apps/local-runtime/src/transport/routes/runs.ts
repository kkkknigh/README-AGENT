import { Router } from "express"
import { abortRun } from "../../agent-runtime/abort-controller.js"
import { createAndStreamRun, getRunDetail, getRunEventFeed, markRunAborted } from "../../agent-runtime/run-service.js"
import { endSse, initSse, writeSseEvent } from "../sse/event-writer.js"

export const runsRouter = Router()

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
