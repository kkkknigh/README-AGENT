import type express from "express"
import type { AgentStreamEvent } from "./event-types.js"

export function initSse(res: express.Response) {
  res.setHeader("Content-Type", "text/event-stream")
  res.setHeader("Cache-Control", "no-cache")
  res.setHeader("Connection", "keep-alive")
  res.flushHeaders()
}

export function writeSseEvent(res: express.Response, event: AgentStreamEvent) {
  res.write(`data: ${JSON.stringify(event)}\n\n`)
}

export function endSse(res: express.Response) {
  res.write("data: [DONE]\n\n")
  res.end()
}
