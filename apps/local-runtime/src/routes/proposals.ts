import { Router } from "express"
import { executeProposal } from "../proposals/executor.js"
import { getProposal } from "../repositories/proposals-repo.js"
import { markProposalExecuted, markProposalFailed, markProposalReviewed, listPendingProposalDtos, buildProposalDto } from "../proposals/service.js"

export const proposalRouter = Router()

function buildMutationPayload(actionType: string, data: any) {
  if (actionType === "manage_notes") {
    return {
      resource: "notes",
      action: data?.id ? "upsert" : "update",
      detail: {
        paper_id: data?.pdfId ?? null,
        note_id: data?.id ?? null,
      },
    }
  }
  if (actionType === "manage_kg_node") {
    return {
      resource: "kg_node",
      action: "upsert",
      detail: {
        node_id: data?.id ?? null,
      },
    }
  }
  if (actionType === "manage_kg_edge") {
    return {
      resource: "kg_edge",
      action: "upsert",
      detail: {
        edge_id: data?.id ?? null,
      },
    }
  }
  if (actionType === "tag") {
    return {
      resource: "tag",
      action: "update",
      detail: {
        paper_id: data?.id ?? null,
      },
    }
  }
  return null
}

proposalRouter.get("/", (_req, res) => {
  res.json({ proposals: listPendingProposalDtos() })
})

proposalRouter.get("/:id", (req, res) => {
  const proposal = getProposal(req.params.id)
  res.json({ proposal: proposal ? buildProposalDto(proposal) : null })
})

proposalRouter.post("/:id/action", async (req, res, next) => {
  try {
    const action = req.body.action === "approve" ? "approve" : "reject"
    const comment = req.body.comment == null ? undefined : String(req.body.comment)
    const reviewed = markProposalReviewed(req.params.id, action, comment)
    if (!reviewed) {
      res.status(404).json({ success: false, message: "Proposal not found" })
      return
    }

    if (action === "reject") {
      res.json({ success: true, proposal: buildProposalDto(reviewed) })
      return
    }

    try {
      const executed = await executeProposal(req.params.id)
      const next = markProposalExecuted(req.params.id, executed.result.data)
      res.json({
        success: true,
        proposal: next ? buildProposalDto(next) : buildProposalDto(reviewed),
        mutation: buildMutationPayload(reviewed.actionType, executed.result.data),
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const failed = markProposalFailed(req.params.id, message)
      res.status(500).json({ success: false, proposal: failed ? buildProposalDto(failed) : null, message })
    }
  } catch (error) {
    next(error)
  }
})
