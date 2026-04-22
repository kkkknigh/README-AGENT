import type {
  RemoteBootstrapPayload,
  RemoteDocumentDto,
  RemoteGraphEdgeDto,
  RemoteGraphNodeDto,
  RemoteGraphProjectDto,
  RemoteHighlightDto,
  RemoteNoteDto,
} from "@readmeclaw/remote-contracts"
import { db } from "../db/index.js"
import { nowIso } from "./time.js"

function upsertDocument(document: RemoteDocumentDto, syncedAt: string) {
  db.prepare(`
    INSERT INTO remote_documents (
      remote_id, remote_updated_at, remote_deleted_at, payload_json, title, page_count, uploaded_at,
      process_status, html_status, last_synced_at, sync_state, last_sync_error
    ) VALUES (
      @remote_id, @remote_updated_at, NULL, @payload_json, @title, @page_count, @uploaded_at,
      @process_status, @html_status, @last_synced_at, 'clean', NULL
    )
    ON CONFLICT(remote_id) DO UPDATE SET
      remote_updated_at = excluded.remote_updated_at,
      payload_json = excluded.payload_json,
      title = excluded.title,
      page_count = excluded.page_count,
      uploaded_at = excluded.uploaded_at,
      process_status = excluded.process_status,
      html_status = excluded.html_status,
      last_synced_at = excluded.last_synced_at,
      sync_state = 'clean',
      last_sync_error = NULL
  `).run({
    remote_id: document.id,
    remote_updated_at: document.uploadedAt,
    payload_json: JSON.stringify(document),
    title: document.title,
    page_count: document.pageCount,
    uploaded_at: document.uploadedAt,
    process_status: document.processStatus,
    html_status: document.htmlStatus,
    last_synced_at: syncedAt,
  })
}

function upsertNote(note: RemoteNoteDto, syncedAt: string) {
  db.prepare(`
    INSERT INTO remote_notes (
      remote_id, remote_updated_at, remote_deleted_at, payload_json, title, pdf_remote_id,
      created_at, updated_at, last_synced_at, sync_state, last_sync_error
    ) VALUES (
      @remote_id, @remote_updated_at, NULL, @payload_json, @title, @pdf_remote_id,
      @created_at, @updated_at, @last_synced_at, 'clean', NULL
    )
    ON CONFLICT(remote_id) DO UPDATE SET
      remote_updated_at = excluded.remote_updated_at,
      payload_json = excluded.payload_json,
      title = excluded.title,
      pdf_remote_id = excluded.pdf_remote_id,
      created_at = excluded.created_at,
      updated_at = excluded.updated_at,
      last_synced_at = excluded.last_synced_at,
      sync_state = 'clean',
      last_sync_error = NULL
  `).run({
    remote_id: note.id,
    remote_updated_at: note.updatedAt,
    payload_json: JSON.stringify(note),
    title: note.title,
    pdf_remote_id: note.pdfId,
    created_at: note.createdAt,
    updated_at: note.updatedAt,
    last_synced_at: syncedAt,
  })
}

function upsertHighlight(highlight: RemoteHighlightDto, syncedAt: string) {
  db.prepare(`
    INSERT INTO remote_highlights (
      remote_id, remote_updated_at, remote_deleted_at, payload_json, pdf_remote_id, page_number,
      color, created_at, last_synced_at, sync_state, last_sync_error
    ) VALUES (
      @remote_id, @remote_updated_at, NULL, @payload_json, @pdf_remote_id, @page_number,
      @color, @created_at, @last_synced_at, 'clean', NULL
    )
    ON CONFLICT(remote_id) DO UPDATE SET
      remote_updated_at = excluded.remote_updated_at,
      payload_json = excluded.payload_json,
      pdf_remote_id = excluded.pdf_remote_id,
      page_number = excluded.page_number,
      color = excluded.color,
      created_at = excluded.created_at,
      last_synced_at = excluded.last_synced_at,
      sync_state = 'clean',
      last_sync_error = NULL
  `).run({
    remote_id: String(highlight.id),
    remote_updated_at: highlight.createdAt,
    payload_json: JSON.stringify(highlight),
    pdf_remote_id: highlight.pdfId,
    page_number: highlight.page,
    color: highlight.color,
    created_at: highlight.createdAt,
    last_synced_at: syncedAt,
  })
}

function upsertGraphProject(project: RemoteGraphProjectDto, syncedAt: string) {
  db.prepare(`
    INSERT INTO remote_graph_projects (
      remote_id, remote_updated_at, remote_deleted_at, payload_json, name, created_at, last_synced_at,
      sync_state, last_sync_error
    ) VALUES (
      @remote_id, @remote_updated_at, NULL, @payload_json, @name, @created_at, @last_synced_at,
      'clean', NULL
    )
    ON CONFLICT(remote_id) DO UPDATE SET
      remote_updated_at = excluded.remote_updated_at,
      payload_json = excluded.payload_json,
      name = excluded.name,
      created_at = excluded.created_at,
      last_synced_at = excluded.last_synced_at,
      sync_state = 'clean',
      last_sync_error = NULL
  `).run({
    remote_id: project.id,
    remote_updated_at: syncedAt,
    payload_json: JSON.stringify(project),
    name: project.name,
    created_at: syncedAt,
    last_synced_at: syncedAt,
  })
}

