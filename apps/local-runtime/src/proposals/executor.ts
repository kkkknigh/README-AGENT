import { buildThreadContext } from "../agent-runtime/context-builder.js"
import { dispatchToolCall } from "../agent-runtime/tool-dispatcher.js"
import { getProposal } from "../repositories/proposals-repo.js"

export async function executeProposal(proposalId: string) {
  const proposal = getProposal(proposalId)
  if (!proposal) {
    throw new Error("Proposal not found")
  }

  const ctx = buildThreadContext(proposal.threadId)
  const args = JSON.parse(proposal.argsJson) as Record<string, unknown>
  return dispatchToolCall({
    ctx,
    toolName: proposal.toolName,
    args,
  })
}
