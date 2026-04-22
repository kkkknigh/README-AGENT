import type { RemoteHighlightDto } from "@readmeclaw/remote-contracts"
import { nanoid } from "nanoid"
import { db } from "../db/index.js"
import { nowIso } from "./time.js"

function mapRow(row: { payload_json: string }) {
  return JSON.parse(row.payload_json) as RemoteHighlightDto
}

export function listHighlights(pdfId: string, page?: number) {
  const rows = db.prepare(`
    SELECT payload_json
    FROM remote_highlights
    WHERE remote_deleted_at IS NULL
      AND pdf_remote_id = ?
      AND (? IS NULL OR page_number = ?)
    ORDER BY created_at ASC, remote_id ASC
  `).all(pdfId, page ?? null, page ?? null) as Array<{ payload_json: string }>

  return rows.map(mapRow)
}

export function getHighlight(highlightId: string) {
  const row = db.prepare(`
    SELECT payload_json
    FROM remote_highlights
    WHERE remote_id = ? AND remote_deleted_at IS NULL
  `).get(highlightId) as { payload_json: string } | undefined

  return row ? mapRow(row) : null
}

export function createHighlight(input: {
  pdfId: string
  page: number
  rects: Array<{ left: number; top: number; width: number; height: number }>
  text?: string
  color?: string
}) {
  const payload: RemoteHighlightDto = {
    id: nanoid(),
    pdfId: input.pdfId,
    page: input.page,
    color: input.color ?? "#ffe066",
    text: input.text ?? null,
    rects: input.rects,
    createdAt: nowIso(),
  }

  db.prepare(`
    INSERT INTO remote_highlights (
      remote_id, remote_updated_at, remote_deleted_at, payload_json, pdf_remote_id, page_number,
      color, created_at, last_synced_at, sync_state, last_sync_error
    ) VALUES (
      @id, @createdAt, NULL, @payload_json, @pdfId, @page,
      @color, @createdAt, @createdAt, 'dirty_local', NULL
    )
  `).run({
    ...payload,
    payload_json: JSON.stringify(payload),
  })

  return payload
}

export function updateHighlight(highlightId: string, patch: {
  color?: string
  rects?: Array<{ left: number; top: number; width: number; height: number }>
  text?: string | null
}) {
  const existing = getHighlight(highlightId)
  if (!existing) return null

  const payload: RemoteHighlightDto = {
    ...existing,
    color: patch.color ?? existing.color,
    rects: patch.rects ?? existing.rects,
    text: patch.text ?? existing.text,
  }
  const updatedAt = nowIso()

  db.prepare(`
    UPDATE remote_highlights
    SET remote_updated_at = @updatedAt,
        payload_json = @payload_json,
        color = @color,
        page_number = @page,
        pdf_remote_id = @pdfId,
        last_synced_at = @updatedAt,
        sync_state = 'dirty_local',
        last_sync_error = NULL
    WHERE remote_id = @id
  `).run({
    ...payload,
    updatedAt,
    payload_json: JSON.stringify(payload),
  })

  return payload
}

export function deleteHighlight(highlightId: string) {
  db.prepare(`DELETE FROM remote_highlights WHERE remote_id = ?`).run(highlightId)
}
