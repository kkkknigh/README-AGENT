import { nanoid } from "nanoid"
import { db } from "../db/index.js"
import { nowIso } from "../services/time.js"

export type AgentRunStatus = "queued" | "running" | "waiting_approval" | "completed" | "failed" | "aborted"
export type AgentRunMode = "chat" | "agent"

export interface AgentRunRecord {
  id: string
  threadId: string
  status: AgentRunStatus
  mode: AgentRunMode
  model: string | null
  contextJson: string
  createdAt: string
  updatedAt: string
  finishedAt: string | null
}

function mapRow(row: {
  id: string
  thread_id: string
  status: AgentRunStatus
  mode: AgentRunMode
  model: string | null
  context_json: string
  created_at: string
  updated_at: string
  finished_at: string | null
}): AgentRunRecord {
  return {
    id: row.id,
    threadId: row.thread_id,
    status: row.status,
    mode: row.mode,
    model: row.model,
    contextJson: row.context_json,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    finishedAt: row.finished_at,
  }
}

export function createRun(input: {
  threadId: string
  status?: AgentRunStatus
  mode: AgentRunMode
  model?: string | null
  contextJson: string
}) {
  const now = nowIso()
  const record: AgentRunRecord = {
    id: nanoid(),
    threadId: input.threadId,
    status: input.status ?? "queued",
    mode: input.mode,
    model: input.model ?? null,
    contextJson: input.contextJson,
    createdAt: now,
    updatedAt: now,
    finishedAt: null,
  }

  db.prepare(`
    INSERT INTO agent_runs (id, thread_id, status, mode, model, context_json, created_at, updated_at, finished_at)
    VALUES (@id, @threadId, @status, @mode, @model, @contextJson, @createdAt, @updatedAt, @finishedAt)
  `).run(record)

  return record
}

export function getRun(runId: string) {
  const row = db.prepare(`
    SELECT id, thread_id, status, mode, model, context_json, created_at, updated_at, finished_at
    FROM agent_runs
    WHERE id = ?
  `).get(runId) as Parameters<typeof mapRow>[0] | undefined

  return row ? mapRow(row) : null
}

export function listRunsForThread(threadId: string) {
  const rows = db.prepare(`
    SELECT id, thread_id, status, mode, model, context_json, created_at, updated_at, finished_at
    FROM agent_runs
    WHERE thread_id = ?
    ORDER BY created_at DESC
  `).all(threadId) as Array<Parameters<typeof mapRow>[0]>

  return rows.map(mapRow)
}

export function getLatestRunForThread(threadId: string) {
  const row = db.prepare(`
    SELECT id, thread_id, status, mode, model, context_json, created_at, updated_at, finished_at
    FROM agent_runs
    WHERE thread_id = ?
    ORDER BY created_at DESC
    LIMIT 1
  `).get(threadId) as Parameters<typeof mapRow>[0] | undefined

  return row ? mapRow(row) : null
}

export function updateRun(runId: string, patch: Partial<Pick<AgentRunRecord, "status" | "contextJson" | "finishedAt">>) {
  const existing = getRun(runId)
  if (!existing) return null

  const next: AgentRunRecord = {
    ...existing,
    status: patch.status ?? existing.status,
    contextJson: patch.contextJson ?? existing.contextJson,
    updatedAt: nowIso(),
    finishedAt: patch.finishedAt ?? existing.finishedAt,
  }

  db.prepare(`
    UPDATE agent_runs
    SET status = @status,
        context_json = @contextJson,
        updated_at = @updatedAt,
        finished_at = @finishedAt
    WHERE id = @id
  `).run(next)

  return next
}
