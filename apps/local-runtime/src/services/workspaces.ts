import type { WorkspaceBindingDto, WorkspaceDetailDto, WorkspaceNodeDto } from "@readmeclaw/shared-ui"
import { nanoid } from "nanoid"
import { db } from "../db/index.js"
import { listWorkspaceDocuments } from "./mirror.js"
import { slugify } from "./slug.js"
import { nowIso } from "./time.js"

function buildPath(name: string, parentPath: string | null) {
  const slug = slugify(name)
  return parentPath ? `${parentPath}/${slug}` : slug
}

export function listWorkspaceTree(): WorkspaceNodeDto[] {
  return db.prepare(`
    SELECT id, name, slug, parent_id as parentId, path, color, description, created_at as createdAt, updated_at as updatedAt
    FROM workspace_nodes
    ORDER BY path ASC
  `).all() as WorkspaceNodeDto[]
}

export function createWorkspace(input: {
  name: string
  parentId?: string | null
  color?: string | null
  description?: string | null
}) {
  const now = nowIso()
  const parent = input.parentId
    ? db.prepare(`SELECT path FROM workspace_nodes WHERE id = ?`).get(input.parentId) as { path: string } | undefined
    : undefined

  const slug = slugify(input.name)
  const path = buildPath(input.name, parent?.path ?? null)
  const workspace: WorkspaceNodeDto = {
    id: nanoid(),
    name: input.name,
    slug,
    parentId: input.parentId ?? null,
    path,
    color: input.color ?? null,
    description: input.description ?? null,
    createdAt: now,
    updatedAt: now,
    kind: "workspace",
  }

  db.prepare(`
    INSERT INTO workspace_nodes (id, name, slug, parent_id, path, color, description, created_at, updated_at)
    VALUES (@id, @name, @slug, @parentId, @path, @color, @description, @createdAt, @updatedAt)
  `).run(workspace)

  return workspace
}

export function updateWorkspace(id: string, patch: Partial<Pick<WorkspaceNodeDto, "name" | "color" | "description">>) {
  const existing = db.prepare(`
    SELECT id, name, slug, parent_id as parentId, path, color, description, created_at as createdAt, updated_at as updatedAt
    FROM workspace_nodes WHERE id = ?
  `).get(id) as WorkspaceNodeDto | undefined

  if (!existing) {
    return null
  }

  const now = nowIso()
  const name = patch.name ?? existing.name
  const slug = slugify(name)
  const parentPath = existing.parentId
    ? (db.prepare(`SELECT path FROM workspace_nodes WHERE id = ?`).get(existing.parentId) as { path: string } | undefined)?.path ?? null
    : null
  const path = buildPath(name, parentPath)

  const next: WorkspaceNodeDto = {
    ...existing,
    name,
    slug,
    path,
    color: patch.color ?? existing.color,
    description: patch.description ?? existing.description,
    updatedAt: now,
    kind: "workspace",
  }

  db.prepare(`
    UPDATE workspace_nodes
    SET name = @name, slug = @slug, path = @path, color = @color, description = @description, updated_at = @updatedAt
    WHERE id = @id
  `).run(next)

  return next
}

export function bindDocumentToWorkspace(workspaceId: string, remoteDocumentId: string): WorkspaceBindingDto {
  const createdAt = nowIso()
  db.prepare(`
    INSERT OR IGNORE INTO workspace_document_links (workspace_id, remote_document_id, created_at)
    VALUES (?, ?, ?)
  `).run(workspaceId, remoteDocumentId, createdAt)
  return { workspaceId, remoteId: remoteDocumentId, entityType: "document", createdAt }
}

export function unbindDocumentFromWorkspace(workspaceId: string, remoteDocumentId: string) {
  db.prepare(`
    DELETE FROM workspace_document_links
    WHERE workspace_id = ? AND remote_document_id = ?
  `).run(workspaceId, remoteDocumentId)
}

export function getWorkspaceDetail(workspaceId: string): WorkspaceDetailDto | null {
  const workspace = db.prepare(`
    SELECT id, name, slug, parent_id as parentId, path, color, description, created_at as createdAt, updated_at as updatedAt
    FROM workspace_nodes WHERE id = ?
  `).get(workspaceId) as WorkspaceNodeDto | undefined

  if (!workspace) {
    return null
  }

  return {
    workspace: {
      ...workspace,
      kind: "workspace",
    },
    documents: listWorkspaceDocuments(workspaceId),
    notes: [],
    graphProjects: [],
  }
}
