import type { RemoteDocumentDto } from "@readmeclaw/remote-contracts"
import { db } from "../db/index.js"
import { nowIso } from "./time.js"

export interface StoredLibraryDocument extends RemoteDocumentDto {
  syncMeta?: {
    remoteId: string
    lastSyncedAt: string | null
    syncState: string
    lastSyncError: string | null
  }
}

function mapRowToDocument(row: {
  remote_id: string
  payload_json: string
  last_synced_at: string | null
  sync_state: string
  last_sync_error: string | null
}): StoredLibraryDocument {
  return {
    ...(JSON.parse(row.payload_json) as RemoteDocumentDto),
    syncMeta: {
      remoteId: row.remote_id,
      lastSyncedAt: row.last_synced_at,
      syncState: row.sync_state,
      lastSyncError: row.last_sync_error,
    },
  }
}

export function listDocuments(input?: { keyword?: string; group?: string }) {
  const rows = db.prepare(`
    SELECT remote_id, payload_json, last_synced_at, sync_state, last_sync_error
    FROM remote_documents
    WHERE remote_deleted_at IS NULL
    ORDER BY uploaded_at DESC, title ASC
  `).all() as Array<{
    remote_id: string
    payload_json: string
    last_synced_at: string | null
    sync_state: string
    last_sync_error: string | null
  }>

  let items = rows.map(mapRowToDocument)
  const keyword = input?.keyword?.trim().toLowerCase()
  const group = input?.group?.trim()

  if (keyword) {
    items = items.filter((item) =>
      item.title.toLowerCase().includes(keyword)
      || item.tags.some((tag) => tag.toLowerCase().includes(keyword))
      || item.authors.some((author) => author.toLowerCase().includes(keyword)),
    )
  }

  if (group) {
    items = items.filter((item) => item.tags.includes(group))
  }

  return items
}

export function getDocument(pdfId: string) {
  const row = db.prepare(`
    SELECT remote_id, payload_json, last_synced_at, sync_state, last_sync_error
    FROM remote_documents
    WHERE remote_id = ? AND remote_deleted_at IS NULL
  `).get(pdfId) as {
    remote_id: string
    payload_json: string
    last_synced_at: string | null
    sync_state: string
    last_sync_error: string | null
  } | undefined

  return row ? mapRowToDocument(row) : null
}

export function upsertDocument(input: {
  id: string
  title: string
  pageCount: number | null
  authors?: string[]
  tags?: string[]
  uploadedAt?: string | null
  processStatus?: string | null
  htmlStatus?: string | null
  metadata?: Record<string, unknown>
}) {
  const now = nowIso()
  const payload: RemoteDocumentDto = {
    id: input.id,
    title: input.title,
    pageCount: input.pageCount,
    authors: input.authors ?? [],
    tags: input.tags ?? [],
    uploadedAt: input.uploadedAt ?? now,
    processStatus: input.processStatus ?? "completed",
    htmlStatus: input.htmlStatus ?? "completed",
    metadata: input.metadata ?? {},
  }

  db.prepare(`
    INSERT INTO remote_documents (
      remote_id, remote_updated_at, remote_deleted_at, payload_json, title, page_count, uploaded_at,
      process_status, html_status, last_synced_at, sync_state, last_sync_error
    ) VALUES (
      @remote_id, @remote_updated_at, NULL, @payload_json, @title, @page_count, @uploaded_at,
      @process_status, @html_status, @last_synced_at, 'dirty_local', NULL
    )
    ON CONFLICT(remote_id) DO UPDATE SET
      remote_updated_at = excluded.remote_updated_at,
      remote_deleted_at = NULL,
      payload_json = excluded.payload_json,
      title = excluded.title,
      page_count = excluded.page_count,
      uploaded_at = excluded.uploaded_at,
      process_status = excluded.process_status,
      html_status = excluded.html_status,
      last_synced_at = excluded.last_synced_at,
      sync_state = 'dirty_local',
      last_sync_error = NULL
  `).run({
    remote_id: payload.id,
    remote_updated_at: now,
    payload_json: JSON.stringify(payload),
    title: payload.title,
    page_count: payload.pageCount,
    uploaded_at: payload.uploadedAt,
    process_status: payload.processStatus,
    html_status: payload.htmlStatus,
    last_synced_at: now,
  })

  return payload
}

export function updateDocument(pdfId: string, patch: {
  title?: string
  tags?: string[]
  authors?: string[]
  htmlStatus?: string | null
  metadata?: Record<string, unknown>
}) {
  const existing = getDocument(pdfId)
  if (!existing) return null

  return upsertDocument({
    id: existing.id,
    title: patch.title ?? existing.title,
    pageCount: existing.pageCount,
    authors: patch.authors ?? existing.authors,
    tags: patch.tags ?? existing.tags,
    uploadedAt: existing.uploadedAt,
    processStatus: existing.processStatus,
    htmlStatus: patch.htmlStatus ?? existing.htmlStatus,
    metadata: patch.metadata ?? existing.metadata,
  })
}

export function addDocumentTag(pdfId: string, tag: string) {
  const existing = getDocument(pdfId)
  if (!existing) return null
  const nextTags = existing.tags.includes(tag) ? existing.tags : [...existing.tags, tag]
  return updateDocument(pdfId, { tags: nextTags })
}

export function removeDocumentTag(pdfId: string, tag: string) {
  const existing = getDocument(pdfId)
  if (!existing) return null
  return updateDocument(pdfId, { tags: existing.tags.filter((item) => item !== tag) })
}

export function deleteDocument(pdfId: string) {
  const txn = db.transaction(() => {
    db.prepare(`DELETE FROM remote_documents WHERE remote_id = ?`).run(pdfId)
    db.prepare(`DELETE FROM remote_notes WHERE pdf_remote_id = ?`).run(pdfId)
    db.prepare(`DELETE FROM remote_highlights WHERE pdf_remote_id = ?`).run(pdfId)
    db.prepare(`DELETE FROM workspace_document_links WHERE remote_document_id = ?`).run(pdfId)
  })
  txn()
}
