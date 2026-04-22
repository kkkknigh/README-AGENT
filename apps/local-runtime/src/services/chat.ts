import type { LocalChatMessageDto, LocalChatThreadDto, WorkbenchContextDto } from "@readmeclaw/shared-ui"
import { nanoid } from "nanoid"
import { db } from "../db/index.js"
import { upsertMessageMeta } from "../repositories/message-meta-repo.js"
import { nowIso } from "./time.js"

export function listThreads(): LocalChatThreadDto[] {
  return db.prepare(`
    SELECT id, title, scope, workspace_id as workspaceId, document_remote_id as documentRemoteId, created_at as createdAt, updated_at as updatedAt
    FROM local_chat_threads
    ORDER BY updated_at DESC
  `).all() as LocalChatThreadDto[]
}

export function getThread(threadId: string) {
  return db.prepare(`
    SELECT id, title, scope, workspace_id as workspaceId, document_remote_id as documentRemoteId, created_at as createdAt, updated_at as updatedAt
    FROM local_chat_threads
    WHERE id = ?
  `).get(threadId) as LocalChatThreadDto | undefined
}

export function createThread(input: {
  title: string
  scope: "global" | "workspace" | "document"
  workspaceId?: string | null
  documentRemoteId?: string | null
}): LocalChatThreadDto {
  const now = nowIso()
  const thread: LocalChatThreadDto = {
    id: nanoid(),
    title: input.title,
    scope: input.scope,
    workspaceId: input.workspaceId ?? null,
    documentRemoteId: input.documentRemoteId ?? null,
    createdAt: now,
    updatedAt: now,
  }
  db.prepare(`
    INSERT INTO local_chat_threads (id, title, scope, workspace_id, document_remote_id, created_at, updated_at)
    VALUES (@id, @title, @scope, @workspaceId, @documentRemoteId, @createdAt, @updatedAt)
  `).run(thread)
  return thread
}

export function updateThread(
  threadId: string,
  patch: Partial<Pick<LocalChatThreadDto, "title" | "workspaceId" | "documentRemoteId">>,
) {
  const existing = db.prepare(`
    SELECT id, title, scope, workspace_id as workspaceId, document_remote_id as documentRemoteId, created_at as createdAt, updated_at as updatedAt
    FROM local_chat_threads
    WHERE id = ?
  `).get(threadId) as LocalChatThreadDto | undefined

  if (!existing) {
    return null
  }

  const next: LocalChatThreadDto = {
    ...existing,
    title: patch.title ?? existing.title,
    workspaceId: patch.workspaceId ?? existing.workspaceId,
    documentRemoteId: patch.documentRemoteId ?? existing.documentRemoteId,
    updatedAt: nowIso(),
  }

  db.prepare(`
    UPDATE local_chat_threads
    SET title = @title,
        workspace_id = @workspaceId,
        document_remote_id = @documentRemoteId,
        updated_at = @updatedAt
    WHERE id = @id
  `).run(next)

  return next
}

export function deleteThread(threadId: string) {
  db.prepare(`
    DELETE FROM local_chat_threads
    WHERE id = ?
  `).run(threadId)
}

export function listMessages(threadId: string): LocalChatMessageDto[] {
  const rows = db.prepare(`
    SELECT
      m.id,
      m.thread_id as threadId,
      m.role,
      m.content,
      m.created_at as createdAt,
      meta.citations_json as citationsJson,
      meta.thoughts_json as thoughtsJson,
      meta.steps_json as stepsJson,
      meta.attachments_json as attachmentsJson,
      meta.ide_state_json as ideStateJson,
      meta.run_id as runId
    FROM local_chat_messages m
    LEFT JOIN local_chat_message_meta meta ON meta.message_id = m.id
    WHERE m.thread_id = ?
    ORDER BY m.created_at ASC
  `).all(threadId) as Array<LocalChatMessageDto & {
    citationsJson?: string | null
    thoughtsJson?: string | null
    stepsJson?: string | null
    attachmentsJson?: string | null
    ideStateJson?: string | null
  }>

  return rows.map((row) => ({
    id: row.id,
    threadId: row.threadId,
    role: row.role,
    content: row.content,
    createdAt: row.createdAt,
    citations: row.citationsJson ? JSON.parse(row.citationsJson) : [],
    thoughts: row.thoughtsJson ? JSON.parse(row.thoughtsJson) : [],
    steps: row.stepsJson ? JSON.parse(row.stepsJson) : [],
    attachments: row.attachmentsJson ? JSON.parse(row.attachmentsJson) : [],
    ideState: row.ideStateJson ? JSON.parse(row.ideStateJson) : null,
    runId: row.runId ?? null,
  }))
}

export function createMessage(input: {
  threadId: string
  role: "user" | "assistant"
  content: string
  ideState?: WorkbenchContextDto | null
}): LocalChatMessageDto {
  const message: LocalChatMessageDto = {
    id: nanoid(),
    threadId: input.threadId,
    role: input.role,
    content: input.content,
    createdAt: nowIso(),
    ideState: input.ideState ?? null,
  }
  db.prepare(`
    INSERT INTO local_chat_messages (id, thread_id, role, content, created_at)
    VALUES (@id, @threadId, @role, @content, @createdAt)
  `).run(message)
  db.prepare(`UPDATE local_chat_threads SET updated_at = ? WHERE id = ?`).run(message.createdAt, input.threadId)
  if (input.ideState) {
    upsertMessageMeta({
      messageId: message.id,
      ideStateJson: JSON.stringify(input.ideState),
    })
  }
  return message
}
