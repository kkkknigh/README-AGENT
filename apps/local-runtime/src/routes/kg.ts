import { Router } from "express"
import {
  createEdge,
  createNode,
  createProject,
  deleteEdge,
  deleteNode,
  getLocalGraph,
  getProjectDetail,
  getProjectTree,
  linkNoteToNode,
  linkPaperToNode,
  listProjects,
  recompose,
  setNodeParent,
  unlinkNoteFromNode,
  unlinkPaperFromNode,
  updateEdge,
  updateNode,
} from "../services/kg.js"

export const kgRouter = Router()

kgRouter.get("/projects", (_req, res) => {
  const projects = listProjects()
  res.json({ projects, total: projects.length })
})

kgRouter.post("/projects", (req, res) => {
  const project = createProject({
    name: String(req.body.name ?? ""),
    description: req.body.description == null ? undefined : String(req.body.description),
  })
  res.status(201).json(project)
})

kgRouter.get("/projects/:projectId", (req, res) => {
  const project = getProjectDetail(req.params.projectId)
  if (!project) {
    res.status(404).json({ message: "Project not found" })
    return
  }
  res.json(project)
})

kgRouter.get("/projects/:projectId/tree", (req, res) => {
  const tree = getProjectTree(req.params.projectId)
  if (!tree) {
    res.status(404).json({ message: "Project not found" })
    return
  }
  res.json(tree)
})

kgRouter.post("/projects/:projectId/nodes", (req, res) => {
  const node = createNode(req.params.projectId, {
    label: String(req.body.label ?? ""),
    description: req.body.description == null ? undefined : String(req.body.description),
    properties: req.body.properties && typeof req.body.properties === "object" ? req.body.properties : undefined,
    parent_id: req.body.parent_id == null ? undefined : String(req.body.parent_id),
  })
  if (!node) {
    res.status(404).json({ message: "Project not found" })
    return
  }
  res.status(201).json(node)
})

kgRouter.patch("/nodes/:nodeId", (req, res) => {
  const node = updateNode(req.params.nodeId, {
    label: req.body.label == null ? undefined : String(req.body.label),
    description: req.body.description == null ? undefined : String(req.body.description),
    properties: req.body.properties && typeof req.body.properties === "object" ? req.body.properties : undefined,
  })
  if (!node) {
    res.status(404).json({ message: "Node not found" })
    return
  }
  res.json(node)
})

kgRouter.delete("/nodes/:nodeId", (req, res) => {
  const deleted = deleteNode(req.params.nodeId)
  if (!deleted) {
    res.status(404).json({ message: "Node not found" })
    return
  }
  res.status(204).end()
})

kgRouter.post("/projects/:projectId/edges", (req, res) => {
  const edge = createEdge(req.params.projectId, {
    source_node_id: String(req.body.source_node_id ?? ""),
    target_node_id: String(req.body.target_node_id ?? ""),
    relation_type: req.body.relation_type == null ? undefined : String(req.body.relation_type),
    description: req.body.description == null ? undefined : String(req.body.description),
  })
  if (!edge) {
    res.status(404).json({ message: "Project not found" })
    return
  }
  res.status(201).json(edge)
})

kgRouter.patch("/edges/:edgeId", (req, res) => {
  const edge = updateEdge(req.params.edgeId, {
    relation_type: req.body.relation_type == null ? undefined : String(req.body.relation_type),
    description: req.body.description == null ? undefined : String(req.body.description),
  })
  if (!edge) {
    res.status(404).json({ message: "Edge not found" })
    return
  }
  res.json(edge)
})

kgRouter.delete("/edges/:edgeId", (req, res) => {
  const deleted = deleteEdge(req.params.edgeId)
  if (!deleted) {
    res.status(404).json({ message: "Edge not found" })
    return
  }
  res.status(204).end()
})

kgRouter.post("/nodes/:nodeId/parent", (req, res) => {
  const node = setNodeParent(req.params.nodeId, req.body.parentId == null ? null : String(req.body.parentId))
  if (!node) {
    res.status(404).json({ message: "Node not found" })
    return
  }
  res.json(node)
})

kgRouter.post("/nodes/:nodeId/papers/:paperId", (req, res) => {
  const ok = linkPaperToNode(req.params.nodeId, req.params.paperId)
  if (!ok) {
    res.status(404).json({ message: "Node not found" })
    return
  }
  res.json({ success: true })
})

kgRouter.delete("/nodes/:nodeId/papers/:paperId", (req, res) => {
  const ok = unlinkPaperFromNode(req.params.nodeId, req.params.paperId)
  if (!ok) {
    res.status(404).json({ message: "Node not found" })
    return
  }
  res.json({ success: true })
})

kgRouter.post("/nodes/:nodeId/notes/:noteId", (req, res) => {
  const ok = linkNoteToNode(req.params.nodeId, Number(req.params.noteId))
  if (!ok) {
    res.status(404).json({ message: "Node not found" })
    return
  }
  res.json({ success: true })
})

kgRouter.delete("/nodes/:nodeId/notes/:noteId", (req, res) => {
  const ok = unlinkNoteFromNode(req.params.nodeId, Number(req.params.noteId))
  if (!ok) {
    res.status(404).json({ message: "Node not found" })
    return
  }
  res.json({ success: true })
})

kgRouter.get("/local/:nodeId", (req, res) => {
  res.json(getLocalGraph(req.params.nodeId, Number(req.query.hops ?? 2)))
})

kgRouter.post("/recompose", (req, res) => {
  const result = recompose(req.body)
  if (!result) {
    res.status(404).json({ message: "Graph target not found" })
    return
  }
  res.json(result)
})
