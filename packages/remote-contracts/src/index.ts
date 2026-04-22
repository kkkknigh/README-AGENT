export const REMOTE_OPENAPI_SOURCES = [
  "packages/remote-contracts/references/backend-openapi.yaml",
  "packages/remote-contracts/references/docs-openapi.yaml",
] as const

export type RemoteSyncState = "clean" | "dirty_local" | "refreshing" | "error"

export interface RemoteMirrorMeta {
  remoteId: string
  remoteUpdatedAt: string | null
  remoteDeletedAt: string | null
  lastSyncedAt: string | null
  syncState: RemoteSyncState
  lastSyncError: string | null
}

export interface RemoteDocumentDto {
  id: string
  title: string
  pageCount: number | null
  authors: string[]
  tags: string[]
  uploadedAt: string | null
  processStatus: string | null
  htmlStatus: string | null
  metadata: Record<string, unknown>
}

export interface RemoteNoteDto {
  id: number
  title: string | null
  content: string
  tags: string[]
  pdfId: string | null
  createdAt: string | null
  updatedAt: string | null
}

export interface RemoteHighlightDto {
  id: number | string
  pdfId: string
  page: number
  color: string
  text: string | null
  rects: Array<{ left: number; top: number; width: number; height: number }>
  createdAt: string | null
}

export interface RemoteGraphNodeDto {
  id: string
  label: string
  description: string | null
  parentId: string | null
  linkedPaperIds: string[]
  linkedNoteIds: number[]
}

export interface RemoteGraphEdgeDto {
  id: string
  sourceNodeId: string
  targetNodeId: string
  relationType: string
  description: string | null
}

export interface RemoteGraphProjectDto {
  id: string
  name: string
  description: string | null
  nodeCount: number
  edgeCount: number
  paperIds: string[]
}

export interface RemoteBootstrapPayload {
  documents: RemoteDocumentDto[]
  notes: RemoteNoteDto[]
  highlights: RemoteHighlightDto[]
  graphProjects: RemoteGraphProjectDto[]
  graphNodes: RemoteGraphNodeDto[]
  graphEdges: RemoteGraphEdgeDto[]
  serverTime: string
}

export interface RemoteApiConfig {
  baseUrl: string
  accessToken?: string | null
}

export interface RemoteApiClient {
  bootstrap(): Promise<RemoteBootstrapPayload>
}
