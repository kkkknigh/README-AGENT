import type { WorkbenchTabDto } from "@readmeclaw/shared-ui"
import { nanoid } from "nanoid"
import { db } from "../db/index.js"
import { nowIso } from "./time.js"

type UpsertTabInput = {
  id?: string
  type: WorkbenchTabDto["type"]
  resourceRemoteId?: string | null
  title: string
  payloadJson: string
}

export function listTabs(): WorkbenchTabDto[] {
  return db.prepare(`
    SELECT id, type, resource_remote_id as resourceRemoteId, title, payload_json as payloadJson, created_at as createdAt, updated_at as updatedAt
    FROM open_tabs
    ORDER BY updated_at ASC, created_at ASC
  `).all() as WorkbenchTabDto[]
}

export function replaceTabs(items: UpsertTabInput[]) {
  const now = nowIso()
  const insert = db.prepare(`
    INSERT INTO open_tabs (id, type, resource_remote_id, title, payload_json, created_at, updated_at)
    VALUES (@id, @type, @resourceRemoteId, @title, @payloadJson, @createdAt, @updatedAt)
  `)

  const transaction = db.transaction((records: UpsertTabInput[]) => {
    db.prepare(`DELETE FROM open_tabs`).run()
    for (const item of records) {
      insert.run({
        id: item.id ?? nanoid(),
        type: item.type,
        resourceRemoteId: item.resourceRemoteId ?? null,
        title: item.title,
        payloadJson: item.payloadJson,
        createdAt: now,
        updatedAt: now,
      })
    }
  })

  transaction(items)
  return listTabs()
}

export function updateTab(
  id: string,
  patch: Partial<Pick<WorkbenchTabDto, "title" | "resourceRemoteId" | "payloadJson">>,
) {
  const existing = db.prepare(`
    SELECT id, type, resource_remote_id as resourceRemoteId, title, payload_json as payloadJson, created_at as createdAt, updated_at as updatedAt
    FROM open_tabs
    WHERE id = ?
  `).get(id) as WorkbenchTabDto | undefined

  if (!existing) {
    return null
  }

  const next: WorkbenchTabDto = {
    ...existing,
    title: patch.title ?? existing.title,
    resourceRemoteId: patch.resourceRemoteId ?? existing.resourceRemoteId,
    payloadJson: patch.payloadJson ?? existing.payloadJson,
    updatedAt: nowIso(),
  }

  db.prepare(`
    UPDATE open_tabs
    SET title = @title,
        resource_remote_id = @resourceRemoteId,
        payload_json = @payloadJson,
        updated_at = @updatedAt
    WHERE id = @id
  `).run(next)

  return next
}

export function deleteTab(id: string) {
  db.prepare(`DELETE FROM open_tabs WHERE id = ?`).run(id)
}

