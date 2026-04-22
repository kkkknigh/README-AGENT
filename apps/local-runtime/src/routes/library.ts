import { Router } from "express"
import { addDocumentTag, deleteDocument, listDocuments, removeDocumentTag, updateDocument } from "../services/library.js"

export const libraryRouter = Router()

libraryRouter.get("/documents", (req, res) => {
  const items = listDocuments({
    keyword: req.query.keyword == null ? undefined : String(req.query.keyword),
    group: req.query.group == null ? undefined : String(req.query.group),
  })
  res.json({ items, total: items.length })
})

libraryRouter.delete("/documents/:pdfId", (req, res) => {
  deleteDocument(req.params.pdfId)
  res.json({ success: true })
})

libraryRouter.patch("/documents/:pdfId", (req, res) => {
  const updated = updateDocument(req.params.pdfId, {
    title: req.body.title == null ? undefined : String(req.body.title),
  })
  if (!updated) {
    res.status(404).json({ message: "Document not found" })
    return
  }
  res.json({ success: true, document: updated })
})

libraryRouter.post("/documents/:pdfId/tags", (req, res) => {
  const tag = String(req.body.tag ?? "").trim()
  const updated = addDocumentTag(req.params.pdfId, tag)
  if (!updated) {
    res.status(404).json({ message: "Document not found" })
    return
  }
  res.json({ success: true, document: updated })
})

libraryRouter.delete("/documents/:pdfId/tags/:tag", (req, res) => {
  const updated = removeDocumentTag(req.params.pdfId, req.params.tag)
  if (!updated) {
    res.status(404).json({ message: "Document not found" })
    return
  }
  res.json({ success: true, document: updated })
})
