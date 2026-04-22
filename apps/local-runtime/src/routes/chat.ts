import { Router } from "express"
import { createThread, deleteThread, listMessages, listThreads, updateThread } from "../services/chat.js"

export const chatRouter = Router()

chatRouter.get("/threads", (_req, res) => {
  res.json({ items: listThreads() })
})

chatRouter.post("/threads", (req, res) => {
  const thread = createThread(req.body)
  res.status(201).json(thread)
})

chatRouter.patch("/threads/:id", (req, res) => {
  const thread = updateThread(req.params.id, {
    title: req.body.title == null ? undefined : String(req.body.title),
    workspaceId: req.body.workspaceId == null ? undefined : String(req.body.workspaceId),
    documentRemoteId: req.body.documentRemoteId == null ? undefined : String(req.body.documentRemoteId),
  })

  if (!thread) {
    res.status(404).json({ message: "Thread not found" })
    return
  }

  res.json(thread)
})

chatRouter.delete("/threads/:id", (req, res) => {
  deleteThread(req.params.id)
  res.status(204).end()
})

chatRouter.get("/threads/:id/messages", (req, res) => {
  res.json({ items: listMessages(req.params.id) })
})
