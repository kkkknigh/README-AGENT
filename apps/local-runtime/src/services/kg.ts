import { nanoid } from "nanoid"
import { db } from "../db/index.js"
import { nowIso } from "./time.js"

export interface GraphNodeRecord {
  id: string
  label: string
  description: string | null
  properties: Record<string, unknown> | null
  parent_id: string | null
  is_root: boolean
  linked_paper_ids: string[]
  linked_note_ids: number[]
  created_at: string | null
}

export interface GraphEdgeRecord {
  id: string
  source_node_id: string
  target_node_id: string
  relation_type: string
  description: string | null
  created_at: string | null
}

export interface GraphProjectDetail {
  id: string
  name: string
  description: string | null
  node_count: number
  edge_count: number
  paper_count: number
  created_at: string | null
  updated_at: string | null
  nodes: GraphNodeRecord[]
  edges: GraphEdgeRecord[]
  paper_ids: string[]
}

interface ProjectTreeNode {
  id: string
  label: string
  description: string | null
  properties: Record<string, unknown> | null
  is_root: boolean
  linked_paper_count: number
  linked_note_count: number
  children: ProjectTreeNode[]
}

function getProjectRow(projectId: string) {
  return db.prepare(`
    SELECT payload_json
    FROM remote_graph_projects
    WHERE remote_id = ? AND remote_deleted_at IS NULL
  `).get(projectId) as { payload_json: string } | undefined
}

function saveProject(detail: GraphProjectDetail) {
  const now = nowIso()
  const payload = {
    ...detail,
    node_count: detail.nodes.length,
    edge_count: detail.edges.length,
    paper_count: detail.paper_ids.length,
    updated_at: now,
  }

  db.prepare(`
    INSERT INTO remote_graph_projects (
      remote_id, remote_updated_at, remote_deleted_at, payload_json, name, created_at, last_synced_at,
      sync_state, last_sync_error
    ) VALUES (
      @id, @updated_at, NULL, @payload_json, @name, @created_at, @updated_at,
      'dirty_local', NULL
    )
    ON CONFLICT(remote_id) DO UPDATE SET
      remote_updated_at = excluded.remote_updated_at,
      remote_deleted_at = NULL,
      payload_json = excluded.payload_json,
      name = excluded.name,
      last_synced_at = excluded.last_synced_at,
      sync_state = 'dirty_local',
      last_sync_error = NULL
  `).run({
    ...payload,
    payload_json: JSON.stringify(payload),
  })

  return payload
}

export function listProjects() {
  const rows = db.prepare(`
    SELECT payload_json
    FROM remote_graph_projects
    WHERE remote_deleted_at IS NULL
    ORDER BY created_at ASC, remote_id ASC
  `).all() as Array<{ payload_json: string }>

  return rows.map((row) => JSON.parse(row.payload_json) as GraphProjectDetail).map((project) => ({
    id: project.id,
    name: project.name,
    description: project.description,
    node_count: project.nodes.length,
    edge_count: project.edges.length,
    paper_count: project.paper_ids.length,
    created_at: project.created_at,
    updated_at: project.updated_at,
  }))
}

export function createProject(input: { name: string; description?: string }) {
  const now = nowIso()
  return saveProject({
    id: nanoid(),
    name: input.name,
    description: input.description ?? null,
    node_count: 0,
    edge_count: 0,
    paper_count: 0,
    created_at: now,
    updated_at: now,
    nodes: [],
    edges: [],
    paper_ids: [],
  })
}

export function getProjectDetail(projectId: string) {
  const row = getProjectRow(projectId)
  if (!row) return null
  const project = JSON.parse(row.payload_json) as GraphProjectDetail
  return {
    ...project,
    node_count: project.nodes.length,
    edge_count: project.edges.length,
    paper_count: project.paper_ids.length,
  }
}

export function createNode(projectId: string, input: {
  label: string
  description?: string
  properties?: Record<string, unknown>
  parent_id?: string | null
}) {
  const project = getProjectDetail(projectId)
  if (!project) return null
  const node: GraphNodeRecord = {
    id: nanoid(),
    label: input.label,
    description: input.description ?? null,
    properties: input.properties ?? null,
    parent_id: input.parent_id ?? null,
    is_root: !input.parent_id,
    linked_paper_ids: [],
    linked_note_ids: [],
    created_at: nowIso(),
  }
  project.nodes.push(node)
  saveProject(project)
  return node
}

