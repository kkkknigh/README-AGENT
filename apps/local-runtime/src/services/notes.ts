import { db } from "../db/index.js"
import { nowIso } from "./time.js"

export interface StoredNote {
  id: number
  title: string
  content: string
  tags: string[]
  pdfId: string | null
  createdAt: string
  updatedAt: string
}

function mapRow(row: { payload_json: string }) {
  return JSON.parse(row.payload_json) as StoredNote
}

export function listNotes(pdfId?: string) {
  const rows = (pdfId
    ? db.prepare(`
      SELECT payload_json
      FROM remote_notes
      WHERE remote_deleted_at IS NULL AND pdf_remote_id = ?
      ORDER BY updated_at DESC, remote_id DESC
    `).all(pdfId)
    : db.prepare(`
      SELECT payload_json
      FROM remote_notes
      WHERE remote_deleted_at IS NULL
      ORDER BY updated_at DESC, remote_id DESC
    `).all()) as Array<{ payload_json: string }>

  return rows.map(mapRow)
}

export function getNote(noteId: number) {
  const row = db.prepare(`
    SELECT payload_json
    FROM remote_notes
    WHERE remote_id = ? AND remote_deleted_at IS NULL
  `).get(noteId) as { payload_json: string } | undefined

  return row ? mapRow(row) : null
}

export function createNote(input: {
  pdfId: string
  title?: string
  content: string
  tags?: string[]
}) {
  const now = nowIso()
  const nextId = ((db.prepare(`SELECT COALESCE(MAX(remote_id), 0) as maxId FROM remote_notes`).get() as { maxId: number }).maxId ?? 0) + 1
  const payload: StoredNote = {
    id: nextId,
    pdfId: input.pdfId,
    title: input.title?.trim() || "Untitled Note",
    content: input.content,
    tags: input.tags ?? [],
    createdAt: now,
    updatedAt: now,
  }

  db.prepare(`
    INSERT INTO remote_notes (
      remote_id, remote_updated_at, remote_deleted_at, payload_json, title, pdf_remote_id,
      created_at, updated_at, last_synced_at, sync_state, last_sync_error
    ) VALUES (
      @id, @updatedAt, NULL, @payload_json, @title, @pdfId,
      @createdAt, @updatedAt, @updatedAt, 'dirty_local', NULL
    )
  `).run({
    ...payload,
    payload_json: JSON.stringify(payload),
  })

  return payload
}

export function updateNote(noteId: number, patch: {
  title?: string
  content?: string
  tags?: string[]
}) {
  const existing = getNote(noteId)
  if (!existing) return null
  const payload: StoredNote = {
    ...existing,
    title: patch.title ?? existing.title,
    content: patch.content ?? existing.content,
    tags: patch.tags ?? existing.tags,
    updatedAt: nowIso(),
  }

  db.prepare(`
    UPDATE remote_notes
    SET remote_updated_at = @updatedAt,
        payload_json = @payload_json,
        title = @title,
        pdf_remote_id = @pdfId,
        updated_at = @updatedAt,
        last_synced_at = @updatedAt,
        sync_state = 'dirty_local',
        last_sync_error = NULL
    WHERE remote_id = @id
  `).run({
    ...payload,
    payload_json: JSON.stringify(payload),
  })

  return payload
}

export function deleteNote(noteId: number) {
  db.prepare(`DELETE FROM remote_notes WHERE remote_id = ?`).run(noteId)
}
