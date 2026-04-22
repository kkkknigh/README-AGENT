import { Router } from "express"

export const proposalRouter = Router()

proposalRouter.get("/", (_req, res) => {
  res.json({ proposals: [] })
})

proposalRouter.get("/:id", (_req, res) => {
  res.json({ proposal: null })
})

proposalRouter.post("/:id/action", (_req, res) => {
  res.json({ success: true, proposal: null, message: "No pending proposal in local runtime." })
})