function upsertGraphNode(node: RemoteGraphNodeDto, syncedAt: string) {
  db.prepare(`
    INSERT INTO remote_graph_nodes (
      remote_id, remote_updated_at, remote_deleted_at, project_remote_id, payload_json, label,
      last_synced_at, sync_state, last_sync_error
    ) VALUES (
      @remote_id, @remote_updated_at, NULL, NULL, @payload_json, @label,
      @last_synced_at, 'clean', NULL
    )
    ON CONFLICT(remote_id) DO UPDATE SET
      remote_updated_at = excluded.remote_updated_at,
      payload_json = excluded.payload_json,
      label = excluded.label,
      last_synced_at = excluded.last_synced_at,
      sync_state = 'clean',
      last_sync_error = NULL
  `).run({
    remote_id: node.id,
    remote_updated_at: syncedAt,
    payload_json: JSON.stringify(node),
    label: node.label,
    last_synced_at: syncedAt,
  })
}

function upsertGraphEdge(edge: RemoteGraphEdgeDto, syncedAt: string) {
  db.prepare(`
    INSERT INTO remote_graph_edges (
      remote_id, remote_updated_at, remote_deleted_at, project_remote_id, payload_json,
      source_remote_id, target_remote_id, relation_type, last_synced_at, sync_state, last_sync_error
    ) VALUES (
      @remote_id, @remote_updated_at, NULL, NULL, @payload_json,
      @source_remote_id, @target_remote_id, @relation_type, @last_synced_at, 'clean', NULL
    )
    ON CONFLICT(remote_id) DO UPDATE SET
      remote_updated_at = excluded.remote_updated_at,
      payload_json = excluded.payload_json,
      source_remote_id = excluded.source_remote_id,
      target_remote_id = excluded.target_remote_id,
      relation_type = excluded.relation_type,
      last_synced_at = excluded.last_synced_at,
      sync_state = 'clean',
      last_sync_error = NULL
  `).run({
    remote_id: edge.id,
    remote_updated_at: syncedAt,
    payload_json: JSON.stringify(edge),
    source_remote_id: edge.sourceNodeId,
    target_remote_id: edge.targetNodeId,
    relation_type: edge.relationType,
    last_synced_at: syncedAt,
  })
}

export function bootstrapMirror(payload: RemoteBootstrapPayload) {
  const syncedAt = nowIso()
  const txn = db.transaction(() => {
    payload.documents.forEach((document) => upsertDocument(document, syncedAt))
    payload.notes.forEach((note) => upsertNote(note, syncedAt))
    payload.highlights.forEach((highlight) => upsertHighlight(highlight, syncedAt))
    payload.graphProjects.forEach((project) => upsertGraphProject(project, syncedAt))
    payload.graphNodes.forEach((node) => upsertGraphNode(node, syncedAt))
    payload.graphEdges.forEach((edge) => upsertGraphEdge(edge, syncedAt))

    db.prepare(`
      INSERT INTO sync_checkpoints (resource_name, cursor_value, last_synced_at, last_error)
      VALUES ('bootstrap', @cursor_value, @last_synced_at, NULL)
      ON CONFLICT(resource_name) DO UPDATE SET
        cursor_value = excluded.cursor_value,
        last_synced_at = excluded.last_synced_at,
        last_error = NULL
    `).run({
      cursor_value: payload.serverTime,
      last_synced_at: syncedAt,
    })
  })

  txn()
}

export function listRemoteDocuments() {
  const rows = db.prepare(`
    SELECT remote_id, payload_json, last_synced_at, sync_state, last_sync_error
    FROM remote_documents
    WHERE remote_deleted_at IS NULL
    ORDER BY uploaded_at DESC, title ASC
  `).all() as Array<{
    remote_id: string
    payload_json: string
    last_synced_at: string | null
    sync_state: string
    last_sync_error: string | null
  }>

  return rows.map((row) => ({
    ...JSON.parse(row.payload_json),
    syncMeta: {
      remoteId: row.remote_id,
      lastSyncedAt: row.last_synced_at,
      syncState: row.sync_state,
      lastSyncError: row.last_sync_error,
    },
  }))
}

export function listWorkspaceDocuments(workspaceId: string) {
  const rows = db.prepare(`
    SELECT d.payload_json
    FROM workspace_document_links l
    INNER JOIN remote_documents d ON d.remote_id = l.remote_document_id
    WHERE l.workspace_id = ?
    ORDER BY d.uploaded_at DESC, d.title ASC
  `).all(workspaceId) as Array<{ payload_json: string }>
  return rows.map((row) => JSON.parse(row.payload_json) as RemoteDocumentDto)
}
