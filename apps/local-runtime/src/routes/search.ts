import { Router } from "express"
import { db } from "../db/index.js"

export const searchRouter = Router()

searchRouter.post("/workspace", (req, res) => {
  const query = String(req.body.query ?? "").trim()
  const workspaceId = String(req.body.workspaceId ?? "")
  if (!query || !workspaceId) {
    res.json({ items: [] })
    return
  }

  const rows = db.prepare(`
    SELECT d.remote_id, d.title
    FROM workspace_document_links l
    INNER JOIN remote_documents d ON d.remote_id = l.remote_document_id
    WHERE l.workspace_id = ?
      AND d.title LIKE ?
    ORDER BY d.title ASC
    LIMIT 20
  `).all(workspaceId, `%${query}%`) as Array<{ remote_id: string; title: string }>

  res.json({ items: rows })
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

  res.json({ items: rows })
})

searchRouter.post("/current-tab", (req, res) => {
  const query = String(req.body.query ?? "").trim()
  const documentId = String(req.body.documentId ?? "")
  if (!query || !documentId) {
    res.json({ items: [] })
    return
  }

  const rows = db.prepare(`
    SELECT remote_id, title
    FROM remote_documents
    WHERE remote_id = ?
      AND title LIKE ?
    LIMIT 1
  `).all(documentId, `%${query}%`) as Array<{ remote_id: string; title: string }>

  res.json({ items: rows })
})
