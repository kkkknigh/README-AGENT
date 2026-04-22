import { Router } from "express"
import { generateHtmlDocument, getHtmlDocument } from "../services/html.js"

export const htmlRouter = Router()

htmlRouter.get("/:pdfId", (req, res) => {
  const html = getHtmlDocument(req.params.pdfId)
  if (!html) {
    res.status(404).json({ message: "HTML document not found" })
    return
  }
  res.json(html)
})

htmlRouter.post("/:pdfId/fetch", (req, res) => {
  const html = generateHtmlDocument(req.params.pdfId)
  if (!html) {
    res.status(404).json({ message: "HTML document not found" })
    return
  }
  res.json({
    task_id: html.task_id,
    status: req.body.force ? "completed" : html.status,
    source: html.source,
    deduped: false,
    message: html.message,
  })
})
