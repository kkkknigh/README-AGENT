import { db } from "../db/index.js"
import { getParsedDocument } from "./document-cache.js"
import { listDocuments } from "./library.js"
import { listWorkspaceDocuments } from "./mirror.js"
import { nowIso } from "./time.js"

export interface DocumentChunkSearchResult {
  chunkId: string
  documentId: string
  page: number | null
  text: string
  score: number
}

export function syncDocumentChunks(documentId: string, paragraphs?: Array<{ id: string; page: number; content: string }>) {
  const parsed = paragraphs ? null : getParsedDocument(documentId)
  const sourceParagraphs = paragraphs ?? parsed?.paragraphs ?? []
  const createdAt = nowIso()

  const txn = db.transaction(() => {
    db.prepare(`DELETE FROM document_chunks WHERE remote_document_id = ?`).run(documentId)
    db.prepare(`DELETE FROM document_chunks_fts WHERE remote_document_id = ?`).run(documentId)

    for (const [index, paragraph] of sourceParagraphs.entries()) {
      const metadataJson = JSON.stringify({ paragraphId: paragraph.id })
      db.prepare(`
        INSERT INTO document_chunks (
          id, remote_document_id, chunk_index, page_number, content, metadata_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(paragraph.id, documentId, index, paragraph.page ?? null, paragraph.content, metadataJson, createdAt)

      db.prepare(`
        INSERT INTO document_chunks_fts (id, remote_document_id, page_number, content)
        VALUES (?, ?, ?, ?)
      `).run(paragraph.id, documentId, paragraph.page ?? null, paragraph.content)
    }
  })

  txn()
}

export function ensureDocumentChunks(documentId: string) {
  const existing = db.prepare(`
    SELECT COUNT(*) as count
    FROM document_chunks
    WHERE remote_document_id = ?
  `).get(documentId) as { count: number }

  if (existing.count > 0) return

  const parsed = getParsedDocument(documentId)
  if (parsed) {
    syncDocumentChunks(documentId, parsed.paragraphs)
  }
}

export function searchDocumentChunks(input: {
  query: string
  documentId?: string | null
  workspaceId?: string | null
  limit?: number
}) {
  const query = input.query.trim()
  if (!query) return [] as DocumentChunkSearchResult[]

  if (input.documentId) {
    ensureDocumentChunks(input.documentId)
  } else if (input.workspaceId) {
    listWorkspaceDocuments(input.workspaceId).forEach((document) => ensureDocumentChunks(document.id))
  } else {
    listDocuments().forEach((document) => ensureDocumentChunks(document.id))
  }

  const limit = Math.max(1, Math.min(Number(input.limit ?? 8), 20))
  const params: Array<string | number> = []
  const filters: string[] = []

  if (input.documentId) {
    filters.push(`fts.remote_document_id = ?`)
    params.push(input.documentId)
  } else if (input.workspaceId) {
    filters.push(`fts.remote_document_id IN (
      SELECT remote_document_id
      FROM workspace_document_links
      WHERE workspace_id = ?
    )`)
    params.push(input.workspaceId)
  }

  const whereClause = filters.length > 0 ? `AND ${filters.join(" AND ")}` : ""
  const matchQuery = query
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => `"${token.replace(/"/g, "")}"`)
    .join(" OR ")

  const rows = db.prepare(`
    SELECT
      chunks.id,
      chunks.remote_document_id,
      chunks.page_number,
      chunks.content,
      bm25(document_chunks_fts) as score
    FROM document_chunks_fts fts
    INNER JOIN document_chunks chunks ON chunks.id = fts.id
    WHERE document_chunks_fts MATCH ?
      ${whereClause}
    ORDER BY bm25(document_chunks_fts) ASC
    LIMIT ?
  `).all(matchQuery || query, ...params, limit) as Array<{
    id: string
    remote_document_id: string
    page_number: number | null
    content: string
    score: number
  }>

  if (rows.length > 0) {
    return rows.map((row) => ({
      chunkId: row.id,
      documentId: row.remote_document_id,
      page: row.page_number,
      text: row.content,
      score: Number(row.score ?? 0),
    }))
  }

  const fallbackRows = db.prepare(`
    SELECT id, remote_document_id, page_number, content
    FROM document_chunks
    WHERE content LIKE ?
      ${input.documentId ? "AND remote_document_id = ?" : ""}
    LIMIT ?
  `).all(`%${query}%`, ...(input.documentId ? [input.documentId] : []), limit) as Array<{
    id: string
    remote_document_id: string
    page_number: number | null
    content: string
  }>

  return fallbackRows.map((row, index) => ({
    chunkId: row.id,
    documentId: row.remote_document_id,
    page: row.page_number,
    text: row.content,
    score: index + 1,
  }))
}
