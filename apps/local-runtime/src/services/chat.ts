import type { LocalChatMessageDto, LocalChatThreadDto } from "@readmeclaw/shared-ui"
import { nanoid } from "nanoid"
import { db } from "../db/index.js"
import { nowIso } from "./time.js"

export function listThreads(): LocalChatThreadDto[] {
  return db.prepare(`
    SELECT id, title, scope, workspace_id as workspaceId, document_remote_id as documentRemoteId, created_at as createdAt, updated_at as updatedAt
    FROM local_chat_threads
    ORDER BY updated_at DESC
  `).all() as LocalChatThreadDto[]
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
  return db.prepare(`
    SELECT id, thread_id as threadId, role, content, created_at as createdAt
    FROM local_chat_messages
    WHERE thread_id = ?
    ORDER BY created_at ASC
  `).all(threadId) as LocalChatMessageDto[]
}

export function createMessage(input: {
  threadId: string
  role: "user" | "assistant"
  content: string
}): LocalChatMessageDto {
  const message: LocalChatMessageDto = {
    id: nanoid(),
    threadId: input.threadId,
    role: input.role,
    content: input.content,
    createdAt: nowIso(),
  }
  db.prepare(`
    INSERT INTO local_chat_messages (id, thread_id, role, content, created_at)
    VALUES (@id, @threadId, @role, @content, @createdAt)
  `).run(message)
  db.prepare(`UPDATE local_chat_threads SET updated_at = ? WHERE id = ?`).run(message.createdAt, input.threadId)
  return message
}
