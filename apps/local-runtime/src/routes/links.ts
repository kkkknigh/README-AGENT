import { Router } from "express"
import { getParsedDocument } from "../services/document-cache.js"

export const linksRouter = Router()

linksRouter.get("/:pdfId/paragraphs/:paragraphId", (req, res) => {
  const document = getParsedDocument(req.params.pdfId)
  if (!document) {
    res.status(404).json({ message: "Document not found" })
    return
  }

  const paragraph = document.paragraphs.find((item) => item.id === req.params.paragraphId)
  if (!paragraph) {
    res.json({
      title: "",
      url: "",
      snippet: "",
      published_date: "",
      authors: [],
      source: "local-runtime",
      valid: 0,
    })
    return
  }

  res.json({
    title: document.filename,
    url: "",
    snippet: paragraph.content.slice(0, 280),
    published_date: "",
    authors: [],
    source: "local-runtime",
    valid: 1,
  })
})

linksRouter.get("/:pdfId/citations", (req, res) => {
  res.json({ pdfId: req.params.pdfId, citations: {} })
})
