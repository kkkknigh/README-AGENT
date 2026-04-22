import { getParsedDocument } from "../services/document-cache.js"
import { getProjectDetail, createEdge, createNode } from "../services/kg.js"
import { listDocuments, addDocumentTag, removeDocumentTag } from "../services/library.js"
import { listNotes, createNote, updateNote } from "../services/notes.js"
import { searchDocumentChunks } from "../services/search.js"
import { getWorkspaceDetail } from "../services/workspaces.js"
import type { AgentTool } from "./types.js"

function buildChunkCitations(items: ReturnType<typeof searchDocumentChunks>) {
  return items.map((item) => ({
    source_type: "vector",
    id: item.chunkId,
    text: item.text,
    page: item.page ?? undefined,
    score: item.score,
  }))
}

export const toolRegistry: AgentTool[] = [
  {
    name: "document.search_chunks",
    description: "Search paragraph chunks from the current document or workspace documents.",
    risk: "readonly",
    requiresApproval: false,
    actionType: "search",
    actionTypeLabel: "SEARCH",
    execute: (ctx, args) => {
      const query = String(args.query ?? "").trim()
      const items = searchDocumentChunks({
        query,
        documentId: typeof args.documentId === "string" ? args.documentId : ctx.effectiveDocumentId ?? undefined,
        workspaceId: typeof args.workspaceId === "string" ? args.workspaceId : ctx.effectiveWorkspaceId ?? undefined,
        limit: Number(args.limit ?? 6),
      })
      return {
        summary: items.length > 0
          ? `Found ${items.length} matching chunks for "${query}".`
          : `No chunks found for "${query}".`,
        data: items,
        citations: buildChunkCitations(items),
      }
    },
  },
  {
    name: "document.get_paragraphs",
    description: "Get preview paragraphs from the current document.",
    risk: "readonly",
    requiresApproval: false,
    actionType: "search",
    actionTypeLabel: "SEARCH",
    execute: (ctx, args) => {
      const documentId = String(args.documentId ?? ctx.effectiveDocumentId ?? "")
      const parsed = getParsedDocument(documentId)
      const page = args.page == null ? null : Number(args.page)
      const paragraphs = parsed?.paragraphs.filter((item) => page == null || item.page === page).slice(0, 12) ?? []
      return {
        summary: `Loaded ${paragraphs.length} paragraphs from document ${documentId}.`,
        data: paragraphs,
      }
    },
  },
  {
    name: "document.get_layout",
    description: "Get layout overlays for the current document.",
    risk: "readonly",
    requiresApproval: false,
    actionType: "search",
    actionTypeLabel: "SEARCH",
    execute: (ctx, args) => {
      const documentId = String(args.documentId ?? ctx.effectiveDocumentId ?? "")
      const parsed = getParsedDocument(documentId)
      return {
        summary: parsed ? `Loaded document layout for ${documentId}.` : `Document ${documentId} was not found.`,
        data: parsed?.layout ?? null,
      }
    },
  },
  {
    name: "document.explain_overlay",
    description: "Describe layout objects already extracted from the current document.",
    risk: "readonly",
    requiresApproval: false,
    actionType: "search",
    actionTypeLabel: "SEARCH",
    execute: (ctx, args) => {
      const documentId = String(args.documentId ?? ctx.effectiveDocumentId ?? "")
      const parsed = getParsedDocument(documentId)
      const page = Number(args.page ?? 1)
      const kind = String(args.kind ?? "image")
      const collection = kind === "table" ? parsed?.layout.tables : kind === "formula" ? parsed?.layout.formulas : parsed?.layout.images
      const matches = (collection ?? []).filter((item) => item.page === page)
      return {
        summary: `Found ${matches.length} ${kind} overlays on page ${page}.`,
        data: matches,
      }
    },
  },
  {
    name: "library.list_documents",
    description: "List documents from the local library.",
    risk: "readonly",
    requiresApproval: false,
    actionType: "search",
    actionTypeLabel: "SEARCH",
    execute: (_ctx, args) => {
      const items = listDocuments({
        keyword: args.keyword == null ? undefined : String(args.keyword),
        group: args.group == null ? undefined : String(args.group),
      })
      return {
        summary: `Loaded ${items.length} documents from the local library.`,
        data: items.slice(0, 20),
      }
    },
  },
  {
    name: "workspace.list_documents",
    description: "List documents bound to the current workspace.",
    risk: "readonly",
    requiresApproval: false,
    actionType: "search",
    actionTypeLabel: "SEARCH",
    execute: (ctx, args) => {
      const workspaceId = String(args.workspaceId ?? ctx.effectiveWorkspaceId ?? "")
      const detail = getWorkspaceDetail(workspaceId)
      return {
        summary: detail ? `Workspace ${detail.workspace.name} has ${detail.documents.length} documents.` : `Workspace ${workspaceId} not found.`,
        data: detail?.documents ?? [],
      }
    },
  },
  {
    name: "notes.list",
    description: "List notes for the current document or the full local store.",
    risk: "readonly",
    requiresApproval: false,
    actionType: "manage_notes",
    actionTypeLabel: "NOTES",
    execute: (ctx, args) => {
      const notes = listNotes(typeof args.pdfId === "string" ? args.pdfId : ctx.effectiveDocumentId ?? undefined)
      return {
        summary: `Loaded ${notes.length} notes.`,
        data: notes,
      }
    },
  },
  {
    name: "kg.get_project",
    description: "Load a local knowledge graph project.",
    risk: "readonly",
    requiresApproval: false,
    actionType: "manage_kg_node",
    actionTypeLabel: "KG",
    execute: (_ctx, args) => {
      const projectId = String(args.projectId ?? "")
      const project = getProjectDetail(projectId)
      return {
        summary: project ? `Loaded KG project ${project.name}.` : `Project ${projectId} not found.`,
        data: project,
      }
    },
  },
  {
    name: "notes.create",
    description: "Create a local note for a document.",
    risk: "mutating",
    requiresApproval: true,
    actionType: "manage_notes",
    actionTypeLabel: "NOTES",
    execute: (_ctx, args) => {
      const note = createNote({
        pdfId: String(args.pdfId ?? ""),
        title: args.title == null ? undefined : String(args.title),
        content: String(args.content ?? ""),
        tags: Array.isArray(args.tags) ? args.tags.map(String) : [],
      })
      return {
        summary: `Created note ${note.id}.`,
        data: note,
      }
    },
  },
  {
    name: "notes.update",
    description: "Update an existing local note.",
    risk: "mutating",
    requiresApproval: true,
    actionType: "manage_notes",
    actionTypeLabel: "NOTES",
    execute: (_ctx, args) => {
      const note = updateNote(Number(args.id), {
        title: args.title == null ? undefined : String(args.title),
        content: args.content == null ? undefined : String(args.content),
        tags: Array.isArray(args.tags) ? args.tags.map(String) : undefined,
      })
      if (!note) throw new Error(`Note ${args.id} not found`)
      return {
        summary: `Updated note ${note.id}.`,
        data: note,
      }
    },
  },
  {
    name: "kg.create_node",
    description: "Create a node in a local knowledge graph project.",
    risk: "mutating",
    requiresApproval: true,
    actionType: "manage_kg_node",
    actionTypeLabel: "KG NODE",
    execute: (_ctx, args) => {
      const node = createNode(String(args.projectId ?? ""), {
        label: String(args.label ?? ""),
        description: args.description == null ? undefined : String(args.description),
        properties: args.properties && typeof args.properties === "object" ? args.properties as Record<string, unknown> : undefined,
        parent_id: args.parent_id == null ? undefined : String(args.parent_id),
      })
      if (!node) throw new Error(`Project ${args.projectId} not found`)
      return {
        summary: `Created node ${node.id}.`,
        data: node,
      }
    },
  },
  {
    name: "kg.create_edge",
    description: "Create an edge in a local knowledge graph project.",
    risk: "mutating",
    requiresApproval: true,
    actionType: "manage_kg_edge",
    actionTypeLabel: "KG EDGE",
    execute: (_ctx, args) => {
      const edge = createEdge(String(args.projectId ?? ""), {
        source_node_id: String(args.source_node_id ?? ""),
        target_node_id: String(args.target_node_id ?? ""),
        relation_type: args.relation_type == null ? undefined : String(args.relation_type),
        description: args.description == null ? undefined : String(args.description),
      })
      if (!edge) throw new Error(`Project ${args.projectId} not found`)
      return {
        summary: `Created edge ${edge.id}.`,
        data: edge,
      }
    },
  },
  {
    name: "library.add_tag",
    description: "Add a tag to a library document.",
    risk: "mutating",
    requiresApproval: true,
    actionType: "tag",
    actionTypeLabel: "TAG",
    execute: (_ctx, args) => {
      const document = addDocumentTag(String(args.pdfId ?? ""), String(args.tag ?? ""))
      if (!document) throw new Error(`Document ${args.pdfId} not found`)
      return {
        summary: `Added tag ${args.tag} to ${document.title}.`,
        data: document,
      }
    },
  },
  {
    name: "library.remove_tag",
    description: "Remove a tag from a library document.",
    risk: "mutating",
    requiresApproval: true,
    actionType: "tag",
    actionTypeLabel: "TAG",
    execute: (_ctx, args) => {
      const document = removeDocumentTag(String(args.pdfId ?? ""), String(args.tag ?? ""))
      if (!document) throw new Error(`Document ${args.pdfId} not found`)
      return {
        summary: `Removed tag ${args.tag} from ${document.title}.`,
        data: document,
      }
    },
  },
]

export function getTool(name: string) {
  return toolRegistry.find((tool) => tool.name === name) ?? null
}
