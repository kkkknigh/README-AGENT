import type {
  RemoteDocumentDto,
  RemoteGraphProjectDto,
  RemoteNoteDto,
  RemoteSyncState,
} from "@readmeclaw/remote-contracts"

export type WorkspaceNodeKind = "workspace"

export interface WorkspaceNodeDto {
  id: string
  kind: WorkspaceNodeKind
  name: string
  slug: string
  parentId: string | null
  path: string
  color: string | null
  description: string | null
  createdAt: string
  updatedAt: string
}

export interface WorkspaceBindingDto {
  workspaceId: string
  remoteId: string
  entityType: "document" | "note" | "graph_project"
  createdAt: string
}

export interface LocalChatThreadDto {
  id: string
  title: string
  scope: "global" | "workspace" | "document"
  workspaceId: string | null
  documentRemoteId: string | null
  createdAt: string
  updatedAt: string
}

export interface LocalChatMessageDto {
  id: string
  threadId: string
  role: "user" | "assistant"
  content: string
  createdAt: string
}

export type WorkbenchTabType = "welcome" | "document" | "note" | "graph"

export interface WorkbenchTabDto {
  id: string
  type: WorkbenchTabType
  resourceRemoteId: string | null
  title: string
  payloadJson: string
  createdAt: string
  updatedAt: string
}

export interface WorkbenchContextDto {
  scope: "global" | "workspace" | "document"
  workspaceId: string | null
  documentRemoteId: string | null
  activeResourceType: WorkbenchTabType | null
}

export interface SyncStatusDto {
  state: RemoteSyncState
  lastSyncedAt: string | null
  lastError: string | null
}

export interface WorkspaceDetailDto {
  workspace: WorkspaceNodeDto
  documents: RemoteDocumentDto[]
  notes: RemoteNoteDto[]
  graphProjects: RemoteGraphProjectDto[]
}
