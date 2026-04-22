import type {
  Brief,
  CreateNoteRequest,
  InternalLinkData,
  Note,
  NoteActionResponse,
  NoteListResponse,
  PdfParagraph,
  ProposalInfo,
  Roadmap,
  Translation,
  UpdateNoteRequest,
} from "../types"
import type { UserProfile } from "../stores/profile"
import {
  api,
  arrayBufferToBase64,
  getAccessToken,
  getPdfBlob,
  getRefreshToken,
  isAuthenticated,
  openStreamResponse,
  setBlobForDocument,
  setTokens,
  clearTokens,
  deleteBlobForDocument,
  slugify,
} from "./core"

export type { Note, CreateNoteRequest, UpdateNoteRequest, NoteActionResponse, NoteListResponse } from "../types"
export type { InternalLinkData } from "../types"

export type ChatMode = "agent" | "chat"

type StreamHandlers<T> = {
  onMessage: (data: T) => void
  onDone?: () => void
  onError?: (error: unknown) => void
}

type ChatStreamRunStartedEvent = {
  type: "run_started"
  runId: string
  sessionId: string
}

type ChatStreamStepEvent = {
  type: "step"
  sessionId?: string
  step?: string
  status?: "running" | "done"
}

type ChatStreamChunkEvent = {
  type: "chunk"
  sessionId?: string
  delta?: string
}

type ChatStreamFinalEvent = {
  type: "final"
  sessionId?: string
  runId?: string
  response?: string
  citations?: any[]
  steps?: string[]
  context_used?: Record<string, any>
}

type ChatStreamThinkingEvent = {
  type: "thinking"
  sessionId?: string
  text?: string
}

type ChatStreamErrorEvent = {
  type: "error"
  sessionId?: string
  error?: string
}

type ChatStreamMutationEvent = {
  type: "mutation"
  sessionId?: string
  resource: string
  action: string
  detail?: Record<string, any>
}

type ChatStreamAckEvent = {
  type: "user_message_ack"
  sessionId?: string
  userMessageId: string | number
}

type ChatStreamProposalEvent = {
  type: "proposal"
  sessionId?: string
  proposal: ProposalInfo
}

export type ChatStreamEvent =
  | ChatStreamRunStartedEvent
  | ChatStreamStepEvent
  | ChatStreamChunkEvent
  | ChatStreamFinalEvent
  | ChatStreamThinkingEvent
  | ChatStreamErrorEvent
  | ChatStreamMutationEvent
  | ChatStreamAckEvent
  | ChatStreamProposalEvent

const activeRunIdsBySession = new Map<string, string>()

export interface PdfUploadResponse {
  pdfId?: string
  filename: string
  pageCount: number
  fileHash: string
  isNewUpload: boolean
  taskId?: string | null
  status?: "pending" | "processing" | "completed" | "failed" | "not_found" | "error"
  paragraphs?: PdfParagraph[]
}

export interface ImportLinkJobResponse {
  importTaskId: string
  status: "queued" | "completed"
  input: string
  pdfId?: string
  filename?: string
  pageCount?: number
  taskId?: string | null
  documentStatus?: string
  isNewUpload?: boolean
}

export type ImportJobSnapshotEvent = {
  type: "snapshot"
  jobId: string
  status: "queued" | "resolving" | "downloading" | "dispatching" | "processing" | "completed" | "failed"
  input?: string
  pdfId?: string
  taskId?: string | null
  filename?: string
  pageCount?: number
  documentStatus?: string
  isNewUpload?: boolean
  resolved?: Record<string, any>
  error?: string
}

export type ImportJobProgressEvent = {
  type: "progress"
  jobId: string
  status: "resolving" | "downloading" | "dispatching"
  input?: string
  pdfId?: string
  filename?: string
  resolved?: Record<string, any>
}

export type ImportJobReadyEvent = {
  type: "ready"
  jobId: string
  status: "processing" | "completed"
  input?: string
  pdfId: string
  taskId?: string | null
  filename?: string
  pageCount?: number
  documentStatus?: string
  isNewUpload?: boolean
  resolved?: Record<string, any>
}

export type ImportJobFailedEvent = {
  type: "failed"
  jobId?: string
  status: "failed"
  input?: string
  error: string
}

export type ImportJobHeartbeatEvent = {
  type: "heartbeat"
  ts: number
}

