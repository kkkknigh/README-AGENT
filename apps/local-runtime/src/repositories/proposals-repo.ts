import { nanoid } from "nanoid"
import { db } from "../db/index.js"
import { nowIso } from "../services/time.js"

export type ProposalStatus = "pending" | "approved" | "rejected" | "expired" | "executed" | "failed" | "cancelled"

export interface ProposalRecord {
  id: string
  runId: string | null
  threadId: string
  sessionId: string
  userId: string
  toolName: string
  actionType: string
  actionTypeLabel: string
  title: string
  description: string
  argsJson: string
  riskLevel: string
  status: ProposalStatus
  reviewComment: string | null
  executionResultJson: string | null
  createdAt: string
  reviewedAt: string | null
  executedAt: string | null
}

function mapRow(row: {
  id: string
  run_id: string | null
  thread_id: string
  session_id: string
  user_id: string
  tool_name: string
  action_type: string
  action_type_label: string
  title: string
  description: string
  args_json: string
  risk_level: string
  status: ProposalStatus
  review_comment: string | null
  execution_result_json: string | null
  created_at: string
  reviewed_at: string | null
  executed_at: string | null
}): ProposalRecord {
  return {
    id: row.id,
    runId: row.run_id,
    threadId: row.thread_id,
    sessionId: row.session_id,
    userId: row.user_id,
    toolName: row.tool_name,
    actionType: row.action_type,
    actionTypeLabel: row.action_type_label,
    title: row.title,
    description: row.description,
    argsJson: row.args_json,
    riskLevel: row.risk_level,
    status: row.status,
    reviewComment: row.review_comment,
    executionResultJson: row.execution_result_json,
    createdAt: row.created_at,
    reviewedAt: row.reviewed_at,
    executedAt: row.executed_at,
  }
}

export function createProposal(input: Omit<ProposalRecord, "id" | "createdAt" | "reviewedAt" | "executedAt" | "reviewComment" | "executionResultJson">) {
  const record: ProposalRecord = {
    id: nanoid(),
    runId: input.runId,
    threadId: input.threadId,
    sessionId: input.sessionId,
    userId: input.userId,
    toolName: input.toolName,
    actionType: input.actionType,
    actionTypeLabel: input.actionTypeLabel,
    title: input.title,
    description: input.description,
    argsJson: input.argsJson,
    riskLevel: input.riskLevel,
    status: input.status,
    reviewComment: null,
    executionResultJson: null,
    createdAt: nowIso(),
    reviewedAt: null,
    executedAt: null,
  }

  db.prepare(`
    INSERT INTO agent_proposals (
      id, run_id, thread_id, session_id, user_id, tool_name, action_type, action_type_label,
      title, description, args_json, risk_level, status, review_comment, execution_result_json,
      created_at, reviewed_at, executed_at
    ) VALUES (
      @id, @runId, @threadId, @sessionId, @userId, @toolName, @actionType, @actionTypeLabel,
      @title, @description, @argsJson, @riskLevel, @status, @reviewComment, @executionResultJson,
      @createdAt, @reviewedAt, @executedAt
    )
  `).run(record)

  return record
}

export function getProposal(proposalId: string) {
  const row = db.prepare(`
    SELECT *
    FROM agent_proposals
    WHERE id = ?
  `).get(proposalId) as Parameters<typeof mapRow>[0] | undefined

  return row ? mapRow(row) : null
}

export function listPendingProposals() {
  const rows = db.prepare(`
    SELECT *
    FROM agent_proposals
    WHERE status = 'pending'
    ORDER BY created_at ASC
  `).all() as Array<Parameters<typeof mapRow>[0]>

  return rows.map(mapRow)
}

export function updateProposal(
  proposalId: string,
  patch: Partial<Pick<ProposalRecord, "status" | "reviewComment" | "executionResultJson" | "reviewedAt" | "executedAt">>,
) {
  const existing = getProposal(proposalId)
  if (!existing) return null

  const next: ProposalRecord = {
    ...existing,
    status: patch.status ?? existing.status,
    reviewComment: patch.reviewComment ?? existing.reviewComment,
    executionResultJson: patch.executionResultJson ?? existing.executionResultJson,
    reviewedAt: patch.reviewedAt ?? existing.reviewedAt,
    executedAt: patch.executedAt ?? existing.executedAt,
  }

  db.prepare(`
    UPDATE agent_proposals
    SET status = @status,
        review_comment = @reviewComment,
        execution_result_json = @executionResultJson,
        reviewed_at = @reviewedAt,
        executed_at = @executedAt
    WHERE id = @id
  `).run(next)

  return next
}
