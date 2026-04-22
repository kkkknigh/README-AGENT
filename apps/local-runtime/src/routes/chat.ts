import { Router } from "express"
import { callOpenAiCompatibleChat } from "../services/llm.js"
import { createMessage, createThread, deleteThread, listMessages, listThreads, updateThread } from "../services/chat.js"

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

chatRouter.post("/threads/:id/messages/stream", async (req, res, next) => {
  try {
    const userInput = String(req.body.message ?? "")
    const history = Array.isArray(req.body.history) ? req.body.history : []
    const userMessage = createMessage({
      threadId: req.params.id,
      role: "user",
      content: userInput,
    })

    const result = await callOpenAiCompatibleChat({
      capability: "chat",
      model: req.body.model == null ? null : String(req.body.model),
      apiBase: req.body.apiBase == null ? null : String(req.body.apiBase),
      apiKey: req.body.apiKey == null ? null : String(req.body.apiKey),
      messages: [
        ...history
          .filter((item: any) => item && (item.role === "user" || item.role === "assistant") && typeof item.content === "string")
          .map((item: any) => ({
            role: item.role as "user" | "assistant",
            content: String(item.content),
          })),
        {
          role: "user",
          content: userInput,
        },
      ],
    })

    const assistantMessage = createMessage({
      threadId: req.params.id,
      role: "assistant",
      content: result.text,
    })

    res.setHeader("Content-Type", "text/event-stream")
    res.setHeader("Cache-Control", "no-cache")
    res.setHeader("Connection", "keep-alive")
    res.flushHeaders()
    res.write(`data: ${JSON.stringify({ type: "user_message_ack", userMessageId: userMessage.id })}\n\n`)
    res.write(`data: ${JSON.stringify({ type: "step", step: `Using ${result.llm.provider}${result.llm.model ? ` / ${result.llm.model}` : ""}` })}\n\n`)
    res.write(`data: ${JSON.stringify({ type: "chunk", delta: assistantMessage.content })}\n\n`)
    res.write(`data: ${JSON.stringify({
      type: "final",
      response: assistantMessage.content,
      sessionId: req.params.id,
      context_used: {
        llm: {
          provider: result.llm.provider,
          model: result.llm.model,
          apiBaseConfigured: Boolean(result.llm.apiBase),
          apiKeyConfigured: Boolean(result.llm.apiKey),
        },
      },
    })}\n\n`)
    res.write("data: [DONE]\n\n")
    res.end()
  } catch (error) {
    next(error)
  }
})
