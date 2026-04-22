import { Router } from "express"
import { db } from "../db/index.js"
import { searchDocumentChunks } from "../services/search.js"

export const searchRouter = Router()

searchRouter.post("/workspace", (req, res) => {
  const query = String(req.body.query ?? "").trim()
  const workspaceId = String(req.body.workspaceId ?? "")
  if (!query || !workspaceId) {
    res.json({ items: [] })
    return
  }

  const chunkHits = searchDocumentChunks({ query, workspaceId, limit: 10 }).map((item) => ({
    remote_id: item.documentId,
    title: item.text,
    page: item.page,
    chunkId: item.chunkId,
    score: item.score,
  }))

  res.json({ items: chunkHits })
})

searchRouter.post("/hybrid", (req, res) => {
  const query = String(req.body.query ?? "").trim()
  if (!query) {
    res.json({ items: [] })
    return
  }

  const rows = db.prepare(`
    SELECT remote_id, title
    FROM remote_documents
    WHERE title LIKE ?
    ORDER BY uploaded_at DESC, title ASC
    LIMIT 20
  `).all(`%${query}%`) as Array<{ remote_id: string; title: string }>

  const chunkHits = searchDocumentChunks({ query, limit: 10 }).map((item) => ({
    remote_id: item.documentId,
    title: item.text,
    page: item.page,
    chunkId: item.chunkId,
    score: item.score,
  }))

  res.json({ items: [...chunkHits, ...rows] })
})

searchRouter.post("/current-tab", (req, res) => {
  const query = String(req.body.query ?? "").trim()
  const documentId = String(req.body.documentId ?? "")
  if (!query || !documentId) {
    res.json({ items: [] })
    return
  }

  const rows = searchDocumentChunks({
    query,
    documentId,
    limit: 12,
  }).map((item) => ({
    remote_id: item.documentId,
    title: item.text,
    page: item.page,
    chunkId: item.chunkId,
    score: item.score,
  }))

  res.json({ items: rows })
})
