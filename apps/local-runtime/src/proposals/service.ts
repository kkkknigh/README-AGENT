import { createProposal, getProposal, listPendingProposals, updateProposal } from "../repositories/proposals-repo.js"
import { nowIso } from "../services/time.js"

export function buildProposalDto(record: ReturnType<typeof createProposal> | NonNullable<ReturnType<typeof getProposal>>) {
  return {
    id: record.id,
    user_id: record.userId,
    session_id: record.sessionId,
    title: record.title,
    description: record.description,
    action_type: record.actionType,
    action_type_label: record.actionTypeLabel,
    action_params: JSON.parse(record.argsJson),
    status: record.status,
    review_comment: record.reviewComment ?? undefined,
    execution_result: record.executionResultJson ? JSON.parse(record.executionResultJson) : undefined,
    created_at: record.createdAt,
    reviewed_at: record.reviewedAt ?? undefined,
    executed_at: record.executedAt ?? undefined,
  }
}

export function createPendingProposal(input: {
  runId: string | null
  threadId: string
  toolName: string
  actionType: string
  actionTypeLabel: string
  title: string
  description: string
  args: Record<string, unknown>
  riskLevel: string
}) {
  return createProposal({
    runId: input.runId,
    threadId: input.threadId,
    sessionId: input.threadId,
    userId: "local-user",
    toolName: input.toolName,
    actionType: input.actionType,
    actionTypeLabel: input.actionTypeLabel,
    title: input.title,
    description: input.description,
    argsJson: JSON.stringify(input.args),
    riskLevel: input.riskLevel,
    status: "pending",
  })
}

export function listPendingProposalDtos() {
  return listPendingProposals().map(buildProposalDto)
}

export function markProposalReviewed(proposalId: string, action: "approve" | "reject", comment?: string) {
  const proposal = getProposal(proposalId)
  if (!proposal) return null

  return updateProposal(proposalId, {
    status: action === "approve" ? "approved" : "rejected",
    reviewComment: comment ?? null,
    reviewedAt: nowIso(),
  })
}

export function markProposalExecuted(proposalId: string, result: unknown) {
  return updateProposal(proposalId, {
    status: "executed",
    executionResultJson: JSON.stringify(result),
    executedAt: nowIso(),
  })
}

export function markProposalFailed(proposalId: string, error: string) {
  return updateProposal(proposalId, {
    status: "failed",
    executionResultJson: JSON.stringify({ error }),
    executedAt: nowIso(),
  })
}
