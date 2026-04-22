import { Router } from "express"
import { getParsedDocument } from "../services/document-cache.js"
import { callOpenAiCompatibleChat } from "../services/llm.js"

export const aiRouter = Router()

aiRouter.post("/translate/text", async (req, res, next) => {
  try {
    const originalText = String(req.body.text ?? "").trim()
    const result = await callOpenAiCompatibleChat({
      capability: "translate",
      messages: [
        {
          role: "user",
          content: `Translate the following text into Chinese. Return only the translation.\n\n${originalText}`,
        },
      ],
      temperature: 0,
    })

    res.json({
      originalText,
      translatedText: result.text,
      sentences: [
        {
          index: 0,
          original: originalText,
          translated: result.text,
        },
      ],
      context: {
        provider: result.llm.provider,
        model: result.llm.model,
      },
    })
  } catch (error) {
    next(error)
  }
})

aiRouter.post("/translate/paragraph", async (req, res, next) => {
  try {
    const paragraphId = String(req.body.paragraphId ?? "")
    const content = String(req.body.content ?? "").trim()
    const result = await callOpenAiCompatibleChat({
      capability: "translate",
      messages: [
        {
          role: "user",
          content: `Translate the following academic paragraph into Chinese. Return only the translation.\n\n${content}`,
        },
      ],
      temperature: 0,
    })

    res.json({
      paragraphId,
      translation: result.text,
      context: {
        provider: result.llm.provider,
        model: result.llm.model,
      },
    })
  } catch (error) {
    next(error)
  }
})

aiRouter.get("/roadmap/:pdfId", (req, res) => {
  const document = getParsedDocument(req.params.pdfId)
  if (!document) {
    res.status(404).json({ message: "Document not found" })
    return
  }

  const nodes = document.paragraphs.slice(0, 6).map((paragraph, index) => ({
    id: `node-${index + 1}`,
    data: {
      label: index === 0 ? document.filename : `Section ${index}`,
      description: paragraph.content.slice(0, 160),
      papers: [],
    },
    position: { x: index * 180, y: index % 2 === 0 ? 0 : 120 },
  }))

  res.json({
    nodes,
    edges: nodes.slice(1).map((node, index) => ({
      id: `edge-${index + 1}`,
      source: nodes[index].id,
      target: node.id,
    })),
  })
})

aiRouter.get("/brief/:pdfId", (req, res) => {
  const document = getParsedDocument(req.params.pdfId)
  if (!document) {
    res.status(404).json({ message: "Document not found" })
    return
  }

  res.json({
    bullets: document.paragraphs.slice(0, 4).map((item) => item.content.slice(0, 180)),
    generatedAt: new Date().toISOString(),
  })
})
