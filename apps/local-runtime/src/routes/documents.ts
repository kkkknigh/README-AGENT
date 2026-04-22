import { Router } from "express"
import type { WorkbenchContextDto } from "@readmeclaw/shared-ui"
import { getParsedDocument } from "../services/document-cache.js"
import { createMessage } from "../services/chat.js"
import { callOpenAiCompatibleVision } from "../services/llm.js"

export const documentsRouter = Router()

function buildOverlayIdeState(pdfId: string): WorkbenchContextDto {
  return {
    scope: "document",
    workspaceId: null,
    documentRemoteId: pdfId,
    currentReadingDocumentId: pdfId,
    activeResourceType: "document",
    activeTabId: null,
    activeTabTitle: null,
    openTabs: [],
  }
}

documentsRouter.get("/:pdfId/status", (req, res) => {
  const document = getParsedDocument(req.params.pdfId)
  if (!document) {
    res.status(404).json({ message: "Document not found" })
    return
  }

  res.json({
    status: "completed",
    currentPage: Number(req.query.fromPage ?? document.pageCount),
    paragraphs: document.paragraphs,
    layout: document.layout,
  })
})

documentsRouter.get("/:pdfId/paragraphs/:page", (req, res) => {
  const document = getParsedDocument(req.params.pdfId)
  if (!document) {
    res.status(404).json({ message: "Document not found" })
    return
  }

  const page = Number(req.params.page)
  res.json({
    pdfId: req.params.pdfId,
    page,
    paragraphs: document.paragraphs.filter((item) => item.page === page),
  })
})

documentsRouter.get("/:pdfId/layout", (req, res) => {
  const document = getParsedDocument(req.params.pdfId)
  if (!document) {
    res.status(404).json({ message: "Document not found" })
    return
  }

  res.json({
    pdfId: req.params.pdfId,
    layout: document.layout,
  })
})

documentsRouter.get("/:pdfId/formulas/:page/:index", (req, res) => {
  const document = getParsedDocument(req.params.pdfId)
  if (!document) {
    res.status(404).json({ message: "Document not found" })
    return
  }

  const page = Number(req.params.page)
  const index = Number(req.params.index)
  const formula = document.layout.formulas.find((item) => item.page === page && Number(item.index ?? -1) === index)

  res.json({
    latex: formula?.latex ?? "",
  })
})

documentsRouter.post("/:pdfId/overlay/explain", async (req, res, next) => {
  try {
    const kind = String(req.body.kind ?? "image")
    const page = Number(req.body.page ?? 1)
    const imageDataUrl = String(req.body.imageDataUrl ?? "")
    const prompt = `Explain this ${kind} region from page ${page} of a research paper. Focus on what it shows and why it matters.`
    const result = await callOpenAiCompatibleVision({
      prompt,
      imageDataUrl,
    })

    const sessionId = req.body.sessionId == null ? null : String(req.body.sessionId)
    if (sessionId) {
      const ideState = buildOverlayIdeState(req.params.pdfId)
      createMessage({
        threadId: sessionId,
        role: "user",
        content: `Explain the selected ${kind} on page ${page}.`,
        ideState,
      })
      createMessage({
        threadId: sessionId,
        role: "assistant",
        content: result.text,
        ideState,
      })
    }

    res.json({
      analysis: result.text,
      context: {
        provider: result.llm.provider,
        model: result.llm.model,
      },
    })
  } catch (error) {
    next(error)
  }
})

documentsRouter.post("/:pdfId/overlay/chat", async (req, res, next) => {
  try {
    const kind = String(req.body.kind ?? "image")
    const page = Number(req.body.page ?? 1)
    const imageDataUrl = String(req.body.imageDataUrl ?? "")
    const message = String(req.body.message ?? "").trim()
    const history = Array.isArray(req.body.history) ? req.body.history : []
    const result = await callOpenAiCompatibleVision({
      prompt: `You are helping analyze a ${kind} region from page ${page} of a research paper. User question: ${message}`,
      imageDataUrl,
      history: history
        .filter((item: any) => item && (item.role === "user" || item.role === "assistant") && typeof item.content === "string")
        .map((item: any) => ({
          role: item.role as "user" | "assistant",
          content: String(item.content),
        })),
    })

    res.json({
      answer: result.text,
      imageDataUrl,
      context: {
        provider: result.llm.provider,
        model: result.llm.model,
      },
    })
  } catch (error) {
    next(error)
  }
})
