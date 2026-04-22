import { Router } from "express"
import { createHighlight, deleteHighlight, listHighlights, updateHighlight } from "../services/highlights.js"

export const highlightsRouter = Router()

highlightsRouter.get("/", (req, res) => {
  const pdfId = String(req.query.pdfId ?? "")
  const page = req.query.page == null ? undefined : Number(req.query.page)
  const highlights = listHighlights(pdfId, page)
  res.json({ success: true, highlights, total: highlights.length })
})

highlightsRouter.post("/", (req, res) => {
  const highlight = createHighlight({
    pdfId: String(req.body.pdfId ?? ""),
    page: Number(req.body.page ?? 1),
    rects: Array.isArray(req.body.rects) ? req.body.rects : [],
    text: req.body.text == null ? undefined : String(req.body.text),
    color: req.body.color == null ? undefined : String(req.body.color),
  })
  res.status(201).json({ success: true, id: highlight.id, rects: highlight.rects, message: "Created" })
})

highlightsRouter.patch("/:id", (req, res) => {
  const updated = updateHighlight(req.params.id, {
    color: req.body.color == null ? undefined : String(req.body.color),
  })
  if (!updated) {
    res.status(404).json({ message: "Highlight not found" })
    return
  }
  res.json({ success: true })
})

highlightsRouter.delete("/:id", (req, res) => {
  deleteHighlight(req.params.id)
  res.json({ success: true })
})