export function updateNode(nodeId: string, patch: {
  label?: string
  description?: string
  properties?: Record<string, unknown>
}) {
  const project = findProjectByNode(nodeId)
  if (!project) return null
  const node = project.nodes.find((item) => item.id === nodeId)
  if (!node) return null
  if (patch.label !== undefined) node.label = patch.label
  if (patch.description !== undefined) node.description = patch.description
  if (patch.properties !== undefined) node.properties = patch.properties
  saveProject(project)
  return node
}

export function deleteNode(nodeId: string) {
  const project = findProjectByNode(nodeId)
  if (!project) return false
  project.nodes = project.nodes.filter((item) => item.id !== nodeId)
  project.edges = project.edges.filter((item) => item.source_node_id !== nodeId && item.target_node_id !== nodeId)
  for (const node of project.nodes) {
    if (node.parent_id === nodeId) {
      node.parent_id = null
      node.is_root = true
    }
    node.linked_note_ids = [...new Set(node.linked_note_ids)]
    node.linked_paper_ids = [...new Set(node.linked_paper_ids)]
  }
  project.paper_ids = collectProjectPaperIds(project)
  saveProject(project)
  return true
}

export function createEdge(projectId: string, input: {
  source_node_id: string
  target_node_id: string
  relation_type?: string
  description?: string
}) {
  const project = getProjectDetail(projectId)
  if (!project) return null
  const edge: GraphEdgeRecord = {
    id: nanoid(),
    source_node_id: input.source_node_id,
    target_node_id: input.target_node_id,
    relation_type: input.relation_type ?? "related_to",
    description: input.description ?? null,
    created_at: nowIso(),
  }
  project.edges.push(edge)
  saveProject(project)
  return edge
}

export function updateEdge(edgeId: string, patch: { relation_type?: string; description?: string }) {
  const project = findProjectByEdge(edgeId)
  if (!project) return null
  const edge = project.edges.find((item) => item.id === edgeId)
  if (!edge) return null
  if (patch.relation_type !== undefined) edge.relation_type = patch.relation_type
  if (patch.description !== undefined) edge.description = patch.description
  saveProject(project)
  return edge
}

export function deleteEdge(edgeId: string) {
  const project = findProjectByEdge(edgeId)
  if (!project) return false
  project.edges = project.edges.filter((item) => item.id !== edgeId)
  saveProject(project)
  return true
}

export function setNodeParent(nodeId: string, parentId: string | null) {
  const project = findProjectByNode(nodeId)
  if (!project) return null
  const node = project.nodes.find((item) => item.id === nodeId)
  if (!node) return null
  node.parent_id = parentId
  node.is_root = !parentId
  saveProject(project)
  return node
}

export function linkPaperToNode(nodeId: string, paperId: string) {
  const project = findProjectByNode(nodeId)
  if (!project) return false
  const node = project.nodes.find((item) => item.id === nodeId)
  if (!node) return false
  if (!node.linked_paper_ids.includes(paperId)) node.linked_paper_ids.push(paperId)
  project.paper_ids = collectProjectPaperIds(project)
  saveProject(project)
  return true
}

export function unlinkPaperFromNode(nodeId: string, paperId: string) {
  const project = findProjectByNode(nodeId)
  if (!project) return false
  const node = project.nodes.find((item) => item.id === nodeId)
  if (!node) return false
  node.linked_paper_ids = node.linked_paper_ids.filter((item) => item !== paperId)
  project.paper_ids = collectProjectPaperIds(project)
  saveProject(project)
  return true
}

export function linkNoteToNode(nodeId: string, noteId: number) {
  const project = findProjectByNode(nodeId)
  if (!project) return false
  const node = project.nodes.find((item) => item.id === nodeId)
  if (!node) return false
  if (!node.linked_note_ids.includes(noteId)) node.linked_note_ids.push(noteId)
  saveProject(project)
  return true
}

export function unlinkNoteFromNode(nodeId: string, noteId: number) {
  const project = findProjectByNode(nodeId)
  if (!project) return false
  const node = project.nodes.find((item) => item.id === nodeId)
  if (!node) return false
  node.linked_note_ids = node.linked_note_ids.filter((item) => item !== noteId)
  saveProject(project)
  return true
}

