import { Router } from "express"
import {
  bindDocumentToWorkspace,
  createWorkspace,
  getWorkspaceDetail,
  listWorkspaceTree,
  unbindDocumentFromWorkspace,
  updateWorkspace,
} from "../services/workspaces.js"

export const workspaceRouter = Router()

workspaceRouter.get("/tree", (_req, res) => {
  res.json({ items: listWorkspaceTree() })
})

workspaceRouter.get("/:id", (req, res) => {
  const detail = getWorkspaceDetail(req.params.id)
  if (!detail) {
    res.status(404).json({ message: "Workspace not found" })
    return
  }
  res.json(detail)
})

workspaceRouter.post("/", (req, res) => {
  const workspace = createWorkspace(req.body)
  res.status(201).json(workspace)
})

workspaceRouter.patch("/:id", (req, res) => {
  const workspace = updateWorkspace(req.params.id, req.body)
  if (!workspace) {
    res.status(404).json({ message: "Workspace not found" })
    return
  }
  res.json(workspace)
})

workspaceRouter.post("/:id/documents/:docId/bind", (req, res) => {
  const binding = bindDocumentToWorkspace(req.params.id, req.params.docId)
  res.status(201).json(binding)
})

workspaceRouter.delete("/:id/documents/:docId/bind", (req, res) => {
  unbindDocumentFromWorkspace(req.params.id, req.params.docId)
  res.status(204).end()
})