export type ImportJobEvent =
  | ImportJobSnapshotEvent
  | ImportJobProgressEvent
  | ImportJobReadyEvent
  | ImportJobFailedEvent
  | ImportJobHeartbeatEvent

export interface PdfLayoutResponse {
  pdfId: string
  layout: {
    images?: Array<{
      page: number
      index?: number
      bboxNorm: {
        left: number
        top: number
        width: number
        height: number
      }
    }>
    tables?: Array<{
      page: number
      index?: number
      bboxNorm: {
        left: number
        top: number
        width: number
        height: number
      }
    }>
    formulas?: Array<{
      page: number
      index?: number
      bboxNorm: {
        left: number
        top: number
        width: number
        height: number
      }
      latex?: string | null
    }>
  }
}

type SessionRecord = {
  id: string
  pdfId: string
  scope: "global" | "workspace" | "document"
  workspaceId: string | null
  title: string
  createdAt: string
  updatedAt: string
  messageCount: number
}

type SessionMessageRecord = {
  id: string
  role: string
  content: string
  created_time: string
  citations: any[]
  attachments: any[]
  thoughts?: string[]
  steps?: Array<{ text: string; status: "done" | "running" }>
  runId?: string | null
}

export interface GraphNodeRecord {
  id: string
  label: string
  description: string | null
  properties: Record<string, any> | null
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

export interface GraphProjectSummary {
  id: string
  name: string
  description: string | null
  node_count: number
  edge_count: number
  paper_count: number
  created_at: string | null
  updated_at: string | null
}

export interface GraphProjectDetail extends GraphProjectSummary {
  nodes: GraphNodeRecord[]
  edges: GraphEdgeRecord[]
  paper_ids: string[]
}

export interface KgTreeNode {
  id: string
  label: string
  description: string | null
  properties: Record<string, any> | null
  is_root: boolean
  linked_paper_count: number
  linked_note_count: number
  children: KgTreeNode[]
}

export interface KgTreeResponse {
  project_id: string
  tree: KgTreeNode[]
  orphans: KgTreeNode[]
}

export interface LocalGraphResponse {
  center_node_id: string
  nodes: GraphNodeRecord[]
  edges: GraphEdgeRecord[]
  hops: number
}

export interface RecomposePayload {
  operation: "merge_nodes" | "reconnect_edge" | "swap_direction"
  node1_id?: string
  node2_id?: string
  edge_id?: string
  target_node_id?: string
}

export interface RecomposeResult {
  operation: string
  result: GraphNodeRecord | GraphEdgeRecord
}

async function streamSse<T>(path: string, payload: unknown, handlers: StreamHandlers<T>, signal?: AbortSignal) {
  try {
    const response = await openStreamResponse(path, payload, true, signal)

    if (!response.ok || !response.body) {
      throw new Error(`HTTP ${response.status}`)
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ""
    let doneReceived = false

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const parts = buffer.split("\n\n")
      buffer = parts.pop() ?? ""

      for (const part of parts) {
        if (!part.startsWith("data: ")) continue
        const raw = part.slice(6).trim()
        if (!raw) continue
        if (raw === "[DONE]") {
          doneReceived = true
          handlers.onDone?.()
          return
        }
        handlers.onMessage(JSON.parse(raw) as T)
      }
    }

    if (!doneReceived) {
      handlers.onDone?.()
    }
  } catch (error) {
    handlers.onError?.(error)
    throw error
  }
}

export { getAccessToken, getRefreshToken, setTokens, clearTokens, isAuthenticated, openStreamResponse }

export const authApi = {
  register: async (username: string, email: string, password: string, inviteCode?: string) => (await api.post("/auth/register", { username, email, password, inviteCode })).data,
  verifyRegister: async (email?: string, code?: string) => (await api.post("/auth/verify-register", { email, code })).data,
  resendCode: async (email?: string, purpose?: "register" | "reset") => (await api.post("/auth/resend-code", { email, purpose })).data,
  forgotPassword: async (email?: string) => (await api.post("/auth/forgot-password", { email })).data,
  resetPassword: async (email?: string, code?: string, newPassword?: string) => (await api.post("/auth/reset-password", { email, code, newPassword })).data,
  login: async (email?: string, password?: string) => (await api.post("/auth/login", { email, password })).data,
  logout: async () => (await api.post("/auth/logout")).data,
  getMe: async () => (await api.get("/auth/me")).data,
  refreshToken: async () => (await api.post("/auth/refresh-token")).data,
  loginWithApiKey: async (apiKey?: string) => (await api.post("/auth/login/api-key", { apiKey })).data,
}

export const profileApi = {
  getMe: async (): Promise<UserProfile> => (await api.get("/profile/me")).data,
  updateMe: async (payload: Partial<{ username: string; bio: string | null; avatarUrl: string | null; preferences: Record<string, any> }>) => (await api.put("/profile/me", payload)).data,
  changePassword: async (oldPassword?: string, newPassword?: string) => (await api.post("/profile/password", { oldPassword, newPassword })).data,
  getStats: async () => (await api.get("/profile/stats")).data,
  deleteAccount: async (password?: string) => (await api.delete("/profile/me", { data: { password } })).data,
  getApiKeys: async () => (await api.get("/profile/api-keys")).data,
  createApiKey: async (name?: string, expiresInDays?: number | null) => (await api.post("/profile/api-keys", { name, expiresInDays })).data,
  deleteApiKey: async (keyId: string) => (await api.delete(`/profile/api-keys/${keyId}`)).data,
}

export const pdfApi = {
  upload: async (file: File): Promise<PdfUploadResponse> => {
    const fileBuffer = await file.arrayBuffer()
    const blob = new Blob([fileBuffer], { type: file.type || "application/pdf" })
    const contentBase64 = arrayBufferToBase64(fileBuffer)
    const response = await api.post("/imports/pdf", {
      filename: file.name,
      contentBase64,
    })
    const data = response.data as PdfUploadResponse
    const pdfId = data.pdfId || slugify(file.name.replace(/\.pdf$/i, "")) || file.name
    setBlobForDocument(pdfId, blob)
    return { ...data, pdfId }
  },
  getSource: async (pdfId: string) => getPdfBlob(pdfId),
  getStatus: async (pdfId: string, fromPage = 1) => {
    const response = await api.get(`/documents/${pdfId}/status`, { params: { fromPage } })
    return response.data
  },
  getParagraphs: async (pdfId: string, pageNumber: number) => {
    const response = await api.get(`/documents/${pdfId}/paragraphs/${pageNumber}`)
    return response.data
  },
  getLayout: async (pdfId: string): Promise<PdfLayoutResponse> => {
    const response = await api.get(`/documents/${pdfId}/layout`)
    return response.data as PdfLayoutResponse
  },
  explainOverlay: async (
    pdfId: string,
    payload: { overlayId?: string; sessionId?: string; page: number; kind: string; bboxNorm?: { left: number; top: number; width: number; height: number }; imageDataUrl: string },
  ) => {
    const response = await api.post(`/documents/${pdfId}/overlay/explain`, payload)
    return response.data as { analysis: string }
  },
  chatOverlay: async (
    pdfId: string,
    payload: { overlayId?: string; page?: number; kind: string; bboxNorm?: { left: number; top: number; width: number; height: number }; message: string; history?: Array<{ role: string; content: string }>; imageDataUrl: string },
  ) => {
    const response = await api.post(`/documents/${pdfId}/overlay/chat`, payload)
    return response.data as { answer: string; imageDataUrl?: string }
  },
  getFormulaLatex: async (pdfId: string, page: number, index: number) => {
    const response = await api.get(`/documents/${pdfId}/formulas/${page}/${index}`)
    return response.data as { latex: string }
  },
}

export const libraryApi = {
  list: async (params?: { keyword?: string; group?: string }) => {
    const response = await api.get("/library/documents", { params })
    const items = Array.isArray(response.data?.items)
      ? response.data.items.map((item: any) => ({
        pdfId: item.id,
        title: item.title,
        addedAt: item.uploadedAt,
        totalPages: item.pageCount,
        tags: item.tags ?? [],
        authors: item.authors ?? [],
      }))
      : []
    return {
      items,
      total: typeof response.data?.total === "number" ? response.data.total : items.length,
    }
  },
  delete: async (pdfId: string) => {
    deleteBlobForDocument(pdfId)
    return (await api.delete(`/library/documents/${pdfId}`)).data
  },
  addTag: async (pdfId: string, tag: string) => (await api.post(`/library/documents/${pdfId}/tags`, { tag })).data,
  rename: async (pdfId: string, title: string) => (await api.patch(`/library/documents/${pdfId}`, { title })).data,
  removeTag: async (pdfId: string, tag: string) => (await api.delete(`/library/documents/${pdfId}/tags/${encodeURIComponent(tag)}`)).data,
  upload: (file: File) => pdfApi.upload(file),
  importLink: async (input: string): Promise<ImportLinkJobResponse> => {
    const response = await api.post("/imports/link", { input })
    return response.data as ImportLinkJobResponse
  },
}

export const aiApi = {
  translateText: async (text: string, _pdfId?: string): Promise<Translation> => {
    const response = await api.post("/ai/translate/text", { text })
    return response.data as Translation
  },
  translateParagraph: async (_pdfId: string, paragraphId: string, contentOrForce?: string | boolean) => {
    const content = typeof contentOrForce === "string" ? contentOrForce : paragraphId
    const response = await api.post("/ai/translate/paragraph", { paragraphId, content })
    return response.data as { paragraphId: string; translation: string }
  },
  translateFullPage: async (
    _pdfId: string,
    paragraphs: Array<{ paragraphId: string; content: string }>,
    onMessage: (data: any) => void,
    onDone?: () => void,
    onError?: (error: unknown) => void,
  ) => {
    try {
      for (const paragraph of paragraphs) {
        const response = await api.post("/ai/translate/paragraph", {
          paragraphId: paragraph.paragraphId,
          content: paragraph.content,
        })
        onMessage({
          type: "translation",
          paragraphId: paragraph.paragraphId,
          translation: response.data.translation,
        })
      }
      onDone?.()
    } catch (error) {
      onError?.(error)
    }
  },
  generateRoadmap: async (pdfId: string): Promise<Roadmap> => {
    const response = await api.get(`/ai/roadmap/${pdfId}`)
    return response.data as Roadmap
  },
  generateBrief: async (pdfId: string): Promise<Brief> => {
    const response = await api.get(`/ai/brief/${pdfId}`)
    return {
      ...response.data,
      generatedAt: new Date(response.data.generatedAt ?? Date.now()),
    } as Brief
  },
}

export const linkApi = {
  getLinkData: async (pdfIdOrParams?: string | { pdfId: string; paragraphId?: string; page?: number; index?: number; force?: boolean }, targetParagraphId?: string, _force?: boolean): Promise<InternalLinkData & { citationCount?: number; venue?: string }> => {
    const pdfId = typeof pdfIdOrParams === "string" ? pdfIdOrParams : pdfIdOrParams?.pdfId ?? ""
    const paragraphId = typeof pdfIdOrParams === "string" ? targetParagraphId : pdfIdOrParams?.paragraphId
    const response = await api.get(`/links/${pdfId}/paragraphs/${paragraphId ?? ""}`)
    return response.data
  },
  getAllCitations: async (pdfId: string) => (await api.get(`/links/${pdfId}/citations`)).data,
}

export const chatSessionApi = {
  listSessions: async (
    context?: {
      scope?: "global" | "workspace" | "document"
      workspaceId?: string | null
      documentRemoteId?: string | null
    },
    _limit = 200,
  ): Promise<{ sessions: SessionRecord[] }> => {
    const response = await api.get("/threads")
    const items = (response.data.items ?? []) as Array<any>
    const sessions = items
      .filter((item) => {
        if (!context?.scope) return true
        if (item.scope !== context.scope) return false
        if (context.scope === "workspace") return item.workspaceId === (context.workspaceId ?? null)
        if (context.scope === "document") return item.documentRemoteId === (context.documentRemoteId ?? null)
        return true
      })
      .map((item) => ({
        id: item.id,
        pdfId: item.documentRemoteId ?? "",
        scope: item.scope ?? "global",
        workspaceId: item.workspaceId ?? null,
        title: item.title,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
        messageCount: 0,
      }))
    return { sessions }
  },
  createSession: async (context?: {
    scope?: "global" | "workspace" | "document"
    workspaceId?: string | null
    documentRemoteId?: string | null
  }) => {
    const pdfId = context?.documentRemoteId ?? sessionStorage.getItem("readme_library_current")
    const scope = context?.scope ?? (pdfId ? "document" : "global")
    const response = await api.post("/threads", {
      title: "New Chat",
      scope,
      workspaceId: context?.workspaceId ?? null,
      documentRemoteId: scope === "document" ? pdfId : null,
    })
    return {
      sessionId: response.data.id as string,
      title: response.data.title as string,
    }
  },
  updateSessionTitle: async (sessionId: string, title: string) => {
    await api.patch(`/threads/${sessionId}`, { title })
    return { success: true }
  },
  deleteSession: async (sessionId: string) => {
    await api.delete(`/threads/${sessionId}`)
    return { success: true }
  },
  getSessionMessages: async (sessionId: string): Promise<{ messages: SessionMessageRecord[] }> => {
    const response = await api.get(`/threads/${sessionId}/messages`)
      const messages = (response.data.items ?? []).map((item: any) => ({
        id: item.id,
        role: item.role,
        content: item.content,
        created_time: item.createdAt,
        citations: item.citations ?? [],
        attachments: item.attachments ?? [],
        thoughts: item.thoughts ?? [],
        steps: item.steps ?? [],
        runId: item.runId ?? null,
      }))
      return { messages }
    },
  sendMessage: async (
    sessionId: string,
    message: string,
    _pdfId: string,
    _mode: ChatMode = "agent",
    model?: string | null,
    apiBase?: string | null,
    apiKey?: string | null,
    history?: Array<{ role: string; content: string }>,
    _pruneFromId?: string,
    _contextText?: string,
    _images?: string[],
    onEvent?: (event: ChatStreamEvent) => void,
    signal?: AbortSignal,
  ) => {
    let finalEvent: ChatStreamFinalEvent | null = null
    await streamSse<ChatStreamEvent>(
      `/threads/${sessionId}/runs/stream`,
      {
        message: _contextText
          ? `${message || '请基于以下选中文本继续处理。'}\n\nSelected context:\n${_contextText}`
          : (message || '请结合当前上下文回答。'),
        mode: _mode,
        model,
        apiBase,
        apiKey,
        history,
        contextText: _contextText,
        images: _images,
      },
      {
        onMessage: (event) => {
          if (event.type === "run_started") {
            activeRunIdsBySession.set(sessionId, event.runId)
          }
          if (event.type === "final") finalEvent = event
          if (event.type === "final" || event.type === "error") {
            activeRunIdsBySession.delete(sessionId)
          }
          onEvent?.(event)
        },
      },
      signal,
    )

    const completedEvent = finalEvent as ChatStreamFinalEvent | null

    return {
      sessionId,
      response: completedEvent?.response ?? "",
      citations: completedEvent?.citations ?? [],
      steps: completedEvent?.steps ?? [],
      context_used: completedEvent?.context_used ?? {},
      runId: activeRunIdsBySession.get(sessionId) ?? null,
    }
  },
  abortAgent: async (sessionId?: string) => {
    if (!sessionId) return { success: false }
    const runId = activeRunIdsBySession.get(sessionId)
    if (!runId) return { success: false }
    const response = await api.post(`/runs/${runId}/abort`)
    activeRunIdsBySession.delete(sessionId)
    return response.data
  },
}

export const notesApi = {
  createNote: async (data: CreateNoteRequest): Promise<NoteActionResponse> => (await api.post("/notes", data)).data,
  getNotes: async (pdfId: string): Promise<NoteListResponse> => (await api.get("/notes", { params: { pdfId } })).data,
  updateNote: async (noteId: number, data: UpdateNoteRequest): Promise<NoteActionResponse> => (await api.patch(`/notes/${noteId}`, data)).data,
  deleteNote: async (noteId: number): Promise<NoteActionResponse> => (await api.delete(`/notes/${noteId}`)).data,
}

export const highlightApi = {
  createHighlight: async (data: {
    pdfId: string
    page: number
    rects: Array<{ left: number; top: number; width: number; height: number }>
    pageWidth: number
    pageHeight: number
    text?: string
    color?: string
  }) => (await api.post("/highlights", data)).data,
  getHighlights: async (pdfId: string, page?: number) => (await api.get("/highlights", { params: { pdfId, page } })).data,
  updateHighlight: async (highlightId: string | number, color: string) => (await api.patch(`/highlights/${highlightId}`, { color })).data,
  deleteHighlight: async (highlightId: string | number) => (await api.delete(`/highlights/${highlightId}`)).data,
}

export const proposalApi = {
  getPending: async () => (await api.get("/proposals")).data as { proposals: ProposalInfo[] },
  getById: async (id: string) => (await api.get(`/proposals/${id}`)).data as { proposal: ProposalInfo | null },
  action: async (id: string, action: "approve" | "reject", comment?: string) => (await api.post(`/proposals/${id}/action`, { action, comment })).data,
}

export const kgApi = {
  listProjects: async (params?: { limit?: number; offset?: number }) => (await api.get("/kg/projects", { params })).data,
  createProject: async (payload: { name: string; description?: string }) => (await api.post("/kg/projects", payload)).data,
  getProjectDetail: async (projectId: string) => (await api.get(`/kg/projects/${projectId}`)).data,
  createNode: async (projectId: string, payload: { label: string; description?: string; properties?: Record<string, any>; parent_id?: string | null }) => (await api.post(`/kg/projects/${projectId}/nodes`, payload)).data,
  updateNode: async (nodeId: string, payload: { label?: string; description?: string; properties?: Record<string, any> }) => (await api.patch(`/kg/nodes/${nodeId}`, payload)).data,
  deleteNode: async (nodeId: string) => { await api.delete(`/kg/nodes/${nodeId}`) },
  createEdge: async (projectId: string, payload: { source_node_id: string; target_node_id: string; relation_type?: string; description?: string }) => (await api.post(`/kg/projects/${projectId}/edges`, payload)).data,
  updateEdge: async (edgeId: string, payload: { relation_type?: string; description?: string }) => (await api.patch(`/kg/edges/${edgeId}`, payload)).data,
  deleteEdge: async (edgeId: string) => { await api.delete(`/kg/edges/${edgeId}`) },
  getProjectTree: async (projectId: string) => (await api.get(`/kg/projects/${projectId}/tree`)).data,
  setNodeParent: async (nodeId: string, parentId: string | null) => (await api.post(`/kg/nodes/${nodeId}/parent`, { parentId })).data,
  linkPaperToNode: async (nodeId: string, paperId: string) => (await api.post(`/kg/nodes/${nodeId}/papers/${paperId}`)).data,
  unlinkPaperFromNode: async (nodeId: string, paperId: string) => (await api.delete(`/kg/nodes/${nodeId}/papers/${paperId}`)).data,
  linkNoteToNode: async (nodeId: string, noteId: number) => (await api.post(`/kg/nodes/${nodeId}/notes/${noteId}`)).data,
  unlinkNoteFromNode: async (nodeId: string, noteId: number) => (await api.delete(`/kg/nodes/${nodeId}/notes/${noteId}`)).data,
  getLocalGraph: async (nodeId: string, hops = 2): Promise<LocalGraphResponse> => (await api.get(`/kg/local/${nodeId}`, { params: { hops } })).data,
  recompose: async (payload: RecomposePayload): Promise<RecomposeResult> => (await api.post("/kg/recompose", payload)).data,
}

export const htmlApi = {
  getHtml: async (pdfId: string) => (await api.get(`/html/${pdfId}`)).data,
  fetchHtml: async (pdfId: string, payload?: { force?: boolean }) => (await api.post(`/html/${pdfId}/fetch`, payload ?? {})).data,
}

export const adminApi = {
  getDashboard: async () => (await api.get("/admin/dashboard")).data,
  listUsers: async (params?: {
    page?: number
    perPage?: number
    search?: string
    role?: string
    isActive?: string | boolean
  }) => (await api.get("/admin/users", { params })).data,
  getUserDetail: async (userId: string) => ({ user: (await api.get("/admin/users", { params: { search: userId } })).data.items?.[0] ?? null }),
  updateUser: async (userId: string, payload: { role?: string; isActive?: boolean }) => (await api.patch(`/admin/users/${userId}`, payload)).data,
  deleteUser: async (userId: string) => (await api.delete(`/admin/users/${userId}`)).data,
  listInviteCodes: async (params?: {
    page?: number
    perPage?: number
    search?: string
    batch?: number
  }) => (await api.get("/admin/invite-codes", { params })).data,
  createInviteCode: async (payload: { owner?: string; remainingUses?: number; batch?: number; count?: number }) => (await api.post("/admin/invite-codes", payload)).data,
  updateInviteCode: async (codeId: number, payload: { remainingUses: number }) => (await api.patch(`/admin/invite-codes/${codeId}`, payload)).data,
  deleteInviteCode: async (codeId: number) => (await api.delete(`/admin/invite-codes/${codeId}`)).data,
  batchDeleteInviteCodes: async (ids: number[]) => (await api.post("/admin/invite-codes/batch-delete", { ids })).data,
}

export default api