export function getProjectTree(projectId: string) {
  const project = getProjectDetail(projectId)
  if (!project) return null
  const byParent = new Map<string | null, GraphNodeRecord[]>()
  for (const node of project.nodes) {
    const key = node.parent_id ?? null
    const bucket = byParent.get(key) ?? []
    bucket.push(node)
    byParent.set(key, bucket)
  }

  const buildNode = (node: GraphNodeRecord): ProjectTreeNode => ({
    id: node.id,
    label: node.label,
    description: node.description,
    properties: node.properties,
    is_root: node.is_root,
    linked_paper_count: node.linked_paper_ids.length,
    linked_note_count: node.linked_note_ids.length,
    children: (byParent.get(node.id) ?? []).map(buildNode),
  })

  const roots = project.nodes.filter((node) => !node.parent_id).map(buildNode)
  return {
    project_id: project.id,
    tree: roots.filter((node) => node.is_root),
    orphans: roots.filter((node) => !node.is_root),
  }
}

export function getLocalGraph(nodeId: string, hops = 2) {
  const project = findProjectByNode(nodeId)
  if (!project) {
    return { center_node_id: nodeId, nodes: [], edges: [], hops }
  }

  const visited = new Set<string>([nodeId])
  let frontier = new Set<string>([nodeId])

  for (let i = 0; i < hops; i += 1) {
    const next = new Set<string>()
    for (const edge of project.edges) {
      if (frontier.has(edge.source_node_id)) next.add(edge.target_node_id)
      if (frontier.has(edge.target_node_id)) next.add(edge.source_node_id)
    }
    for (const id of next) visited.add(id)
    frontier = next
  }

  return {
    center_node_id: nodeId,
    nodes: project.nodes.filter((node) => visited.has(node.id)),
    edges: project.edges.filter((edge) => visited.has(edge.source_node_id) && visited.has(edge.target_node_id)),
    hops,
  }
}

export function recompose(payload: {
  operation: "merge_nodes" | "reconnect_edge" | "swap_direction"
  node1_id?: string
  node2_id?: string
  edge_id?: string
  target_node_id?: string
}) {
  const project = payload.edge_id
    ? findProjectByEdge(payload.edge_id)
    : (payload.node1_id ? findProjectByNode(payload.node1_id) : null)
  if (!project) return null

  if (payload.operation === "swap_direction" && payload.edge_id) {
    const edge = project.edges.find((item) => item.id === payload.edge_id)
    if (!edge) return null
    const source = edge.source_node_id
    edge.source_node_id = edge.target_node_id
    edge.target_node_id = source
    saveProject(project)
    return { operation: payload.operation, result: edge }
  }

  if (payload.operation === "reconnect_edge" && payload.edge_id && payload.target_node_id) {
    const edge = project.edges.find((item) => item.id === payload.edge_id)
    if (!edge) return null
    edge.target_node_id = payload.target_node_id
    saveProject(project)
    return { operation: payload.operation, result: edge }
  }

  if (payload.operation === "merge_nodes" && payload.node1_id && payload.node2_id) {
    const target = project.nodes.find((item) => item.id === payload.node1_id)
    const source = project.nodes.find((item) => item.id === payload.node2_id)
    if (!target || !source) return null
    target.linked_note_ids = [...new Set([...target.linked_note_ids, ...source.linked_note_ids])]
    target.linked_paper_ids = [...new Set([...target.linked_paper_ids, ...source.linked_paper_ids])]
    project.nodes = project.nodes.filter((item) => item.id !== payload.node2_id)
    for (const edge of project.edges) {
      if (edge.source_node_id === payload.node2_id) edge.source_node_id = payload.node1_id
      if (edge.target_node_id === payload.node2_id) edge.target_node_id = payload.node1_id
    }
    project.paper_ids = collectProjectPaperIds(project)
    saveProject(project)
    return { operation: payload.operation, result: target }
  }

  return null
}

function findProjectByNode(nodeId: string) {
  return getAllProjectDetails().find((project) => project.nodes.some((node) => node.id === nodeId)) ?? null
}

function findProjectByEdge(edgeId: string) {
  return getAllProjectDetails().find((project) => project.edges.some((edge) => edge.id === edgeId)) ?? null
}

function getAllProjectDetails() {
  const rows = db.prepare(`
    SELECT payload_json
    FROM remote_graph_projects
    WHERE remote_deleted_at IS NULL
    ORDER BY created_at ASC, remote_id ASC
  `).all() as Array<{ payload_json: string }>
  return rows.map((row) => JSON.parse(row.payload_json) as GraphProjectDetail)
}

function collectProjectPaperIds(project: GraphProjectDetail) {
  return [...new Set(project.nodes.flatMap((node) => node.linked_paper_ids))]
}
